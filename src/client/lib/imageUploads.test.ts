import { afterEach, describe, expect, mock, test } from "bun:test"

const originalWindow = globalThis.window
const originalNavigator = globalThis.navigator
const invokeMock = mock()

mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}))

import {
  clipboardHasTextPayload,
  extractImageFilesFromDataTransfer,
  readBrowserClipboardImageFile,
  readNativeClipboardImageFile,
} from "./imageUploads"

function createTransferFile(name: string, type: string, content = "test") {
  return new File([content], name, { type, lastModified: 123 })
}

function createClipboardItem(file: File | null, type = file?.type ?? "image/png") {
  return {
    kind: "file",
    type,
    getAsFile() {
      return file
    },
  } as DataTransferItem
}

afterEach(() => {
  invokeMock.mockReset()
  globalThis.window = originalWindow
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
  })
})

describe("extractImageFilesFromDataTransfer", () => {
  test("reads images from clipboard files", () => {
    const file = createTransferFile("shot.png", "image/png")

    const result = extractImageFilesFromDataTransfer({
      files: [file] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
    })

    expect(result).toEqual([file])
  })

  test("reads images from clipboard items when files is empty", () => {
    const file = createTransferFile("shot.png", "image/png")

    const result = extractImageFilesFromDataTransfer({
      files: [] as unknown as FileList,
      items: [createClipboardItem(file)] as unknown as DataTransferItemList,
    })

    expect(result).toEqual([file])
  })

  test("deduplicates the same image when both files and items expose it", () => {
    const file = createTransferFile("shot.png", "image/png")

    const result = extractImageFilesFromDataTransfer({
      files: [file] as unknown as FileList,
      items: [createClipboardItem(file)] as unknown as DataTransferItemList,
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toBe(file)
  })

  test("ignores non-image clipboard items", () => {
    const textFile = createTransferFile("note.txt", "text/plain")

    const result = extractImageFilesFromDataTransfer({
      files: [] as unknown as FileList,
      items: [createClipboardItem(textFile, "text/plain")] as unknown as DataTransferItemList,
    })

    expect(result).toEqual([])
  })
})

describe("clipboardHasTextPayload", () => {
  test("detects plain text clipboard types", () => {
    expect(clipboardHasTextPayload({
      types: ["text/plain"] as unknown as DOMStringList,
      getData: () => "",
    })).toBe(true)
  })

  test("detects clipboard text via getData fallback", () => {
    expect(clipboardHasTextPayload({
      types: [] as unknown as DOMStringList,
      getData: (type: string) => (type === "text/plain" ? "hello" : ""),
    })).toBe(true)
  })

  test("returns false for image-only clipboard payloads", () => {
    expect(clipboardHasTextPayload({
      types: ["image/png"] as unknown as DOMStringList,
      getData: () => "",
    })).toBe(false)
  })
})

describe("readNativeClipboardImageFile", () => {
  test("reads a clipboard image from the tauri bridge", async () => {
    globalThis.window = {
      isTauri: true,
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    } as unknown as Window & typeof globalThis
    invokeMock.mockResolvedValue({
      pngBase64: Buffer.from("png-bytes").toString("base64"),
      width: 16,
      height: 16,
    })

    const file = await readNativeClipboardImageFile()
    expect(file).toBeInstanceOf(File)
    expect(file?.name).toMatch(/^clipboard-.*\.png$/)
    expect(file?.type).toBe("image/png")
    expect(await file?.text()).toBe("png-bytes")
  })

  test("throws when the tauri bridge returns an invalid payload", async () => {
    globalThis.window = {
      isTauri: true,
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    } as unknown as Window & typeof globalThis
    invokeMock.mockResolvedValue({
      png_base64: Buffer.from("png-bytes").toString("base64"),
      width: 16,
      height: 16,
    })

    await expect(readNativeClipboardImageFile()).rejects.toThrow(
      "Clipboard image could not be read from the desktop bridge.",
    )
  })
})

describe("readBrowserClipboardImageFile", () => {
  test("reads an image clipboard item from the browser clipboard api", async () => {
    const blob = new Blob(["png-bytes"], { type: "image/png" })
    const read = mock().mockResolvedValue([
      {
        types: ["image/png"],
        getType: mock().mockResolvedValue(blob),
      },
    ])

    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: { read },
      },
      configurable: true,
    })

    const file = await readBrowserClipboardImageFile()
    expect(file).toBeInstanceOf(File)
    expect(file?.type).toBe("image/png")
    expect(await file?.text()).toBe("png-bytes")
  })

  test("returns null when browser clipboard has no supported image", async () => {
    const read = mock().mockResolvedValue([
      {
        types: ["text/plain"],
        getType: mock(),
      },
    ])

    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: { read },
      },
      configurable: true,
    })

    await expect(readBrowserClipboardImageFile()).resolves.toBeNull()
  })
})

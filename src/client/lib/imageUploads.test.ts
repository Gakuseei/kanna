import { describe, expect, test } from "bun:test"
import { clipboardHasTextPayload, extractImageFilesFromDataTransfer } from "./imageUploads"

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

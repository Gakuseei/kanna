import { describe, expect, test } from "bun:test"
import { extractImageFilesFromDataTransfer } from "./imageUploads"

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

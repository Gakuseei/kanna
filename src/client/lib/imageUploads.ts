import type { StagedImageUpload } from "../../shared/types"

export const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export interface PendingComposerImage {
  id: string
  file: File
  previewUrl: string
  width?: number
  height?: number
}

function loadImageDimensions(objectUrl: string) {
  return new Promise<{ width: number; height: number } | null>((resolve) => {
    const image = new window.Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => resolve(null)
    image.src = objectUrl
  })
}

export function validateImageFile(file: File) {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new Error(`Unsupported image type: ${file.type || "unknown"}`)
  }
  if (file.size <= 0) {
    throw new Error("Image file is empty")
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))}MB limit`)
  }
}

export async function createPendingComposerImages(files: File[]) {
  const pending = await Promise.all(files.map(async (file) => {
    validateImageFile(file)
    const previewUrl = URL.createObjectURL(file)
    const dimensions = await loadImageDimensions(previewUrl)

    return {
      id: crypto.randomUUID(),
      file,
      previewUrl,
      width: dimensions?.width,
      height: dimensions?.height,
    } satisfies PendingComposerImage
  }))

  return pending
}

export function revokePendingComposerImages(images: PendingComposerImage[]) {
  for (const image of images) {
    URL.revokeObjectURL(image.previewUrl)
  }
}

export function extractImageFiles(fileList: Iterable<File>) {
  return [...fileList].filter((file) => ACCEPTED_IMAGE_TYPES.has(file.type))
}

function fileIdentity(file: File) {
  return [file.name, file.type, file.size, file.lastModified].join(":")
}

function dedupeImageFiles(files: File[]) {
  const uniqueFiles = new Map<string, File>()
  for (const file of files) {
    uniqueFiles.set(fileIdentity(file), file)
  }
  return [...uniqueFiles.values()]
}

function fileFromClipboardItem(item: DataTransferItem) {
  if (item.kind !== "file" || !item.type.startsWith("image/")) {
    return null
  }

  const file = item.getAsFile()
  return file instanceof File ? file : null
}

export function extractImageFilesFromDataTransfer(dataTransfer: Pick<DataTransfer, "files" | "items"> | null | undefined) {
  if (!dataTransfer) {
    return []
  }

  const filesFromList = extractImageFiles(dataTransfer.files ?? [])
  const filesFromItems = Array.from(dataTransfer.items ?? [])
    .map(fileFromClipboardItem)
    .filter((file): file is File => file !== null)

  return dedupeImageFiles([
    ...filesFromList,
    ...extractImageFiles(filesFromItems),
  ])
}

export async function stageImages(files: File[]): Promise<StagedImageUpload[]> {
  const formData = new FormData()
  for (const file of files) {
    formData.append("files", file, file.name)
  }

  const response = await fetch("/api/media/images/stage", {
    method: "POST",
    body: formData,
  })

  const payload = await response.json().catch(() => null) as { images?: StagedImageUpload[]; error?: string } | null
  if (!response.ok) {
    throw new Error(payload?.error ?? "Could not upload images")
  }

  return payload?.images ?? []
}

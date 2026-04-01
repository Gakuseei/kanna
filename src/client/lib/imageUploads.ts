import type { StagedImageUpload } from "../../shared/types"
import { isTauriDesktopWindow, resolveServerUrl } from "./runtime"

export const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const ACCEPTED_BROWSER_CLIPBOARD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const

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

export function clipboardHasTextPayload(dataTransfer: Pick<DataTransfer, "types" | "getData"> | null | undefined) {
  if (!dataTransfer) {
    return false
  }

  const clipboardTypes = Array.from(dataTransfer.types ?? [])
  if (clipboardTypes.some((type) => type.startsWith("text/"))) {
    return true
  }

  return ["text/plain", "text/html", "text/uri-list"].some((type) => {
    try {
      return dataTransfer.getData(type).trim().length > 0
    } catch {
      return false
    }
  })
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

function decodeBase64(base64: string) {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function normalizeClipboardImageType(type: string) {
  return type === "image/jpg" ? "image/jpeg" : type
}

function isNativeClipboardImagePayload(
  payload: unknown,
): payload is { pngBase64: string; width: number; height: number } {
  if (!payload || typeof payload !== "object") {
    return false
  }

  const candidate = payload as Record<string, unknown>
  return typeof candidate.pngBase64 === "string"
    && typeof candidate.width === "number"
    && typeof candidate.height === "number"
}

export async function readNativeClipboardImageFile() {
  if (!isTauriDesktopWindow()) {
    return null
  }

  const { invoke } = await import("@tauri-apps/api/core")
  const payload = await invoke<unknown>("read_clipboard_image")
  if (payload === null) {
    return null
  }

  if (!isNativeClipboardImagePayload(payload)) {
    console.error("[imageUploads] Invalid native clipboard image payload", payload)
    throw new Error("Clipboard image could not be read from the desktop bridge.")
  }

  const bytes = decodeBase64(payload.pngBase64)
  return new File([bytes], `clipboard-${Date.now()}.png`, {
    type: "image/png",
    lastModified: Date.now(),
  })
}

export async function readBrowserClipboardImageFile() {
  if (typeof navigator === "undefined" || typeof navigator.clipboard?.read !== "function") {
    return null
  }

  let items: ClipboardItem[]
  try {
    items = await navigator.clipboard.read()
  } catch {
    return null
  }

  for (const item of items) {
    const matchingType = item.types.find((type) => ACCEPTED_BROWSER_CLIPBOARD_TYPES.includes(
      normalizeClipboardImageType(type) as (typeof ACCEPTED_BROWSER_CLIPBOARD_TYPES)[number],
    ))

    if (!matchingType) {
      continue
    }

    const blob = await item.getType(matchingType)
    if (blob.size <= 0) {
      continue
    }

    return new File([blob], `clipboard-${Date.now()}.${matchingType.split("/")[1] ?? "png"}`, {
      type: normalizeClipboardImageType(matchingType),
      lastModified: Date.now(),
    })
  }

  return null
}

export async function stageImages(files: File[]): Promise<StagedImageUpload[]> {
  const formData = new FormData()
  for (const file of files) {
    formData.append("files", file, file.name)
  }

  const response = await fetch(resolveServerUrl("/api/media/images/stage"), {
    method: "POST",
    body: formData,
  })

  const payload = await response.json().catch(() => null) as { images?: StagedImageUpload[]; error?: string } | null
  if (!response.ok) {
    throw new Error(payload?.error ?? "Could not upload images")
  }

  return payload?.images ?? []
}

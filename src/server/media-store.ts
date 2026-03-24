import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { getDataDir, LOG_PREFIX } from "../shared/branding"
import type { ImageAttachment, StagedImageUpload } from "../shared/types"

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])

const MIME_EXTENSIONS: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const STAGING_TTL_MS = 24 * 60 * 60 * 1000

interface StagedImageManifest {
  stagedId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  width?: number
  height?: number
  createdAt: number
  storedFileName: string
}

function sanitizeFileName(fileName: string, fallbackExtension: string) {
  const trimmed = path.basename(fileName || "").trim()
  const cleaned = trimmed.replace(/[\u0000-\u001f\u007f]+/g, "").slice(0, 160)
  if (cleaned) {
    return cleaned
  }
  return `image${fallbackExtension}`
}

function extensionForImage(fileName: string, mimeType: string) {
  const explicit = path.extname(fileName).toLowerCase()
  if (/^\.[a-z0-9]{1,8}$/.test(explicit)) {
    return explicit
  }
  return MIME_EXTENSIONS[mimeType] ?? ".png"
}

function isSafePathSegment(value: string) {
  return value.length > 0 && value === path.basename(value) && !value.includes("..")
}

export class MediaStore {
  readonly mediaRoot: string
  private readonly stagingDir: string
  private readonly chatRoot: string
  private initialized = false
  private initPromise: Promise<void> | null = null

  constructor(dataDir = getDataDir(homedir())) {
    this.mediaRoot = path.join(dataDir, "media")
    this.stagingDir = path.join(this.mediaRoot, "staging")
    this.chatRoot = path.join(this.mediaRoot, "chats")
  }

  async initialize() {
    if (this.initialized) {
      return
    }
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await mkdir(this.stagingDir, { recursive: true })
        await mkdir(this.chatRoot, { recursive: true })
        await this.cleanupStaging()
        this.initialized = true
      })()
    }
    await this.initPromise
  }

  async stageImages(files: File[]): Promise<StagedImageUpload[]> {
    await this.initialize()
    const staged: StagedImageUpload[] = []

    for (const file of files) {
      this.validateImage(file)

      const extension = extensionForImage(file.name, file.type)
      const stagedId = crypto.randomUUID()
      const fileName = sanitizeFileName(file.name, extension)
      const storedFileName = `${stagedId}${extension}`
      const manifest: StagedImageManifest = {
        stagedId,
        fileName,
        mimeType: file.type,
        sizeBytes: file.size,
        createdAt: Date.now(),
        storedFileName,
      }

      await Bun.write(path.join(this.stagingDir, storedFileName), file)
      await writeFile(
        this.manifestPath(stagedId),
        JSON.stringify(manifest, null, 2),
        "utf8",
      )

      staged.push({
        stagedId,
        fileName,
        mimeType: file.type,
        sizeBytes: file.size,
      })
    }

    return staged
  }

  async finalizeStagedImages(chatId: string, stagedIds: string[]): Promise<ImageAttachment[]> {
    await this.initialize()
    if (stagedIds.length === 0) {
      return []
    }

    const chatDir = path.join(this.chatRoot, chatId)
    await mkdir(chatDir, { recursive: true })

    const attachments: ImageAttachment[] = []

    for (const stagedId of stagedIds) {
      const manifest = await this.readManifest(stagedId)
      const ageMs = Date.now() - manifest.createdAt
      if (ageMs > STAGING_TTL_MS) {
        await this.removeStagedFiles(stagedId, manifest.storedFileName)
        throw new Error("One of the selected images expired before it was sent. Please attach it again.")
      }

      const extension = path.extname(manifest.storedFileName) || MIME_EXTENSIONS[manifest.mimeType] || ".png"
      const assetId = crypto.randomUUID()
      const storedFileName = `${assetId}${extension}`
      const sourcePath = path.join(this.stagingDir, manifest.storedFileName)
      const targetPath = path.join(chatDir, storedFileName)

      await rename(sourcePath, targetPath)
      await rm(this.manifestPath(stagedId), { force: true })

      attachments.push({
        id: assetId,
        chatId,
        fileName: manifest.fileName,
        mimeType: manifest.mimeType,
        sizeBytes: manifest.sizeBytes,
        width: manifest.width,
        height: manifest.height,
        assetPath: path.posix.join("chats", chatId, storedFileName),
        url: `/media/chat/${encodeURIComponent(chatId)}/${encodeURIComponent(storedFileName)}`,
      })
    }

    return attachments
  }

  async serveChatAsset(chatId: string, storedFileName: string) {
    await this.initialize()

    if (!isSafePathSegment(chatId) || !isSafePathSegment(storedFileName)) {
      return new Response("Not found", { status: 404 })
    }

    const filePath = path.join(this.chatRoot, chatId, storedFileName)
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 })
    }

    return new Response(file, {
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    })
  }

  async cleanupStaging() {
    await mkdir(this.stagingDir, { recursive: true })
    const entries = await readdir(this.stagingDir)
    const now = Date.now()

    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue
      }

      const stagedId = entry.slice(0, -5)
      try {
        const manifest = await this.readManifest(stagedId)
        if (now - manifest.createdAt <= STAGING_TTL_MS) {
          continue
        }
        await this.removeStagedFiles(stagedId, manifest.storedFileName)
      } catch (error) {
        console.warn(LOG_PREFIX, "Failed to read staged image manifest, removing it:", error)
        await rm(path.join(this.stagingDir, entry), { force: true })
      }
    }

    for (const entry of entries) {
      if (entry.endsWith(".json")) {
        continue
      }

      const filePath = path.join(this.stagingDir, entry)
      const fileStat = await stat(filePath).catch(() => null)
      if (!fileStat) {
        continue
      }
      if (now - fileStat.mtimeMs <= STAGING_TTL_MS) {
        continue
      }

      const stagedId = path.parse(entry).name
      const manifestExists = await Bun.file(this.manifestPath(stagedId)).exists()
      if (!manifestExists) {
        await rm(filePath, { force: true })
      }
    }
  }

  private validateImage(file: File) {
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

  private manifestPath(stagedId: string) {
    return path.join(this.stagingDir, `${stagedId}.json`)
  }

  private async readManifest(stagedId: string): Promise<StagedImageManifest> {
    const manifestPath = this.manifestPath(stagedId)
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<StagedImageManifest>

    if (
      typeof parsed.stagedId !== "string"
      || typeof parsed.fileName !== "string"
      || typeof parsed.mimeType !== "string"
      || typeof parsed.sizeBytes !== "number"
      || typeof parsed.createdAt !== "number"
      || typeof parsed.storedFileName !== "string"
    ) {
      throw new Error("Invalid staged image manifest")
    }

    return parsed as StagedImageManifest
  }

  private async removeStagedFiles(stagedId: string, storedFileName?: string) {
    await rm(this.manifestPath(stagedId), { force: true })
    if (storedFileName) {
      await rm(path.join(this.stagingDir, storedFileName), { force: true })
    }
  }
}

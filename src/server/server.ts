import fs from "node:fs"
import path from "node:path"
import { APP_NAME, getRuntimeProfile } from "../shared/branding"
import { EventStore } from "./event-store"
import { AgentCoordinator } from "./agent"
import { discoverProjects, type DiscoveredProject } from "./discovery"
import { KeybindingsManager } from "./keybindings"
import { MediaStore } from "./media-store"
import { getMachineDisplayName } from "./machine-name"
import { TerminalManager } from "./terminal-manager"
import { UpdateManager } from "./update-manager"
import type { UpdateInstallAttemptResult } from "./cli-runtime"
import { createWsRouter, type ClientState } from "./ws-router"

export interface StartKannaServerOptions {
  port?: number
  strictPort?: boolean
  update?: {
    version: string
    fetchLatestVersion: (packageName: string) => Promise<string>
    installVersion: (packageName: string, version: string) => UpdateInstallAttemptResult
  }
}

export async function startKannaServer(options: StartKannaServerOptions = {}) {
  const port = options.port ?? 3210
  const strictPort = options.strictPort ?? false
  const store = new EventStore()
  const mediaStore = new MediaStore(store.dataDir)
  const machineDisplayName = getMachineDisplayName()
  await store.initialize()
  await mediaStore.initialize()
  let discoveredProjects: DiscoveredProject[] = []

  async function refreshDiscovery() {
    discoveredProjects = discoverProjects()
    return discoveredProjects
  }

  await refreshDiscovery()

  let server: ReturnType<typeof Bun.serve<ClientState>>
  let router: ReturnType<typeof createWsRouter>
  const terminals = new TerminalManager()
  const keybindings = new KeybindingsManager()
  await keybindings.initialize()
  const updateManager = options.update
    ? new UpdateManager({
      currentVersion: options.update.version,
      fetchLatestVersion: options.update.fetchLatestVersion,
      installVersion: options.update.installVersion,
      devMode: getRuntimeProfile() === "dev",
    })
    : null
  const agent = new AgentCoordinator({
    store,
    mediaStore,
    onStateChange: () => {
      router.broadcastSnapshots()
    },
  })
  router = createWsRouter({
    store,
    agent,
    terminals,
    keybindings,
    refreshDiscovery,
    getDiscoveredProjects: () => discoveredProjects,
    machineDisplayName,
    updateManager,
  })

  const distDir = resolveClientDistDir()

  const MAX_PORT_ATTEMPTS = 20
  let actualPort = port

  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    try {
      server = Bun.serve<ClientState>({
        port: actualPort,
        async fetch(req, serverInstance) {
          const url = new URL(req.url)

          if (url.pathname === "/ws") {
            const upgraded = serverInstance.upgrade(req, {
              data: {
                subscriptions: new Map(),
              },
            })
            return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 })
          }

          if (url.pathname === "/health") {
            return Response.json({ ok: true, port: actualPort })
          }

          if (url.pathname === "/api/media/images/stage") {
            if (req.method !== "POST") {
              return new Response("Method not allowed", { status: 405 })
            }

            try {
              const formData = await req.formData()
              const files: File[] = []
              for (const value of formData.values()) {
                if (typeof value !== "string") {
                  files.push(value)
                }
              }
              if (files.length === 0) {
                return Response.json({ images: [] })
              }

              const images = await mediaStore.stageImages(files)
              return Response.json({ images })
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              return Response.json({ error: message }, { status: 400 })
            }
          }

          if (url.pathname.startsWith("/media/chat/")) {
            const parts = url.pathname.split("/").filter(Boolean)
            if (parts.length !== 4 || parts[0] !== "media" || parts[1] !== "chat") {
              return new Response("Not found", { status: 404 })
            }

            return mediaStore.serveChatAsset(
              decodeURIComponent(parts[2]),
              decodeURIComponent(parts[3]),
            )
          }

          return serveStatic(distDir, url.pathname)
        },
        websocket: {
          open(ws) {
            router.handleOpen(ws)
          },
          message(ws, raw) {
            router.handleMessage(ws, raw)
          },
          close(ws) {
            router.handleClose(ws)
          },
        },
      })
      break
    } catch (err: unknown) {
      const isAddrInUse =
        err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EADDRINUSE"
      if (!isAddrInUse || strictPort || attempt === MAX_PORT_ATTEMPTS - 1) {
        throw err
      }
      console.log(`Port ${actualPort} is in use, trying ${actualPort + 1}...`)
      actualPort++
    }
  }

  const shutdown = async () => {
    for (const chatId of [...agent.activeTurns.keys()]) {
      await agent.cancel(chatId)
    }
    router.dispose()
    keybindings.dispose()
    terminals.closeAll()
    await store.compact()
    server.stop(true)
  }

  return {
    port: actualPort,
    store,
    updateManager,
    stop: shutdown,
  }
}

function isClientDistDir(candidate: string) {
  return fs.existsSync(path.join(candidate, "index.html"))
}

function findClientDistDirFrom(startDir: string) {
  let currentDir = path.resolve(startDir)

  while (true) {
    const candidate = path.join(currentDir, "dist", "client")
    if (isClientDistDir(candidate)) {
      return candidate
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      return null
    }
    currentDir = parentDir
  }
}

function resolveClientDistDir() {
  const envDistDir = process.env.KANNA_DESKTOP_DIST_DIR
  if (envDistDir && isClientDistDir(envDistDir)) {
    return envDistDir
  }

  const cwdDistDir = path.join(process.cwd(), "dist", "client")
  if (isClientDistDir(cwdDistDir)) {
    return cwdDistDir
  }

  const execDistDir = findClientDistDirFrom(path.dirname(process.execPath))
  if (execDistDir) {
    return execDistDir
  }

  return path.join(import.meta.dir, "..", "..", "dist", "client")
}

async function serveStatic(distDir: string, pathname: string) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname
  const filePath = path.join(distDir, requestedPath)
  const indexPath = path.join(distDir, "index.html")

  const file = Bun.file(filePath)
  if (await file.exists()) {
    return new Response(file)
  }

  const indexFile = Bun.file(indexPath)
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    })
  }

  return new Response(
    `${APP_NAME} client bundle not found. Run \`bun run build\` inside workbench/ first.`,
    { status: 503 }
  )
}

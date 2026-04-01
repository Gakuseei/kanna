import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import type { HermesSshSettings, HermesSshValidationResult } from "../shared/types"

interface HermesSshSettingsFile extends Partial<Record<keyof HermesSshSettings, unknown>> {}

const DEFAULT_HERMES_SSH_SETTINGS: HermesSshSettings = {
  host: "",
  port: 22,
  user: "",
  keyPath: "",
  remoteCwd: "~",
  hermesCommand: "hermes acp",
}

export class HermesSshSettingsManager {
  readonly filePath: string
  private settings: HermesSshSettings = { ...DEFAULT_HERMES_SSH_SETTINGS }

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "hermes-ssh.json")
  }

  async initialize() {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    this.settings = await readHermesSshSettings(this.filePath)
  }

  getSettings() {
    return { ...this.settings }
  }

  async write(settings: HermesSshSettings) {
    const normalized = normalizeHermesSshSettings(settings)
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
    this.settings = normalized
    return this.getSettings()
  }

  async validate(settings?: HermesSshSettings): Promise<HermesSshValidationResult> {
    const candidate = normalizeHermesSshSettings(settings ?? this.settings)
    if (!candidate.host || !candidate.user) {
      return {
        ok: false,
        message: "Host and user are required.",
      }
    }

    if (!Bun.which("ssh")) {
      return {
        ok: false,
        message: "OpenSSH client is not installed or not in PATH.",
      }
    }

    const remoteCommand = [
      "set -e",
      "command -v hermes >/dev/null 2>&1",
      `${candidate.hermesCommand} --help >/dev/null 2>&1 || ${candidate.hermesCommand} >/dev/null 2>&1 || true`,
      "printf 'ok'",
    ].join("; ")

    const args = buildSshArgs(candidate, remoteCommand)
    const result = await runCommand("ssh", args, 15_000)

    if (!result.ok) {
      return {
        ok: false,
        message: result.message || "SSH validation failed.",
      }
    }

    if (!result.stdout.includes("ok")) {
      return {
        ok: false,
        message: "SSH connected, but remote Hermes validation did not succeed.",
      }
    }

    return {
      ok: true,
      message: `Connected to ${candidate.user}@${candidate.host} and found Hermes.`,
    }
  }
}

export async function readHermesSshSettings(filePath: string) {
  try {
    const text = await readFile(filePath, "utf8")
    if (!text.trim()) {
      return { ...DEFAULT_HERMES_SSH_SETTINGS }
    }
    return normalizeHermesSshSettings(JSON.parse(text) as HermesSshSettingsFile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { ...DEFAULT_HERMES_SSH_SETTINGS }
    }
    if (error instanceof SyntaxError) {
      return { ...DEFAULT_HERMES_SSH_SETTINGS }
    }
    throw error
  }
}

export function normalizeHermesSshSettings(value: HermesSshSettingsFile | HermesSshSettings | null | undefined): HermesSshSettings {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {}

  return {
    host: typeof source.host === "string" ? source.host.trim() : DEFAULT_HERMES_SSH_SETTINGS.host,
    port: normalizePort(source.port),
    user: typeof source.user === "string" ? source.user.trim() : DEFAULT_HERMES_SSH_SETTINGS.user,
    keyPath: typeof source.keyPath === "string" ? source.keyPath.trim() : DEFAULT_HERMES_SSH_SETTINGS.keyPath,
    remoteCwd: typeof source.remoteCwd === "string" && source.remoteCwd.trim().length > 0
      ? source.remoteCwd.trim()
      : DEFAULT_HERMES_SSH_SETTINGS.remoteCwd,
    hermesCommand: typeof source.hermesCommand === "string" && source.hermesCommand.trim().length > 0
      ? source.hermesCommand.trim()
      : DEFAULT_HERMES_SSH_SETTINGS.hermesCommand,
  }
}

export function buildSshArgs(settings: HermesSshSettings, remoteCommand: string) {
  const args = [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-p", String(settings.port),
  ]
  if (settings.keyPath) {
    args.push("-i", settings.keyPath)
  }
  args.push(`${settings.user}@${settings.host}`, remoteCommand)
  return args
}

function normalizePort(value: unknown) {
  const port = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return DEFAULT_HERMES_SSH_SETTINGS.port
  }
  return port
}

async function runCommand(command: string, args: string[], timeoutMs: number) {
  return await new Promise<{ ok: boolean; stdout: string; message: string }>((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })

    let stdout = ""
    let stderr = ""
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      resolve({
        ok: false,
        stdout,
        message: "SSH validation timed out.",
      })
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: false,
        stdout,
        message: error.message,
      })
    })
    child.once("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        stdout,
        message: stderr.trim() || stdout.trim(),
      })
    })
  })
}

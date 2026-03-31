import { readFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import defaultShell, { detectDefaultShell } from "default-shell"
import type { TerminalEvent, TerminalSnapshot } from "../shared/protocol"

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const DEFAULT_SCROLLBACK = 1_000
const MIN_SCROLLBACK = 500
const MAX_SCROLLBACK = 5_000
const FOCUS_IN_SEQUENCE = "\x1b[I"
const FOCUS_OUT_SEQUENCE = "\x1b[O"
const MODE_SEQUENCE_TAIL_LENGTH = 16
const MIN_REPLAY_BUFFER_CHARS = 8_192
const MAX_REPLAY_BUFFER_CHARS = 250_000

interface CreateTerminalArgs {
  projectPath: string
  terminalId: string
  cols: number
  rows: number
  scrollback: number
}

interface TerminalSession {
  terminalId: string
  title: string
  cwd: string
  shell: string
  cols: number
  rows: number
  scrollback: number
  status: "running" | "exited"
  exitCode: number | null
  process: Bun.Subprocess | null
  terminal: Bun.Terminal
  replayBuffer: string
  wrappedWithScript: boolean
  focusReportingEnabled: boolean
  modeSequenceTail: string
}

function clampScrollback(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_SCROLLBACK
  return Math.min(MAX_SCROLLBACK, Math.max(MIN_SCROLLBACK, Math.round(value)))
}

function normalizeTerminalDimension(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.round(value))
}

function resolveShell() {
  try {
    return detectDefaultShell()
  } catch {
    if (defaultShell) return defaultShell
    if (process.platform === "win32") {
      return process.env.ComSpec || "cmd.exe"
    }
    return process.env.SHELL || "/bin/sh"
  }
}

function resolveShellArgs(shellPath: string) {
  if (process.platform === "win32") {
    return []
  }

  const shellName = path.basename(shellPath)
  if (["bash", "zsh", "fish", "sh", "ksh"].includes(shellName)) {
    return ["-l"]
  }

  return []
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function resolveTerminalSpawnCommand(
  shellPath: string,
  options: {
    platform?: NodeJS.Platform
    scriptPath?: string | null
  } = {},
) {
  const platform = options.platform ?? process.platform
  const shellArgs = resolveShellArgs(shellPath)
  const directCommand = [shellPath, ...shellArgs]

  if (platform !== "linux") {
    return directCommand
  }

  const scriptPath = Object.prototype.hasOwnProperty.call(options, "scriptPath")
    ? options.scriptPath
    : Bun.which("script")
  if (!scriptPath) {
    return directCommand
  }

  const wrappedCommand = directCommand.map(shellQuote).join(" ")
  return [scriptPath, "-qefc", wrappedCommand, "/dev/null"]
}

function createTerminalEnv() {
  return {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  }
}

function updateFocusReportingState(session: Pick<TerminalSession, "focusReportingEnabled" | "modeSequenceTail">, chunk: string) {
  const combined = session.modeSequenceTail + chunk
  const regex = /\x1b\[\?1004([hl])/g

  for (const match of combined.matchAll(regex)) {
    session.focusReportingEnabled = match[1] === "h"
  }

  session.modeSequenceTail = combined.slice(-MODE_SEQUENCE_TAIL_LENGTH)
}

function filterFocusReportInput(data: string, allowFocusReporting: boolean) {
  if (allowFocusReporting) {
    return data
  }

  return data.replaceAll(FOCUS_IN_SEQUENCE, "").replaceAll(FOCUS_OUT_SEQUENCE, "")
}

function getReplayBufferLimit(session: Pick<TerminalSession, "cols" | "scrollback">) {
  const estimatedChars = session.scrollback * Math.max(session.cols, 20) * 4
  return Math.min(MAX_REPLAY_BUFFER_CHARS, Math.max(MIN_REPLAY_BUFFER_CHARS, estimatedChars))
}

function trimReplayBuffer(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  const fallbackStart = value.length - maxLength
  const newlineStart = value.indexOf("\n", fallbackStart)
  const start = newlineStart >= 0 && newlineStart < value.length - 1 ? newlineStart + 1 : fallbackStart
  return value.slice(start)
}

function appendReplayBuffer(session: Pick<TerminalSession, "replayBuffer" | "cols" | "scrollback">, chunk: string) {
  session.replayBuffer = trimReplayBuffer(`${session.replayBuffer}${chunk}`, getReplayBufferLimit(session))
}

function killTerminalProcessTree(subprocess: Bun.Subprocess | null) {
  if (!subprocess) return

  const pid = subprocess.pid
  if (typeof pid !== "number") return

  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL")
      return
    } catch {
      // Fall back to killing only the shell process if group termination fails.
    }
  }

  try {
    subprocess.kill("SIGKILL")
  } catch {
    // Ignore subprocess shutdown errors during disposal.
  }
}

function signalTerminalProcessGroup(subprocess: Bun.Subprocess | null, signal: NodeJS.Signals) {
  if (!subprocess) return false

  const pid = subprocess.pid
  if (typeof pid !== "number") return false

  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal)
      return true
    } catch {
      // Fall back to signaling only the shell if group signaling fails.
    }
  }

  try {
    subprocess.kill(signal)
    return true
  } catch {
    return false
  }
}

function readChildPids(pid: number) {
  if (process.platform !== "linux") {
    return []
  }

  try {
    const text = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim()
    if (!text) {
      return []
    }

    return text
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  } catch {
    return []
  }
}

function signalWrappedTerminalDescendants(subprocess: Bun.Subprocess | null, signal: NodeJS.Signals) {
  if (!subprocess || process.platform !== "linux") {
    return false
  }

  const rootPid = subprocess.pid
  if (typeof rootPid !== "number") {
    return false
  }

  const stack = [...readChildPids(rootPid)]
  if (stack.length === 0) {
    return false
  }

  const leafPids: number[] = []

  while (stack.length > 0) {
    const pid = stack.pop()
    if (typeof pid !== "number") {
      continue
    }

    const childPids = readChildPids(pid)
    if (childPids.length === 0) {
      leafPids.push(pid)
      continue
    }

    stack.push(...childPids)
  }

  let signaled = false

  for (const pid of leafPids) {
    try {
      process.kill(-pid, signal)
      signaled = true
      continue
    } catch {
      // Fall back to signaling just the leaf process when it is not the group leader.
    }

    try {
      process.kill(pid, signal)
      signaled = true
    } catch {
      // Ignore descendant signaling failures and continue trying other leaves.
    }
  }

  return signaled
}

function signalActiveTerminalProcess(session: Pick<TerminalSession, "process" | "wrappedWithScript">, signal: NodeJS.Signals) {
  if (session.wrappedWithScript) {
    return signalWrappedTerminalDescendants(session.process, signal) || signalTerminalProcessGroup(session.process, signal)
  }

  return signalTerminalProcessGroup(session.process, signal)
}

export class TerminalManager {
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly listeners = new Set<(event: TerminalEvent) => void>()

  onEvent(listener: (event: TerminalEvent) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  createTerminal(args: CreateTerminalArgs) {
    if (process.platform === "win32") {
      throw new Error("Embedded terminal is currently supported on macOS/Linux only.")
    }
    if (typeof Bun.Terminal !== "function") {
      throw new Error("Embedded terminal requires Bun 1.3.5+ with Bun.Terminal support.")
    }

    const existing = this.sessions.get(args.terminalId)
    if (existing) {
      existing.scrollback = clampScrollback(args.scrollback)
      existing.cols = normalizeTerminalDimension(args.cols, existing.cols)
      existing.rows = normalizeTerminalDimension(args.rows, existing.rows)
      existing.replayBuffer = trimReplayBuffer(existing.replayBuffer, getReplayBufferLimit(existing))
      existing.terminal.resize(existing.cols, existing.rows)
      signalActiveTerminalProcess(existing, "SIGWINCH")
      return this.snapshotOf(existing)
    }

    const shell = resolveShell()
    const cols = normalizeTerminalDimension(args.cols, DEFAULT_COLS)
    const rows = normalizeTerminalDimension(args.rows, DEFAULT_ROWS)
    const scrollback = clampScrollback(args.scrollback)
    const title = path.basename(shell) || "shell"

    const session: TerminalSession = {
      terminalId: args.terminalId,
      title,
      cwd: args.projectPath,
      shell,
      cols,
      rows,
      scrollback,
      status: "running",
      exitCode: null,
      process: null,
      replayBuffer: "",
      terminal: new Bun.Terminal({
        cols,
        rows,
        name: "xterm-256color",
        data: (_terminal, data) => {
          const chunk = Buffer.from(data).toString("utf8")
          updateFocusReportingState(session, chunk)
          appendReplayBuffer(session, chunk)
          this.emit({
            type: "terminal.output",
            terminalId: args.terminalId,
            data: chunk,
          })
        },
      }),
      wrappedWithScript: false,
      focusReportingEnabled: false,
      modeSequenceTail: "",
    }

    try {
      const spawnCommand = resolveTerminalSpawnCommand(shell)
      session.wrappedWithScript = spawnCommand[0] !== shell
      session.process = Bun.spawn(spawnCommand, {
        cwd: args.projectPath,
        env: createTerminalEnv(),
        terminal: session.terminal,
      })
    } catch (error) {
      session.terminal.close()
      throw error
    }
    void session.process.exited.then((exitCode) => {
      const active = this.sessions.get(args.terminalId)
      if (!active) return
      active.status = "exited"
      active.exitCode = exitCode
      this.emit({
        type: "terminal.exit",
        terminalId: args.terminalId,
        exitCode,
      })
    }).catch((error) => {
      const active = this.sessions.get(args.terminalId)
      if (!active) return
      active.status = "exited"
      active.exitCode = 1
      appendReplayBuffer(active, `\r\n[terminal error] ${error instanceof Error ? error.message : String(error)}\r\n`)
      this.emit({
        type: "terminal.output",
        terminalId: args.terminalId,
        data: `\r\n[terminal error] ${error instanceof Error ? error.message : String(error)}\r\n`,
      })
      this.emit({
        type: "terminal.exit",
        terminalId: args.terminalId,
        exitCode: 1,
      })
    })

    this.sessions.set(args.terminalId, session)
    return this.snapshotOf(session)
  }

  getSnapshot(terminalId: string): TerminalSnapshot | null {
    const session = this.sessions.get(terminalId)
    return session ? this.snapshotOf(session) : null
  }

  write(terminalId: string, data: string) {
    const session = this.sessions.get(terminalId)
    if (!session || session.status === "exited") return

    const filteredData = filterFocusReportInput(data, session.focusReportingEnabled)
    if (!filteredData) return

    let cursor = 0

    while (cursor < filteredData.length) {
      const ctrlCIndex = filteredData.indexOf("\x03", cursor)
      const ctrlDIndex = filteredData.indexOf("\x04", cursor)
      const nextControlIndex = [ctrlCIndex, ctrlDIndex].filter((index) => index >= 0).sort((left, right) => left - right)[0]

      if (nextControlIndex === undefined) {
        session.terminal.write(filteredData.slice(cursor))
        return
      }

      if (nextControlIndex > cursor) {
        session.terminal.write(filteredData.slice(cursor, nextControlIndex))
      }

      if (nextControlIndex === ctrlCIndex) {
        signalActiveTerminalProcess(session, "SIGINT")
        cursor = ctrlCIndex + 1
        continue
      }

      if (session.wrappedWithScript) {
        // `script` does not propagate a raw Ctrl+D byte as prompt EOF reliably, so
        // emulate the shell's prompt-exit path when the wrapper is active.
        session.terminal.write("exit\r")
      } else {
        session.terminal.write("\x04")
      }
      cursor = ctrlDIndex + 1
    }
  }

  resize(terminalId: string, cols: number, rows: number) {
    const session = this.sessions.get(terminalId)
    if (!session) return
    session.cols = normalizeTerminalDimension(cols, session.cols)
    session.rows = normalizeTerminalDimension(rows, session.rows)
    session.terminal.resize(session.cols, session.rows)
    signalActiveTerminalProcess(session, "SIGWINCH")
  }

  close(terminalId: string) {
    const session = this.sessions.get(terminalId)
    if (!session) return

    this.sessions.delete(terminalId)
    killTerminalProcessTree(session.process)
    session.terminal.close()
  }

  closeByCwd(cwd: string) {
    for (const [terminalId, session] of this.sessions.entries()) {
      if (session.cwd !== cwd) continue
      this.close(terminalId)
    }
  }

  closeAll() {
    for (const terminalId of this.sessions.keys()) {
      this.close(terminalId)
    }
  }

  private snapshotOf(session: TerminalSession): TerminalSnapshot {
    return {
      terminalId: session.terminalId,
      title: session.title,
      cwd: session.cwd,
      shell: session.shell,
      cols: session.cols,
      rows: session.rows,
      scrollback: session.scrollback,
      replayBuffer: session.replayBuffer,
      status: session.status,
      exitCode: session.exitCode,
    }
  }

  private emit(event: TerminalEvent) {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

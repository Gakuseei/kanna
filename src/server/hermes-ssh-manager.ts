import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { randomUUID } from "node:crypto"
import type { Readable, Writable } from "node:stream"
import type {
  AskUserQuestionItem,
  HermesSshSettings,
  TranscriptEntry,
  TodoItem,
} from "../shared/types"
import type { HarnessEvent, HarnessToolRequest, HarnessTurn } from "./harness-types"
import {
  type HermesAcpInitializeResponse,
  type HermesAcpJsonRpcResponse,
  type HermesAcpNewSessionResponse,
  type HermesAcpPermissionOption,
  type HermesAcpPromptResponse,
  type HermesAcpRequestId,
  type HermesAcpRequestPermissionRequest,
  type HermesAcpRequestPermissionResponse,
  type HermesAcpSessionNotification,
  type HermesAcpToolCall,
  type HermesAcpToolCallContent,
  type HermesAcpToolCallLocation,
  isHermesAcpJsonRpcResponse,
  isHermesAcpRequestPermissionRequest,
  isHermesAcpSessionNotification,
} from "./hermes-acp-protocol"
import { buildSshArgs } from "./hermes-ssh-settings"

interface HermesSshProcess {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  killed?: boolean
  kill(signal?: NodeJS.Signals | number): void
  on(event: "close", listener: (code: number | null) => void): this
  on(event: "error", listener: (error: Error) => void): this
  once(event: "close", listener: (code: number | null) => void): this
  once(event: "error", listener: (error: Error) => void): this
}

type SpawnHermesSshProcess = (settings: HermesSshSettings) => HermesSshProcess

const HERMES_ACP_HANDSHAKE_TIMEOUT_MS = 15_000

interface PendingRequest<TResult> {
  method: string
  resolve: (value: TResult) => void
  reject: (error: Error) => void
}

interface KnownToolCall {
  toolCallId: string
  title: string
  kind?: HermesAcpToolCall["kind"]
  status?: HermesAcpToolCall["status"]
  content?: HermesAcpToolCallContent[]
  locations?: HermesAcpToolCallLocation[]
  rawInput?: Record<string, unknown>
  rawOutput?: Record<string, unknown>
}

interface PendingPrompt {
  queue: AsyncQueue<HarnessEvent>
  onToolRequest: (request: HarnessToolRequest) => Promise<unknown>
  emittedToolIds: Set<string>
  emittedToolResultIds: Set<string>
  knownToolCalls: Map<string, KnownToolCall>
  todoSequence: number
  loadingSession: boolean
}

interface SessionContext {
  chatId: string
  child: HermesSshProcess
  pendingRequests: Map<HermesAcpRequestId, PendingRequest<unknown>>
  sessionToken: string | null
  pendingPrompt: PendingPrompt | null
  stderrLines: string[]
  closed: boolean
}

export interface StartHermesSessionArgs {
  chatId: string
  settings: HermesSshSettings
  sessionToken: string | null
}

export interface StartHermesPromptArgs {
  chatId: string
  content: string
  model: string
  onToolRequest: (request: HarnessToolRequest) => Promise<unknown>
}

function timestamped<T extends Omit<TranscriptEntry, "_id" | "createdAt">>(
  entry: T,
  createdAt = Date.now()
): TranscriptEntry {
  return {
    _id: randomUUID(),
    createdAt,
    ...entry,
  } as TranscriptEntry
}

function hermesSystemInitEntry(model: string): TranscriptEntry {
  return timestamped({
    kind: "system_init",
    provider: "hermes",
    model,
    tools: ["Hermes ACP"],
    agents: [],
    slashCommands: [],
    mcpServers: [],
  })
}

function parseJsonLine(line: string): unknown | null {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function askUserQuestionFromPermissionRequest(request: HermesAcpRequestPermissionRequest): HarnessToolRequest {
  const toolCall = request.params.toolCall
  const options = request.params.options.map((option) => ({
    label: option.name,
    description: permissionDescription(option),
  }))
  const title = toolCall.title || toolCall.kind || "Approve requested action"
  const details = summarizeToolCall(toolCall)

  const questions: AskUserQuestionItem[] = [{
    id: "decision",
    header: "Permission",
    question: details ? `${title}\n\n${details}` : title,
    options,
  }]

  return {
    tool: {
      kind: "tool",
      toolKind: "ask_user_question",
      toolName: "AskUserQuestion",
      toolId: request.params.toolCall.toolCallId,
      input: { questions },
      rawInput: {
        permissionRequestId: String(request.id),
        options: request.params.options,
      },
    },
  }
}

function permissionDescription(option: HermesAcpPermissionOption) {
  switch (option.kind) {
    case "allow_once":
      return "Allow this action once."
    case "allow_always":
      return "Always allow this type of action."
    case "reject_always":
      return "Always deny this type of action."
    default:
      return "Deny this action."
  }
}

function isTextToolCallContent(
  entry: HermesAcpToolCallContent
): entry is Extract<HermesAcpToolCallContent, { type: "content" }> {
  return entry.type === "content" && entry.content.type === "text"
}

function summarizeToolCall(toolCall: {
  kind?: HermesAcpToolCall["kind"]
  content?: HermesAcpToolCallContent[]
  locations?: HermesAcpToolCallLocation[]
  rawInput?: Record<string, unknown>
}) {
  const details: string[] = []
  if (toolCall.kind) {
    details.push(`Kind: ${toolCall.kind}`)
  }
  const command = typeof toolCall.rawInput?.command === "string" ? toolCall.rawInput.command : null
  if (command) {
    details.push(`Command: ${command}`)
  }
  const query = typeof toolCall.rawInput?.query === "string" ? toolCall.rawInput.query : null
  if (query) {
    details.push(`Query: ${query}`)
  }
  const firstLocation = toolCall.locations?.[0]?.path
  if (firstLocation) {
    details.push(`Path: ${firstLocation}`)
  }
  const firstText = toolCall.content?.find(isTextToolCallContent)
  if (firstText?.content.text) {
    details.push(firstText.content.text)
  }
  return details.join("\n")
}

function toolCallFromKnown(toolCall: KnownToolCall): TranscriptEntry {
  const firstDiff = toolCall.content?.find((item) => item.type === "diff")
  const firstPath = toolCall.locations?.[0]?.path || firstDiff?.path
  const rawInput = toolCall.rawInput ?? {}
  const command = typeof rawInput.command === "string" ? rawInput.command : toolCall.title
  const query = typeof rawInput.query === "string"
    ? rawInput.query
    : typeof rawInput.url === "string"
      ? rawInput.url
      : toolCall.title

  if (toolCall.kind === "execute") {
    return timestamped({
      kind: "tool_call",
      tool: {
        kind: "tool",
        toolKind: "bash",
        toolName: "Bash",
        toolId: toolCall.toolCallId,
        input: { command },
        rawInput,
      },
    })
  }

  if (toolCall.kind === "search" || toolCall.kind === "fetch") {
    return timestamped({
      kind: "tool_call",
      tool: {
        kind: "tool",
        toolKind: "web_search",
        toolName: "WebSearch",
        toolId: toolCall.toolCallId,
        input: { query },
        rawInput,
      },
    })
  }

  if (toolCall.kind === "read" && firstPath) {
    return timestamped({
      kind: "tool_call",
      tool: {
        kind: "tool",
        toolKind: "read_file",
        toolName: "Read",
        toolId: toolCall.toolCallId,
        input: { filePath: firstPath },
        rawInput,
      },
    })
  }

  if (toolCall.kind === "edit" && firstDiff) {
    const oldText = firstDiff.oldText ?? ""
    if (oldText.length > 0) {
      return timestamped({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "edit_file",
          toolName: "Edit",
          toolId: toolCall.toolCallId,
          input: {
            filePath: firstDiff.path,
            oldString: oldText,
            newString: firstDiff.newText,
          },
          rawInput,
        },
      })
    }

    return timestamped({
      kind: "tool_call",
      tool: {
        kind: "tool",
        toolKind: "write_file",
        toolName: "Write",
        toolId: toolCall.toolCallId,
        input: {
          filePath: firstDiff.path,
          content: firstDiff.newText,
        },
        rawInput,
      },
    })
  }

  return timestamped({
    kind: "tool_call",
    tool: {
      kind: "tool",
      toolKind: "unknown_tool",
      toolName: toolCall.title || "HermesTool",
      toolId: toolCall.toolCallId,
      input: {
        payload: {
          kind: toolCall.kind,
          title: toolCall.title,
          locations: toolCall.locations,
          content: toolCall.content,
          rawInput: toolCall.rawInput,
          rawOutput: toolCall.rawOutput,
        },
      },
      rawInput,
    },
  })
}

function toolResultFromKnown(toolCall: KnownToolCall): TranscriptEntry | null {
  if (toolCall.status !== "completed" && toolCall.status !== "failed") {
    return null
  }

  const content = toolCall.content?.length
    ? toolCall.content
    : toolCall.rawOutput ?? toolCall.rawInput ?? toolCall.title

  return timestamped({
    kind: "tool_result",
    toolId: toolCall.toolCallId,
    content,
    isError: toolCall.status === "failed",
  })
}

function todoItems(entries: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>): TodoItem[] {
  return entries.map((entry) => ({
    content: entry.content,
    status: entry.status,
    activeForm: entry.content,
  }))
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private resolvers: Array<(value: IteratorResult<T>) => void> = []
  private done = false

  push(value: T) {
    if (this.done) return
    const resolver = this.resolvers.shift()
    if (resolver) {
      resolver({ value, done: false })
      return
    }
    this.values.push(value)
  }

  finish() {
    if (this.done) return
    this.done = true
    while (this.resolvers.length > 0) {
      this.resolvers.shift()?.({ value: undefined as T, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({ value: this.values.shift() as T, done: false })
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as T, done: true })
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve)
        })
      },
    }
  }
}

export class HermesSshManager {
  private readonly sessions = new Map<string, SessionContext>()
  private readonly spawnProcess: SpawnHermesSshProcess

  constructor(args: { spawnProcess?: SpawnHermesSshProcess } = {}) {
    this.spawnProcess = args.spawnProcess ?? ((settings) =>
      spawn("ssh", buildSshArgs(settings, settings.hermesCommand), {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      }) as unknown as HermesSshProcess)
  }

  async startSession(args: StartHermesSessionArgs) {
    const existing = this.sessions.get(args.chatId)
    if (existing && !existing.closed) {
      return
    }

    if (existing) {
      this.stopSession(args.chatId)
    }

    const child = this.spawnProcess(args.settings)
    const context: SessionContext = {
      chatId: args.chatId,
      child,
      pendingRequests: new Map(),
      sessionToken: null,
      pendingPrompt: null,
      stderrLines: [],
      closed: false,
    }
    this.sessions.set(args.chatId, context)
    this.attachListeners(context)

    try {
      await this.sendRequest<HermesAcpInitializeResponse>(context, "initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: {
            readTextFile: false,
            writeTextFile: false,
          },
          terminal: false,
        },
        clientInfo: {
          name: "kanna",
          version: "0.1.0",
        },
      }, HERMES_ACP_HANDSHAKE_TIMEOUT_MS)

      if (args.sessionToken) {
        await this.sendRequest(context, "session/load", {
          sessionId: args.sessionToken,
          cwd: args.settings.remoteCwd,
          mcpServers: [],
        }, HERMES_ACP_HANDSHAKE_TIMEOUT_MS)
        context.sessionToken = args.sessionToken
        return
      }

      const response = await this.sendRequest<HermesAcpNewSessionResponse>(context, "session/new", {
        cwd: args.settings.remoteCwd,
        mcpServers: [],
      }, HERMES_ACP_HANDSHAKE_TIMEOUT_MS)
      context.sessionToken = response.sessionId
    } catch (error) {
      this.stopSession(args.chatId)
      throw error
    }
  }

  async startPrompt(args: StartHermesPromptArgs): Promise<HarnessTurn> {
    const context = this.requireSession(args.chatId)
    if (!context.sessionToken) {
      throw new Error("Hermes session not initialized")
    }
    if (context.pendingPrompt) {
      throw new Error("Hermes prompt is already running")
    }

    const queue = new AsyncQueue<HarnessEvent>()
    queue.push({ type: "session_token", sessionToken: context.sessionToken })
    queue.push({ type: "transcript", entry: hermesSystemInitEntry(args.model) })

    context.pendingPrompt = {
      queue,
      onToolRequest: args.onToolRequest,
      emittedToolIds: new Set(),
      emittedToolResultIds: new Set(),
      knownToolCalls: new Map(),
      todoSequence: 0,
      loadingSession: false,
    }

    void this.sendRequest<HermesAcpPromptResponse>(context, "session/prompt", {
      sessionId: context.sessionToken,
      prompt: [{ type: "text", text: args.content }],
    }).then((response) => {
      const prompt = context.pendingPrompt
      if (!prompt) return

      prompt.queue.push({
        type: "transcript",
        entry: timestamped({
          kind: "result",
          subtype: response.stopReason === "cancelled" ? "cancelled" : "success",
          isError: false,
          durationMs: 0,
          result: "",
        }),
      })
      prompt.queue.finish()
      context.pendingPrompt = null
    }).catch((error) => {
      const prompt = context.pendingPrompt
      if (!prompt) return

      prompt.queue.push({
        type: "transcript",
        entry: timestamped({
          kind: "result",
          subtype: "error",
          isError: true,
          durationMs: 0,
          result: error instanceof Error ? error.message : String(error),
        }),
      })
      prompt.queue.finish()
      context.pendingPrompt = null
    })

    return {
      provider: "hermes",
      stream: queue,
      interrupt: async () => {
        if (!context.sessionToken) return
        this.writeMessage(context, {
          jsonrpc: "2.0",
          method: "session/cancel",
          params: {
            sessionId: context.sessionToken,
          },
        })
      },
      close: () => {},
    }
  }

  stopSession(chatId: string) {
    const context = this.sessions.get(chatId)
    if (!context) return
    context.closed = true
    context.pendingPrompt?.queue.finish()
    this.sessions.delete(chatId)
    try {
      context.child.kill("SIGKILL")
    } catch {
      // ignore
    }
  }

  stopAll() {
    for (const chatId of this.sessions.keys()) {
      this.stopSession(chatId)
    }
  }

  private requireSession(chatId: string) {
    const context = this.sessions.get(chatId)
    if (!context || context.closed) {
      throw new Error("Hermes session not started")
    }
    return context
  }

  private attachListeners(context: SessionContext) {
    const stdout = createInterface({ input: context.child.stdout })
    void (async () => {
      for await (const line of stdout) {
        const parsed = parseJsonLine(line)
        if (!parsed) continue

        if (isHermesAcpJsonRpcResponse(parsed)) {
          this.handleResponse(context, parsed)
          continue
        }
        if (isHermesAcpSessionNotification(parsed)) {
          void this.handleSessionNotification(context, parsed)
          continue
        }
        if (isHermesAcpRequestPermissionRequest(parsed)) {
          void this.handlePermissionRequest(context, parsed)
        }
      }
    })()

    const stderr = createInterface({ input: context.child.stderr })
    void (async () => {
      for await (const line of stderr) {
        if (line.trim()) {
          context.stderrLines.push(line.trim())
        }
      }
    })()

    context.child.on("error", (error) => {
      this.failContext(context, error.message)
    })

    context.child.on("close", (code) => {
      if (context.closed) return
      queueMicrotask(() => {
        if (context.closed) return
        const message = context.stderrLines.at(-1) || `Hermes ACP exited with code ${code ?? 1}`
        this.failContext(context, message)
      })
    })
  }

  private handleResponse(context: SessionContext, response: HermesAcpJsonRpcResponse) {
    const pending = context.pendingRequests.get(response.id)
    if (!pending) return
    context.pendingRequests.delete(response.id)

    if (response.error) {
      pending.reject(new Error(`${pending.method} failed: ${response.error.message ?? "Unknown error"}`))
      return
    }

    pending.resolve(response.result)
  }

  private async handlePermissionRequest(context: SessionContext, request: HermesAcpRequestPermissionRequest) {
    const prompt = context.pendingPrompt
    if (!prompt) {
      this.writeMessage(context, {
        jsonrpc: "2.0",
        id: request.id,
        result: { outcome: { outcome: "cancelled" } } satisfies HermesAcpRequestPermissionResponse,
      })
      return
    }

    const toolRequest = askUserQuestionFromPermissionRequest(request)
    prompt.queue.push({
      type: "transcript",
      entry: timestamped({
        kind: "tool_call",
        tool: toolRequest.tool,
      }),
    })

    const result = await prompt.onToolRequest(toolRequest)
    const selectedOption = resolvePermissionOutcome(result, request.params.options)
    prompt.queue.push({
      type: "transcript",
      entry: timestamped({
        kind: "tool_result",
        toolId: toolRequest.tool.toolId,
        content: result,
      }),
    })
    this.writeMessage(context, {
      jsonrpc: "2.0",
      id: request.id,
      result: selectedOption
        ? { outcome: { outcome: "selected", optionId: selectedOption.optionId } }
        : { outcome: { outcome: "cancelled" } },
    })
  }

  private async handleSessionNotification(context: SessionContext, notification: HermesAcpSessionNotification) {
    const prompt = context.pendingPrompt
    if (!prompt) return

    const update = notification.params.update
    if (update.sessionUpdate === "agent_message_chunk") {
      if (update.content.type === "text" && update.content.text) {
        prompt.queue.push({
          type: "transcript",
          entry: timestamped({
            kind: "assistant_text",
            text: update.content.text,
            messageId: update.messageId,
          }),
        })
      }
      return
    }

    if (update.sessionUpdate === "agent_thought_chunk") {
      return
    }

    if (update.sessionUpdate === "plan") {
      if (update.entries.length === 0) return
      prompt.todoSequence += 1
      prompt.queue.push({
        type: "transcript",
        entry: timestamped({
          kind: "tool_call",
          tool: {
            kind: "tool",
            toolKind: "todo_write",
            toolName: "TodoWrite",
            toolId: `${notification.params.sessionId}:todo-${prompt.todoSequence}`,
            input: {
              todos: todoItems(update.entries),
            },
            rawInput: {
              plan: update.entries,
            },
          },
        }),
      })
      return
    }

    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      const known = prompt.knownToolCalls.get(update.toolCallId) ?? {
        toolCallId: update.toolCallId,
        title: update.title ?? "Hermes Tool",
      }
      if (update.title) known.title = update.title
      if (update.kind) known.kind = update.kind
      if (update.status) known.status = update.status
      if (update.content) known.content = update.content
      if (update.locations) known.locations = update.locations
      if (update.rawInput) known.rawInput = update.rawInput
      if (update.rawOutput) known.rawOutput = update.rawOutput
      prompt.knownToolCalls.set(update.toolCallId, known)

      if (!prompt.emittedToolIds.has(update.toolCallId)) {
        prompt.emittedToolIds.add(update.toolCallId)
        prompt.queue.push({
          type: "transcript",
          entry: toolCallFromKnown(known),
        })
      }

      const resultEntry = toolResultFromKnown(known)
      if (resultEntry && !prompt.emittedToolResultIds.has(update.toolCallId)) {
        prompt.emittedToolResultIds.add(update.toolCallId)
        prompt.queue.push({
          type: "transcript",
          entry: resultEntry,
        })
      }
    }
  }

  private failContext(context: SessionContext, message: string) {
    if (context.pendingPrompt) {
      context.pendingPrompt.queue.push({
        type: "transcript",
        entry: timestamped({
          kind: "result",
          subtype: "error",
          isError: true,
          durationMs: 0,
          result: message,
        }),
      })
      context.pendingPrompt.queue.finish()
      context.pendingPrompt = null
    }

    for (const pending of context.pendingRequests.values()) {
      pending.reject(new Error(message))
    }
    context.pendingRequests.clear()
    context.closed = true
  }

  private async sendRequest<TResult>(
    context: SessionContext,
    method: string,
    params: unknown,
    timeoutMs?: number
  ): Promise<TResult> {
    const id = randomUUID()
    const promise = new Promise<TResult>((resolve, reject) => {
      context.pendingRequests.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
      })
    })
    this.writeMessage(context, {
      jsonrpc: "2.0",
      id,
      method,
      params,
    })
    if (!timeoutMs) {
      return await promise
    }

    return await Promise.race([
      promise,
      new Promise<TResult>((_, reject) => {
        const timer = setTimeout(() => {
          const pending = context.pendingRequests.get(id)
          if (!pending) {
            return
          }
          context.pendingRequests.delete(id)
          const stderrHint = context.stderrLines.at(-1)
          reject(new Error(
            stderrHint
              ? `${method} timed out waiting for Hermes ACP. Last stderr: ${stderrHint}`
              : `${method} timed out waiting for Hermes ACP.`
          ))
        }, timeoutMs)

        void promise.finally(() => {
          clearTimeout(timer)
        })
      }),
    ])
  }

  private writeMessage(context: SessionContext, message: Record<string, unknown>) {
    context.child.stdin.write(`${JSON.stringify(message)}\n`)
  }
}

function resolvePermissionOutcome(raw: unknown, options: HermesAcpPermissionOption[]) {
  const record = asRecord(raw)
  const answers = asRecord(record?.answers)?.decision
  const selectedLabel = Array.isArray((answers as { answers?: unknown[] } | undefined)?.answers)
    ? (answers as { answers: unknown[] }).answers[0]
    : undefined
  if (typeof selectedLabel !== "string") {
    return null
  }
  return options.find((option) => option.name === selectedLabel) ?? null
}

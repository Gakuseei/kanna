export type HermesAcpRequestId = string | number

export interface HermesAcpJsonRpcResponse<TResult = unknown> {
  jsonrpc: "2.0"
  id: HermesAcpRequestId
  result?: TResult
  error?: {
    code?: number
    message?: string
  }
}

export interface HermesAcpInitializeParams {
  protocolVersion: number
  clientCapabilities?: {
    fs?: {
      readTextFile: boolean
      writeTextFile: boolean
    }
    terminal?: boolean
  }
  clientInfo?: {
    name: string
    version: string
  }
}

export interface HermesAcpInitializeResponse {
  protocolVersion: number
  agentCapabilities?: {
    loadSession?: boolean
    sessionCapabilities?: {
      list?: object
      fork?: object
    }
  }
  agentInfo?: {
    name?: string
    version?: string
  }
}

export interface HermesAcpSessionRequest {
  sessionId: string
  cwd: string
  mcpServers: []
}

export interface HermesAcpNewSessionResponse {
  sessionId: string
}

export interface HermesAcpTextContentBlock {
  type: "text"
  text: string
}

export interface HermesAcpPromptRequest {
  sessionId: string
  prompt: HermesAcpTextContentBlock[]
}

export interface HermesAcpPromptResponse {
  stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    thoughtTokens?: number
  }
}

export interface HermesAcpToolCallLocation {
  path: string
  line?: number
}

export interface HermesAcpToolCallContentText {
  type: "content"
  content: {
    type: "text"
    text: string
  }
}

export interface HermesAcpToolCallContentDiff {
  type: "diff"
  path: string
  oldText?: string | null
  newText: string
}

export interface HermesAcpToolCallContentTerminal {
  type: "terminal"
  terminalId: string
}

export type HermesAcpToolCallContent =
  | HermesAcpToolCallContentText
  | HermesAcpToolCallContentDiff
  | HermesAcpToolCallContentTerminal

export interface HermesAcpToolCall {
  sessionUpdate: "tool_call"
  toolCallId: string
  title: string
  kind?: "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "other"
  status?: "pending" | "in_progress" | "completed" | "failed"
  content?: HermesAcpToolCallContent[]
  locations?: HermesAcpToolCallLocation[]
  rawInput?: Record<string, unknown>
  rawOutput?: Record<string, unknown>
}

export interface HermesAcpToolCallUpdate {
  sessionUpdate: "tool_call_update"
  toolCallId: string
  title?: string | null
  kind?: HermesAcpToolCall["kind"]
  status?: HermesAcpToolCall["status"]
  content?: HermesAcpToolCallContent[]
  locations?: HermesAcpToolCallLocation[]
  rawInput?: Record<string, unknown>
  rawOutput?: Record<string, unknown>
}

export interface HermesAcpPlanEntry {
  content: string
  status: "pending" | "in_progress" | "completed"
}

export interface HermesAcpPlanUpdate {
  sessionUpdate: "plan"
  entries: HermesAcpPlanEntry[]
}

export interface HermesAcpMessageChunk {
  sessionUpdate: "agent_message_chunk" | "user_message_chunk" | "agent_thought_chunk"
  content: HermesAcpTextContentBlock
  messageId?: string
}

export interface HermesAcpAvailableCommandsUpdate {
  sessionUpdate: "available_commands_update"
  availableCommands: Array<{
    name: string
    description?: string
  }>
}

export interface HermesAcpCurrentModeUpdate {
  sessionUpdate: "current_mode_update"
  currentModeId: string
}

export type HermesAcpSessionUpdate =
  | HermesAcpToolCall
  | HermesAcpToolCallUpdate
  | HermesAcpPlanUpdate
  | HermesAcpMessageChunk
  | HermesAcpAvailableCommandsUpdate
  | HermesAcpCurrentModeUpdate

export interface HermesAcpSessionNotification {
  jsonrpc: "2.0"
  method: "session/update"
  params: {
    sessionId: string
    update: HermesAcpSessionUpdate
  }
}

export interface HermesAcpPermissionOption {
  optionId: string
  name: string
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always"
}

export interface HermesAcpRequestPermissionRequest {
  jsonrpc: "2.0"
  id: HermesAcpRequestId
  method: "session/request_permission"
  params: {
    sessionId: string
    toolCall: {
      toolCallId: string
      title?: string | null
      kind?: HermesAcpToolCall["kind"]
      status?: HermesAcpToolCall["status"]
      content?: HermesAcpToolCallContent[]
      locations?: HermesAcpToolCallLocation[]
      rawInput?: Record<string, unknown>
      rawOutput?: Record<string, unknown>
    }
    options: HermesAcpPermissionOption[]
  }
}

export interface HermesAcpRequestPermissionResponse {
  outcome:
    | {
        outcome: "selected"
        optionId: string
      }
    | {
        outcome: "cancelled"
      }
}

export function isHermesAcpJsonRpcResponse(value: unknown): value is HermesAcpJsonRpcResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Partial<HermesAcpJsonRpcResponse>
  return candidate.jsonrpc === "2.0" && "id" in candidate && ("result" in candidate || "error" in candidate)
}

export function isHermesAcpSessionNotification(value: unknown): value is HermesAcpSessionNotification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Partial<HermesAcpSessionNotification>
  return candidate.jsonrpc === "2.0" && candidate.method === "session/update"
}

export function isHermesAcpRequestPermissionRequest(value: unknown): value is HermesAcpRequestPermissionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Partial<HermesAcpRequestPermissionRequest>
  return candidate.jsonrpc === "2.0" && candidate.method === "session/request_permission" && "id" in candidate
}

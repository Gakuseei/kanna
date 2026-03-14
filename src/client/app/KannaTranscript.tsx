import React, { useMemo } from "react"
import type { AskUserQuestionItem, ProcessedToolCall } from "../components/messages/types"
import type { Message } from "../lib/parseTranscript"
import { UserMessage } from "../components/messages/UserMessage"
import { RawJsonMessage } from "../components/messages/RawJsonMessage"
import { SystemMessage } from "../components/messages/SystemMessage"
import { AccountInfoMessage } from "../components/messages/AccountInfoMessage"
import { TextMessage } from "../components/messages/TextMessage"
import { AskUserQuestionMessage } from "../components/messages/AskUserQuestionMessage"
import { ExitPlanModeMessage } from "../components/messages/ExitPlanModeMessage"
import { TodoWriteMessage } from "../components/messages/TodoWriteMessage"
import { ToolCallMessage } from "../components/messages/ToolCallMessage"
import { ResultMessage } from "../components/messages/ResultMessage"
import { InterruptedMessage } from "../components/messages/InterruptedMessage"
import { CompactBoundaryMessage, ContextClearedMessage } from "../components/messages/CompactBoundaryMessage"
import { CompactSummaryMessage } from "../components/messages/CompactSummaryMessage"
import { StatusMessage } from "../components/messages/StatusMessage"
import { CollapsedToolGroup } from "../components/messages/CollapsedToolGroup"

const SPECIAL_TOOL_NAMES = new Set(["AskUserQuestion", "ExitPlanMode", "TodoWrite"])

type RenderItem =
  | { type: "single"; message: Message; index: number }
  | { type: "tool-group"; messages: Message[]; startIndex: number }

function isCollapsibleToolCall(message: Message) {
  if (message.processed?.kind !== "tool") return false
  const toolName = (message.processed as ProcessedToolCall).toolName
  return !SPECIAL_TOOL_NAMES.has(toolName)
}

function groupMessages(messages: Message[]): RenderItem[] {
  const result: RenderItem[] = []
  let index = 0

  while (index < messages.length) {
    const message = messages[index]
    if (isCollapsibleToolCall(message)) {
      const group: Message[] = [message]
      const startIndex = index
      index += 1
      while (index < messages.length && isCollapsibleToolCall(messages[index])) {
        group.push(messages[index])
        index += 1
      }
      if (group.length >= 2) {
        result.push({ type: "tool-group", messages: group, startIndex })
      } else {
        result.push({ type: "single", message, index: startIndex })
      }
      continue
    }

    result.push({ type: "single", message, index })
    index += 1
  }

  return result
}

interface KannaTranscriptProps {
  messages: Message[]
  isLoading: boolean
  localPath?: string
  latestToolIds: Record<string, string | null>
  onAskUserQuestionSubmit: (
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: Record<string, string>
  ) => void
  onExitPlanModeConfirm: (toolUseId: string, confirmed: boolean, clearContext?: boolean, message?: string) => void
}

export function KannaTranscript({
  messages,
  isLoading,
  localPath,
  latestToolIds,
  onAskUserQuestionSubmit,
  onExitPlanModeConfirm,
}: KannaTranscriptProps) {
  const renderItems = useMemo(() => groupMessages(messages), [messages])

  function renderMessage(message: Message, index: number): React.ReactNode {
    if (message.role === "user") {
      return <UserMessage key={message.id} content={message.content} />
    }

    const processed = message.processed
    if (!processed) {
      return <RawJsonMessage key={message.id} json={message.content} />
    }

    switch (processed.kind) {
      case "system": {        
        // const isFirst = messages.findIndex((entry) => entry.processed?.kind === "system") === index
        // return isFirst ? <SystemMessage key={message.id} message={processed} rawJson={message.rawJson} /> : null
        return <SystemMessage key={message.id} message={processed} rawJson={message.rawJson} /> 

      }
      case "account_info": {
        const isFirst = messages.findIndex((entry) => entry.processed?.kind === "account_info") === index
        return isFirst ? <AccountInfoMessage key={message.id} message={processed} /> : null
      }
      case "text":
        return <TextMessage key={message.id} message={processed} />
      case "tool":
        if (processed.toolName === "AskUserQuestion") {
          return (
            <AskUserQuestionMessage
              key={message.id}
              message={processed}
              onSubmit={onAskUserQuestionSubmit}
              isLatest={processed.id === latestToolIds.AskUserQuestion}
            />
          )
        }
        if (processed.toolName === "ExitPlanMode") {
          return (
            <ExitPlanModeMessage
              key={message.id}
              message={processed}
              onConfirm={onExitPlanModeConfirm}
              isLatest={processed.id === latestToolIds.ExitPlanMode}
            />
          )
        }
        if (processed.toolName === "TodoWrite") {
          if (processed.id !== latestToolIds.TodoWrite) return null
          return <TodoWriteMessage key={message.id} message={processed} />
        }
        return (
          <ToolCallMessage
            key={message.id}
            message={processed}
            isLoading={isLoading}
            localPath={localPath}
          />
        )
      case "result": {
        const nextMessage = messages[index + 1]
        const previousMessage = messages[index - 1]
        if (nextMessage?.processed?.kind === "context_cleared" || previousMessage?.processed?.kind === "context_cleared") {
          return null
        }
        return <ResultMessage key={message.id} message={processed} />
      }
      case "interrupted":
        return <InterruptedMessage key={message.id} message={processed} />
      case "compact_boundary":
        return <CompactBoundaryMessage key={message.id} />
      case "context_cleared":
        return <ContextClearedMessage key={message.id} />
      case "compact_summary":
        return <CompactSummaryMessage key={message.id} message={processed} />
      case "status":
        return index === messages.length - 1 ? <StatusMessage key={message.id} message={processed} /> : null
    }
  }

  return (
    <>
      {renderItems.map((item) => {
        if (item.type === "tool-group") {
          return (
            <div key={`group-${item.startIndex}`} className="group relative">
              <CollapsedToolGroup messages={item.messages} isLoading={isLoading} localPath={localPath} />
            </div>
          )
        }

        const rendered = renderMessage(item.message, item.index)
        if (!rendered) return null
        return (
          <div key={item.message.id} id={`msg-${item.message.id}`} className="group relative">
            {rendered}
          </div>
        )
      })}
    </>
  )
}

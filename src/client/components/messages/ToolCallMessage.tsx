import { UserRound, X } from "lucide-react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { ProcessedToolCall } from "./types"
import { MetaRow, MetaLabel, MetaCodeBlock, ExpandableRow, VerticalLineContainer, getToolIcon, markdownWithHeadingsComponents } from "./shared"
import { useMemo } from "react"
import { stripWorkspacePath, stripOutputsPath } from "../../lib/pathUtils"
import { AnimatedShinyText } from "../ui/animated-shiny-text"
import { toTitleCase } from "../../lib/formatters"
import { FileContentView } from "./FileContentView"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface Props {
  message: ProcessedToolCall
  isLoading?: boolean
  outputsUrl?: string | null
  localPath?: string | null
}

export function ToolCallMessage({ message, isLoading = false, outputsUrl, localPath }: Props) {
  const hasResult = message.result !== undefined
  const showLoadingState = !hasResult && isLoading

  const name = useMemo(() => {
    if (message.toolName === "Skill") {
      return message.input.skill
    }
    if (message.toolName === "Glob") {
      return `Search files ${message.input.pattern === '**/*' ? 'in all directories' : `matching ${message.input.pattern}`}`
    }
    if (message.toolName === "Grep") {
      const pattern = message.input.pattern
      const outputMode = (message.input as Record<string, unknown>).output_mode as string | undefined
      if (outputMode === "count") {
        return `Count \`${pattern}\` occurrences`
      }
      if (outputMode === "content") {
        return `Find \`${pattern}\` in text`
      }
      return `Find \`${pattern}\` in files`
    }
    if (message.toolName === "Bash") {
      return `${message.input.description as string || message.input.command as string || "Bash"}`
    }
    if (message.toolName === "WebSearch") {
      return message.input.query as string || "Web Search"
    }
    if (message.toolName === "Read") {
      return `Read ${stripWorkspacePath(message.input.file_path as string, localPath)}`
    }
    if (message.toolName === "Write") {
      return `Write ${stripWorkspacePath(message.input.file_path as string, localPath)}`
    }
    if (message.toolName === "Edit") {
      return `Edit ${stripWorkspacePath(message.input.file_path as string, localPath)}`
    }
    // Context tools: read/edit/write
    if (message.toolName === "mcp__lever__read_db_context") {
      const connName = message.input.connection_name as string | undefined
      return connName ? `Read ${toTitleCase(connName)} Context` : "Read DB Context"
    }
    if (message.toolName === "mcp__lever__edit_db_context") {
      const connName = message.input.connection_name as string | undefined
      return connName ? `Edit ${toTitleCase(connName)} Context` : "Edit DB Context"
    }
    if (message.toolName === "mcp__lever__write_db_context") {
      const connName = message.input.connection_name as string | undefined
      return connName ? `Update ${toTitleCase(connName)} Context` : "Update DB Context"
    }
    // Database query tools: mcp__db__{db}_query → Query {db} {description}
    const dbMatch = message.toolName.match(/^mcp__db__(.+)_query$/)
    if (dbMatch) {
      const desc = message.input.description as string | undefined
      return desc ? `${desc} from ${toTitleCase(dbMatch[1])}` : `Query ${dbMatch[1]}`
    }
    const mcpMatch = message.toolName.match(/^mcp__(.+?)__(.+)$/)
    if (mcpMatch) {
      return `${toTitleCase(mcpMatch[2])} from ${toTitleCase(mcpMatch[1])}`
    }
    return message.input.subagent_type || message.toolName
  }, [message.input, message.toolName, localPath])

  const isAgent = useMemo(() => message.input.subagent_type !== undefined, [message.input])
  const description = useMemo(() => {
    if (message.toolName === "Skill") {
      return message.input.skill
    }
  }, [message.input, message.toolName])

  const isBashTool = message.toolName === "Bash";
  const isDbQueryTool = /^mcp__db__.+_query$/.test(message.toolName);
  const isWriteTool = message.toolName === "Write";
  const isWriteContextTool = message.toolName === "mcp__lever__write_db_context";
  const isEditContextTool = message.toolName === "mcp__lever__edit_db_context";
  const isEditTool = message.toolName === "Edit";
  const isReadTool = message.toolName === "Read";
  const isReadContextTool = message.toolName === "mcp__lever__read_db_context";

  const { result, outputFile } = useMemo(() => {
    let parsed: Record<string, unknown> = {}
    if (typeof message.result === "string") {
      try {
        parsed = JSON.parse(message.result)
      } catch {
        // Result is not valid JSON (e.g., error string), wrap it
        parsed = { output: message.result }
      }
    } else {
      parsed = message.result ?? {}
    }
    return {
      result: parsed,
      outputFile: stripOutputsPath(parsed['fullOutputFile'] as string | undefined, localPath),
    }
  }, [message.result, localPath])

  const contextResultText = useMemo(() => {
    if (!isReadContextTool || !message.result) return ""
    try {
      const content = typeof message.result === "string" ? JSON.parse(message.result) : message.result
      if (Array.isArray(content)) return content.map((c: any) => c.text).join("\n")
    } catch { /* fall through */ }
    return typeof message.result === "string" ? message.result : JSON.stringify(message.result, null, 2)
  }, [message.result, isReadContextTool])

  return (
    <MetaRow className="w-full">
      <ExpandableRow
        expandedContent={
          <VerticalLineContainer className="my-4 text-sm">
            <div className="flex flex-col gap-2">
              {isWriteContextTool ? (
                <div>
                  <span className="font-medium text-muted-foreground">Context ({((message.input.context as string).length / 1000).toFixed(1)}/20kb)</span>
                  <div className="my-1 max-h-64 md:max-h-[50vh] overflow-auto rounded-lg border border-border bg-muted p-3 prose prose-sm dark:prose-invert max-w-none">
                    <Markdown remarkPlugins={[remarkGfm]} components={markdownWithHeadingsComponents}>
                      {message.input.context as string}
                    </Markdown>
                  </div>
                </div>
              ) : isEditTool ? (
                <FileContentView
                  content=""
                  isDiff
                  oldString={message.input.old_string as string}
                  newString={message.input.new_string as string}
                />
              ) : isEditContextTool ? (
                <div className="flex flex-col gap-2">
                  <MetaCodeBlock label="Find" copyText={message.input.old_string as string}>
                    {message.input.old_string as string}
                  </MetaCodeBlock>
                  <MetaCodeBlock label="Replace" copyText={message.input.new_string as string}>
                    {message.input.new_string as string}
                  </MetaCodeBlock>
                </div>
              ) : !isReadTool && !isWriteTool && (
                <MetaCodeBlock label={
                  isBashTool ? (
                    <span className="flex items-center gap-2 w-full">
                      <span>Command</span>
                      {!!message.input.timeout && (
                        <span className="text-muted-foreground">timeout: {String(message.input.timeout)}ms</span>
                      )}
                      {!!message.input.run_in_background && (
                        <span className="text-muted-foreground">background</span>
                      )}
                    </span>
                  ) : isDbQueryTool ? (
                    <span className="flex items-center gap-2 w-full">
                      <span>Query</span>
                      {!!message.input.timeout && (
                        <span className="text-muted-foreground">timeout: {String(message.input.timeout)}s</span>
                      )}
                    </span>
                  ) : isWriteTool ? "Contents" : "Input"
                } copyText={isBashTool ? (message.input.command as string) : isDbQueryTool ? (message.input.query as string) : isWriteTool ? (message.input.content as string) : JSON.stringify(message.input, null, 2)}>
                  {isBashTool ? (message.input.command as string) : isDbQueryTool ? message.input.query : isWriteTool ? (message.input.content as string) : JSON.stringify(message.input, null, 2)}
                </MetaCodeBlock>
              )}
              {hasResult && isReadContextTool && (
                <div>
                  <span className="font-medium text-muted-foreground">Context ({(contextResultText.length / 1000).toFixed(1)}/20kb)</span>
                  <div className="my-1 max-h-64 md:max-h-[50vh] overflow-auto rounded-lg border border-border bg-muted p-3 prose prose-sm dark:prose-invert max-w-none">
                    <Markdown remarkPlugins={[remarkGfm]} components={markdownWithHeadingsComponents}>
                      {contextResultText}
                    </Markdown>
                  </div>
                </div>
              )}
              {hasResult && isReadTool && !message.isError && (
                <FileContentView
                  content={typeof message.result === "string" ? message.result : JSON.stringify(message.result, null, 2)}
                />
              )}
              {isWriteTool && !message.isError && (
                <FileContentView
                  content={message.input.content as string}
                />
              )}
              {hasResult && !isDbQueryTool && !isReadContextTool && !isReadTool && !(isWriteTool && !message.isError) && !(isEditTool && !message.isError) && (
                <MetaCodeBlock label={message.isError ? "Error" : "Result"} copyText={typeof message.result === "string" ? message.result : JSON.stringify(message.result, null, 2)}>
                  {typeof message.result === "string" ? message.result : JSON.stringify(message.result, null, 2)}
                </MetaCodeBlock>
              )}
              {hasResult && isDbQueryTool && (
                <MetaCodeBlock label={
                  message.isError ? "Error" : (
                    <span className="flex items-center justify-between w-full">
                      <span>Preview{result['isOutputTruncated'] ? " (~25kb)" : ""}</span>
                      {outputFile && outputsUrl && (
                        <a
                          href={`${outputsUrl}/api/file?path=${encodeURIComponent(outputFile)}`}
                          download
                          onClick={(e) => e.stopPropagation()}
                          target="_blank"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Download ({formatBytes(result['fullOutputLength'] as number)})
                        </a>
                      )}
                    </span>
                  )
                } copyText={(result['output'] as string).replaceAll("\\n", "\n")}>
                  {(result['output'] as string).replaceAll("\\n", "\n")}
                </MetaCodeBlock>
              )}
            </div>
          </VerticalLineContainer>
        }
      >

        <div className={`w-5 h-5 relative flex items-center justify-center`}>
          {(() => {
            if (message.isError) {
              return <X className="size-4 text-destructive" />
            }
            if (isAgent) {
              return <UserRound className="size-4 text-muted-icon" />
            }
            const Icon = getToolIcon(message.toolName)

            return <Icon className="size-4 text-muted-icon" />
          })()}
        </div>
        <MetaLabel className="text-left transition-opacity duration-200 truncate">
          <AnimatedShinyText
            animate={showLoadingState}
            shimmerWidth={Math.max(20, (description || name)?.length ?? 33 * 3)}
          >
            {description || name}
          </AnimatedShinyText>
        </MetaLabel>



      </ExpandableRow>
    </MetaRow>
  )
}

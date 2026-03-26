import { Flower, Code, FolderOpen, Menu, PanelLeft, PanelRight, Settings2, SquarePen, Terminal } from "lucide-react"
import { Button } from "../ui/button"
import { CardHeader } from "../ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { HotkeyTooltip, HotkeyTooltipContent, HotkeyTooltipTrigger } from "../ui/tooltip"
import { cn } from "../../lib/utils"

interface Props {
  sidebarCollapsed: boolean
  onOpenSidebar: () => void
  onExpandSidebar: () => void
  onNewChat: () => void
  localPath?: string
  embeddedTerminalVisible?: boolean
  onToggleEmbeddedTerminal?: () => void
  rightSidebarVisible?: boolean
  onToggleRightSidebar?: () => void
  onOpenExternal?: (action: "open_finder" | "open_editor") => void
  editorLabel?: string
  transcriptAutoScroll: boolean
  onTranscriptAutoScrollChange: (enabled: boolean) => void
  finderShortcut?: string[]
  editorShortcut?: string[]
  terminalShortcut?: string[]
  rightSidebarShortcut?: string[]
}

export function ChatNavbar({
  sidebarCollapsed,
  onOpenSidebar,
  onExpandSidebar,
  onNewChat,
  localPath,
  embeddedTerminalVisible = false,
  onToggleEmbeddedTerminal,
  rightSidebarVisible = false,
  onToggleRightSidebar,
  onOpenExternal,
  editorLabel = "Editor",
  transcriptAutoScroll,
  onTranscriptAutoScrollChange,
  finderShortcut,
  editorShortcut,
  terminalShortcut,
  rightSidebarShortcut,
}: Props) {
  return (
    <CardHeader
      className={cn(
        "absolute top-0 md:top-2 left-0 right-0 z-10 px-2.5 pr-4 border-border/0 md:pb-0 flex items-center justify-center",
        sidebarCollapsed ? "md:px-2.5 md:pr-4" : "md:px-4 md:pr-4",
        "backdrop-blur-lg md:backdrop-blur-none bg-gradient-to-b from-background md:from-transparent border-b border-x-0 md:border-x border-border md:border-none"
      )}
    >
      <div className="relative flex items-center gap-2 w-full">
        <div className="flex items-center gap-1 flex-shrink-0 border-l border-border/0">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onOpenSidebar}
          >
            <Menu className="h-5 w-5" />
          </Button>
          {sidebarCollapsed && (
            <>
              <div className="flex items-center justify-center w-[40px] h-[40px]">
                <Flower className="h-4 w-4 sm:h-5 sm:w-5 text-logo ml-1 hidden md:block" />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="hidden md:flex"
                onClick={onExpandSidebar}
                title="Expand sidebar"
              >
                <PanelLeft className="h-5 w-5" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewChat}
            title="Compose"
          >
            <SquarePen className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 min-w-0" />

        <div className="flex items-center gap-1 flex-shrink-0">
          {localPath && (onOpenExternal || onToggleEmbeddedTerminal) && (
            <>
              {onOpenExternal ? (
                <HotkeyTooltip>
                  <HotkeyTooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onOpenExternal("open_finder")}
                      title="Open in Finder"
                      className="border border-border/0"
                    >
                      <FolderOpen className="h-4.5 w-4.5" />
                    </Button>
                  </HotkeyTooltipTrigger>
                  <HotkeyTooltipContent side="bottom" shortcut={finderShortcut} />
                </HotkeyTooltip>
              ) : null}
              {onToggleEmbeddedTerminal ? (
                <HotkeyTooltip>
                  <HotkeyTooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={onToggleEmbeddedTerminal}
                      className={cn(
                        "border border-border/0",
                        embeddedTerminalVisible && "text-white"
                      )}
                    >
                      <Terminal className="h-4.5 w-4.5" />
                    </Button>
                  </HotkeyTooltipTrigger>
                  <HotkeyTooltipContent side="bottom" shortcut={terminalShortcut} />
                </HotkeyTooltip>
              ) : null}
              {onOpenExternal ? (
                <HotkeyTooltip>
                  <HotkeyTooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onOpenExternal("open_editor")}
                      title={`Open in ${editorLabel}`}
                      className="border border-border/0"
                    >
                      <Code className="h-4.5 w-4.5" />
                    </Button>
                  </HotkeyTooltipTrigger>
                  <HotkeyTooltipContent side="bottom" shortcut={editorShortcut} />
                </HotkeyTooltip>
              ) : null}
            </>
          )}
          {onToggleRightSidebar ? (
            <HotkeyTooltip>
              <HotkeyTooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleRightSidebar}
                  className={cn(
                    "border border-border/0",
                    rightSidebarVisible && "text-white"
                  )}
                >
                  <PanelRight className="h-4.5 w-4.5" />
                </Button>
              </HotkeyTooltipTrigger>
              <HotkeyTooltipContent side="bottom" shortcut={rightSidebarShortcut} />
            </HotkeyTooltip>
          ) : null}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="border border-border/0"
                title="Chat settings"
              >
                <Settings2 className="h-4.5 w-4.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Chat settings</div>
                  <div className="text-xs text-muted-foreground">
                    Control whether the transcript follows new messages automatically.
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={transcriptAutoScroll}
                  onClick={() => onTranscriptAutoScrollChange(!transcriptAutoScroll)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Auto-scroll</div>
                    <div className="text-xs text-muted-foreground">
                      {transcriptAutoScroll ? "Follow incoming messages" : "Keep the current scroll position"}
                    </div>
                  </div>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors",
                      transcriptAutoScroll ? "border-primary bg-primary" : "border-border bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 h-4.5 w-4.5 rounded-full bg-background shadow-sm transition-transform",
                        transcriptAutoScroll ? "translate-x-5" : "translate-x-0.5"
                      )}
                    />
                  </span>
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </CardHeader>
  )
}

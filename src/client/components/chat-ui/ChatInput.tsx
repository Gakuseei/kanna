import { memo, useCallback, useEffect, useRef, useState } from "react"
import { ArrowUp, Brain, Gauge, ListTodo, Sparkles, UnlockIcon, Zap } from "lucide-react"
import { Button } from "../ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { Textarea } from "../ui/textarea"
import { cn } from "../../lib/utils"
import { useIsStandalone } from "../../hooks/useIsStandalone"
import { useChatInputStore } from "../../stores/chatInputStore"
import { useChatPreferencesStore, type ModelOption } from "../../stores/chatPreferencesStore"

function PopoverMenuItem({
  onClick,
  selected,
  icon,
  label,
  description,
  disabled,
}: {
  onClick: () => void
  selected: boolean
  icon: React.ReactNode
  label: string
  description: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-2 p-2 border border-border/0 rounded-lg text-left transition-opacity",
        selected ? "bg-muted border-border" : "hover:opacity-60",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      {icon}
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </button>
  )
}

function InputPopover({
  trigger,
  triggerClassName,
  children,
}: {
  trigger: React.ReactNode
  triggerClassName?: string
  children: React.ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 text-sm rounded-md transition-colors text-muted-foreground [&>svg]:shrink-0",
            "hover:bg-muted/50",
            triggerClassName
          )}
        >
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-64 p-1">
        <div className="space-y-1">{children}</div>
      </PopoverContent>
    </Popover>
  )
}

const MODEL_ICONS: Record<ModelOption, typeof Sparkles> = {
  opus: Sparkles,
  sonnet: Zap,
  haiku: Brain,
}

const MODEL_LABELS: Record<ModelOption, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
}

const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
}

interface Props {
  onSubmit: (value: string, options?: { model?: string; effort?: string; planMode?: boolean }) => Promise<void>
  onCancel?: () => void
  disabled: boolean
  canCancel?: boolean
  chatId?: string | null
}

export const ChatInput = memo(function ChatInput({
  onSubmit,
  onCancel,
  disabled,
  canCancel,
  chatId,
}: Props) {
  const { getDraft, setDraft, clearDraft } = useChatInputStore()
  const { model, effort, planMode, setModel, setEffort, setPlanMode } = useChatPreferencesStore()
  const [value, setValue] = useState(() => (chatId ? getDraft(chatId) : ""))
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isStandalone = useIsStandalone()

  const autoResize = useCallback(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${element.scrollHeight}px`
  }, [])

  useEffect(() => {
    autoResize()
  }, [value, autoResize])

  useEffect(() => {
    window.addEventListener("resize", autoResize)
    return () => window.removeEventListener("resize", autoResize)
  }, [autoResize])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [chatId])

  async function handleSubmit() {
    if (!value.trim()) return
    const nextValue = value

    setValue("")
    if (chatId) clearDraft(chatId)
    if (textareaRef.current) textareaRef.current.style.height = "auto"

    try {
      await onSubmit(nextValue, { model, effort, planMode })
    } catch (error) {
      console.error("[ChatInput] Submit failed:", error)
      setValue(nextValue)
      if (chatId) setDraft(chatId, nextValue)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault()
      setPlanMode(!planMode)
      return
    }

    if (event.key === "Escape" && canCancel) {
      event.preventDefault()
      onCancel?.()
      return
    }

    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0
    if (event.key === "Enter" && !event.shiftKey && !canCancel && !isTouchDevice) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  const ModelIcon = MODEL_ICONS[model]

  return (
    <div className={cn("p-3 pt-0 md:pb-2", isStandalone && "px-5 pb-5")}>
      <div className="flex items-end gap-2 max-w-[840px] mx-auto border dark:bg-card/40 backdrop-blur-lg border-border rounded-[29px] pr-1.5">
        <Textarea
          ref={textareaRef}
          placeholder="Ask something..."
          value={value}
          autoFocus
          rows={1}
          onChange={(event) => {
            setValue(event.target.value)
            if (chatId) setDraft(chatId, event.target.value)
            autoResize()
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className="flex-1 text-base p-3 md:p-4 pl-4.5 md:pl-6 resize-none max-h-[200px] outline-none bg-transparent border-0 shadow-none"
        />
        <Button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault()
            if (canCancel) {
              onCancel?.()
            } else if (!disabled && value.trim()) {
              void handleSubmit()
            }
          }}
          disabled={!canCancel && (disabled || !value.trim())}
          size="icon"
          className="flex-shrink-0 bg-slate-600 text-white dark:bg-white dark:text-slate-900 rounded-full cursor-pointer h-10 w-10 md:h-11 md:w-11 mb-1 -mr-0.5 md:mr-0 md:mb-1.5 touch-manipulation disabled:bg-white/60 disabled:text-slate-700"
        >
          {canCancel ? (
            <div className="w-3 h-3 md:w-4 md:h-4 rounded-xs bg-current" />
          ) : (
            <ArrowUp className="h-5 w-5 md:h-6 md:w-6" />
          )}
        </Button>
      </div>

      <div className="flex justify-center items-center gap-0.5 max-w-[840px] mx-auto mt-2 animate-fade-in">
        <InputPopover
          trigger={
            <>
              <ModelIcon className="h-3.5 w-3.5" />
              <span>{MODEL_LABELS[model]}</span>
            </>
          }
        >
          <PopoverMenuItem
            onClick={() => setModel("opus")}
            selected={model === "opus"}
            icon={<Sparkles className="h-4 w-4 text-muted-foreground" />}
            label="Opus"
            description="Highest capability, deep reasoning"
          />
          <PopoverMenuItem
            onClick={() => setModel("sonnet")}
            selected={model === "sonnet"}
            icon={<Zap className="h-4 w-4 text-muted-foreground" />}
            label="Sonnet"
            description="Balanced speed and intelligence"
          />
          <PopoverMenuItem
            onClick={() => setModel("haiku")}
            selected={model === "haiku"}
            icon={<Brain className="h-4 w-4 text-muted-foreground" />}
            label="Haiku"
            description="Fastest responses, lightweight tasks"
          />
        </InputPopover>

        <InputPopover
          trigger={
            <>
              <Gauge className="h-3.5 w-3.5" />
              <span>{EFFORT_LABELS[effort]}</span>
            </>
          }
          triggerClassName={effort === "max" ? "text-amber-400 dark:text-amber-300" : undefined}
        >
          <PopoverMenuItem
            onClick={() => setEffort("low")}
            selected={effort === "low"}
            icon={<Gauge className="h-4 w-4 text-muted-foreground" />}
            label="Low"
            description="Minimal thinking, fastest responses"
          />
          <PopoverMenuItem
            onClick={() => setEffort("medium")}
            selected={effort === "medium"}
            icon={<Gauge className="h-4 w-4 text-muted-foreground" />}
            label="Medium"
            description="Moderate thinking for typical tasks"
          />
          <PopoverMenuItem
            onClick={() => setEffort("high")}
            selected={effort === "high"}
            icon={<Gauge className="h-4 w-4 text-muted-foreground" />}
            label="High"
            description="Deep reasoning for complex problems"
          />
          <PopoverMenuItem
            onClick={() => setEffort("max")}
            selected={effort === "max"}
            disabled={model !== "opus"}
            icon={<Gauge className="h-4 w-4 text-muted-foreground" />}
            label="Max"
            description={model !== "opus" ? "Only available with Opus" : "Maximum effort, deepest reasoning"}
          />
        </InputPopover>

        <InputPopover
          trigger={planMode ? (
            <>
              <ListTodo className="h-3.5 w-3.5" />
              <span>Plan Mode</span>
            </>
          ) : (
            <>
              <UnlockIcon className="h-3.5 w-3.5" />
              <span>Full Access</span>
            </>
          )}
          triggerClassName={planMode ? "text-blue-400 dark:text-blue-300" : undefined}
        >
          <PopoverMenuItem
            onClick={() => setPlanMode(false)}
            selected={!planMode}
            icon={<UnlockIcon className="h-4 w-4 text-muted-foreground" />}
            label="Full Access"
            description="Claude can read and edit files"
          />
          <PopoverMenuItem
            onClick={() => setPlanMode(true)}
            selected={planMode}
            icon={<ListTodo className="h-4 w-4 text-muted-foreground" />}
            label="Plan Mode"
            description="Claude can only read, not edit"
          />
          <p className="text-xs text-muted-foreground/90 px-2 py-2">
            Press <kbd className="px-1 mx-0.5 py-0.5 text-[12px] bg-muted/90 rounded font-mono">shift+tab</kbd> to toggle
          </p>
        </InputPopover>
      </div>
    </div>
  )
})

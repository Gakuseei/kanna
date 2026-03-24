import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react"
import { ArrowUp, Paperclip, Sparkles, X } from "lucide-react"
import {
  type AgentProvider,
  type ClaudeReasoningEffort,
  type CodexReasoningEffort,
  type ModelOptions,
  type ProviderCatalogEntry,
  type SkillCatalogEntry,
} from "../../../shared/types"
import {
  clipboardHasTextPayload,
  createPendingComposerImages,
  extractImageFiles,
  extractImageFilesFromDataTransfer,
  readNativeClipboardImageFile,
  revokePendingComposerImages,
  stageImages,
  type PendingComposerImage,
} from "../../lib/imageUploads"
import type { KannaSocket } from "../../app/socket"
import { Button } from "../ui/button"
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover"
import { Textarea } from "../ui/textarea"
import { cn } from "../../lib/utils"
import { useIsStandalone } from "../../hooks/useIsStandalone"
import { useChatInputStore } from "../../stores/chatInputStore"
import { type ComposerState, useChatPreferencesStore } from "../../stores/chatPreferencesStore"
import { CHAT_INPUT_ATTRIBUTE, focusNextChatInput } from "../../app/chatFocusPolicy"
import { ChatPreferenceControls } from "./ChatPreferenceControls"
import { filterSkills, getSkillTriggerMatch, insertSkillToken } from "./skill-picker"

interface SubmitOptions {
  provider?: AgentProvider
  model?: string
  modelOptions?: ModelOptions
  planMode?: boolean
  attachments?: Array<{ stagedId: string }>
}

interface Props {
  onSubmit: (value: string, options?: SubmitOptions) => Promise<void>
  onCancel?: () => void
  socket: KannaSocket
  disabled: boolean
  canCancel?: boolean
  chatId?: string | null
  activeProvider: AgentProvider | null
  availableProviders: ProviderCatalogEntry[]
}

function logChatInput(message: string, details?: unknown) {
  if (details === undefined) {
    console.info(`[ChatInput] ${message}`)
    return
  }

  console.info(`[ChatInput] ${message}`, details)
}

function clampIndex(index: number, length: number) {
  if (length === 0) {
    return 0
  }

  return ((index % length) + length) % length
}

function createLockedComposerState(
  provider: AgentProvider,
  composerState: ComposerState,
  providerDefaults: ReturnType<typeof useChatPreferencesStore.getState>["providerDefaults"]
): ComposerState {
  if (provider === "claude") {
    if (composerState.provider === "claude") {
      return {
        provider: "claude",
        model: composerState.model,
        modelOptions: { ...composerState.modelOptions },
        planMode: composerState.planMode,
      }
    }

    return {
      provider: "claude",
      model: providerDefaults.claude.model,
      modelOptions: { ...providerDefaults.claude.modelOptions },
      planMode: providerDefaults.claude.planMode,
    }
  }

  if (composerState.provider === "codex") {
    return {
      provider: "codex",
      model: composerState.model,
      modelOptions: { ...composerState.modelOptions },
      planMode: composerState.planMode,
    }
  }

  return {
    provider: "codex",
    model: providerDefaults.codex.model,
    modelOptions: { ...providerDefaults.codex.modelOptions },
    planMode: providerDefaults.codex.planMode,
  }
}

export function resolvePlanModeState(args: {
  providerLocked: boolean
  planMode: boolean
  selectedProvider: AgentProvider
  composerState: ComposerState
  providerDefaults: ReturnType<typeof useChatPreferencesStore.getState>["providerDefaults"]
  lockedComposerState: ComposerState | null
}) {
  if (!args.providerLocked) {
    return {
      composerPlanMode: args.planMode,
      lockedComposerState: args.lockedComposerState,
    }
  }

  const nextLockedState = args.lockedComposerState
    ?? createLockedComposerState(args.selectedProvider, args.composerState, args.providerDefaults)

  return {
    composerPlanMode: args.composerState.planMode,
    lockedComposerState: {
      ...nextLockedState,
      planMode: args.planMode,
    } satisfies ComposerState,
  }
}

const ChatInputInner = forwardRef<HTMLTextAreaElement, Props>(function ChatInput({
  onSubmit,
  onCancel,
  socket,
  disabled,
  canCancel,
  chatId,
  activeProvider,
  availableProviders,
}, forwardedRef) {
  const { getDraft, setDraft, clearDraft } = useChatInputStore()
  const {
    composerState,
    providerDefaults,
    setComposerModel,
    setComposerModelOptions,
    setComposerPlanMode,
    resetComposerFromProvider,
  } = useChatPreferencesStore()
  const [value, setValue] = useState(() => (chatId ? getDraft(chatId) : ""))
  const [pendingImages, setPendingImages] = useState<PendingComposerImage[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isDraggingImages, setIsDraggingImages] = useState(false)
  const [isTextareaFocused, setIsTextareaFocused] = useState(false)
  const [caretPosition, setCaretPosition] = useState<number | null>(0)
  const [availableSkills, setAvailableSkills] = useState<SkillCatalogEntry[] | null>(null)
  const [isLoadingSkills, setIsLoadingSkills] = useState(false)
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0)
  const [dismissedSkillQuery, setDismissedSkillQuery] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingImagesRef = useRef<PendingComposerImage[]>([])
  const nativePasteFallbackRef = useRef<number | null>(null)
  const pendingSelectionRef = useRef<number | null>(null)
  const isStandalone = useIsStandalone()
  const [lockedComposerState, setLockedComposerState] = useState<ComposerState | null>(() => (
    activeProvider ? createLockedComposerState(activeProvider, composerState, providerDefaults) : null
  ))

  const providerLocked = activeProvider !== null
  const providerPrefs = providerLocked
    ? lockedComposerState ?? createLockedComposerState(activeProvider, composerState, providerDefaults)
    : composerState
  const selectedProvider = providerLocked ? activeProvider : composerState.provider
  const providerConfig = availableProviders.find((provider) => provider.id === selectedProvider) ?? availableProviders[0]
  const showPlanMode = providerConfig?.supportsPlanMode ?? false
  const hasDraftContent = value.trim().length > 0 || pendingImages.length > 0
  const skillTriggerMatch = useMemo(() => getSkillTriggerMatch(value, caretPosition), [caretPosition, value])
  const activeSkillQuery = skillTriggerMatch ? `${skillTriggerMatch.start}:${skillTriggerMatch.end}:${skillTriggerMatch.query}` : null
  const isSkillPickerEnabled = selectedProvider === "codex" && !disabled
  const filteredSkills = useMemo(
    () => filterSkills(availableSkills ?? [], skillTriggerMatch?.query ?? ""),
    [availableSkills, skillTriggerMatch?.query],
  )
  const isSkillPickerOpen = (
    isSkillPickerEnabled
    && isTextareaFocused
    && skillTriggerMatch !== null
    && activeSkillQuery !== dismissedSkillQuery
  )
  const activeSkill = filteredSkills[selectedSkillIndex] ?? null

  const autoResize = useCallback(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${element.scrollHeight}px`
  }, [])

  const setTextareaRefs = useCallback((node: HTMLTextAreaElement | null) => {
    textareaRef.current = node

    if (!forwardedRef) return
    if (typeof forwardedRef === "function") {
      forwardedRef(node)
      return
    }

    forwardedRef.current = node
  }, [forwardedRef])

  const syncCaretPosition = useCallback((nextPosition: number | null) => {
    setCaretPosition(nextPosition)
  }, [])

  useEffect(() => {
    pendingImagesRef.current = pendingImages
  }, [pendingImages])

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

  useEffect(() => {
    if (activeProvider === null) {
      setLockedComposerState(null)
      return
    }

    setLockedComposerState(createLockedComposerState(activeProvider, composerState, providerDefaults))
  }, [activeProvider, chatId])

  useEffect(() => {
    logChatInput("resolved provider state", {
      chatId: chatId ?? null,
      activeProvider,
      composerProvider: composerState.provider,
      composerModel: composerState.model,
      effectiveProvider: providerPrefs.provider,
      effectiveModel: providerPrefs.model,
      selectedProvider,
      providerLocked,
      lockedComposerProvider: lockedComposerState?.provider ?? null,
    })
  }, [activeProvider, chatId, composerState.model, composerState.provider, lockedComposerState?.provider, providerLocked, providerPrefs.model, providerPrefs.provider, selectedProvider])

  useEffect(() => () => {
    revokePendingComposerImages(pendingImagesRef.current)
  }, [])

  useEffect(() => () => {
    if (nativePasteFallbackRef.current !== null) {
      window.clearTimeout(nativePasteFallbackRef.current)
    }
  }, [])

  useEffect(() => {
    if (pendingSelectionRef.current === null) {
      return
    }

    const nextSelection = pendingSelectionRef.current
    pendingSelectionRef.current = null
    const element = textareaRef.current
    if (!element) {
      return
    }

    element.focus()
    element.setSelectionRange(nextSelection, nextSelection)
    syncCaretPosition(nextSelection)
  }, [syncCaretPosition, value])

  useEffect(() => {
    if (!isSkillPickerOpen || availableSkills !== null) {
      return
    }

    let cancelled = false
    setIsLoadingSkills(true)

    socket.command<SkillCatalogEntry[]>({ type: "skills.list" })
      .then((skills) => {
        if (!cancelled) {
          setAvailableSkills(skills)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAvailableSkills([])
          setSubmitError(error instanceof Error ? error.message : String(error))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSkills(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [availableSkills, isSkillPickerOpen, socket])

  useEffect(() => {
    if (!isSkillPickerOpen) {
      setSelectedSkillIndex(0)
      return
    }

    setSelectedSkillIndex((current) => clampIndex(current, filteredSkills.length))
  }, [filteredSkills.length, isSkillPickerOpen])

  useEffect(() => {
    if (activeSkillQuery !== dismissedSkillQuery) {
      setDismissedSkillQuery(null)
    }
  }, [activeSkillQuery, dismissedSkillQuery])

  function setReasoningEffort(reasoningEffort: string) {
    if (providerLocked) {
      setLockedComposerState((current) => {
        const next = current ?? createLockedComposerState(selectedProvider, composerState, providerDefaults)
        if (next.provider === "claude") {
          return {
            ...next,
            modelOptions: { ...next.modelOptions, reasoningEffort: reasoningEffort as ClaudeReasoningEffort },
          }
        }

        return {
          ...next,
          modelOptions: { ...next.modelOptions, reasoningEffort: reasoningEffort as CodexReasoningEffort },
        }
      })
      return
    }

    if (selectedProvider === "claude") {
      setComposerModelOptions({ reasoningEffort: reasoningEffort as ClaudeReasoningEffort })
      return
    }

    setComposerModelOptions({ reasoningEffort: reasoningEffort as CodexReasoningEffort })
  }

  function setEffectivePlanMode(planMode: boolean) {
    const nextState = resolvePlanModeState({
      providerLocked,
      planMode,
      selectedProvider,
      composerState,
      providerDefaults,
      lockedComposerState,
    })

    if (nextState.lockedComposerState !== lockedComposerState) {
      setLockedComposerState(nextState.lockedComposerState)
    }
    if (nextState.composerPlanMode !== composerState.planMode) {
      setComposerPlanMode(nextState.composerPlanMode)
    }
  }

  function toggleEffectivePlanMode() {
    setEffectivePlanMode(!providerPrefs.planMode)
  }

  function clearPendingImages() {
    revokePendingComposerImages(pendingImagesRef.current)
    pendingImagesRef.current = []
    setPendingImages([])
  }

  function removePendingImage(id: string) {
    setPendingImages((current) => {
      const removed = current.filter((image) => image.id === id)
      revokePendingComposerImages(removed)
      const next = current.filter((image) => image.id !== id)
      pendingImagesRef.current = next
      return next
    })
  }

  async function addPendingFiles(files: File[]) {
    if (files.length === 0) {
      return
    }

    try {
      const nextImages = await createPendingComposerImages(files)
      setPendingImages((current) => {
        const next = [...current, ...nextImages]
        pendingImagesRef.current = next
        return next
      })
      setSubmitError(null)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error))
    }
  }

  function clearNativePasteFallback() {
    if (nativePasteFallbackRef.current === null) {
      return
    }

    window.clearTimeout(nativePasteFallbackRef.current)
    nativePasteFallbackRef.current = null
  }

  async function addNativeClipboardImage(showEmptyError = false) {
    const file = await readNativeClipboardImageFile()
    if (!file) {
      if (showEmptyError) {
        setSubmitError("Clipboard does not contain a supported image.")
      }
      return false
    }

    await addPendingFiles([file])
    return true
  }

  function scheduleNativeClipboardFallback() {
    clearNativePasteFallback()
    nativePasteFallbackRef.current = window.setTimeout(() => {
      nativePasteFallbackRef.current = null
      void addNativeClipboardImage()
    }, 60)
  }

  async function handleSubmit() {
    if (!hasDraftContent || isSubmitting) return

    if (selectedProvider === "claude" && pendingImages.length > 0) {
      setSubmitError("Images are currently supported only for Codex chats.")
      return
    }

    const nextValue = value
    let modelOptions: ModelOptions
    if (providerPrefs.provider === "claude") {
      modelOptions = { claude: { ...providerPrefs.modelOptions } }
    } else {
      modelOptions = { codex: { ...providerPrefs.modelOptions } }
    }

    const submitOptions: SubmitOptions = {
      provider: selectedProvider,
      model: providerPrefs.model,
      modelOptions,
      planMode: showPlanMode ? providerPrefs.planMode : false,
    }

    logChatInput("submit settings", {
      chatId: chatId ?? null,
      activeProvider,
      composerProvider: providerPrefs.provider,
      submitOptions,
      pendingImages: pendingImages.length,
    })

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      if (pendingImages.length > 0) {
        const staged = await stageImages(pendingImages.map((image) => image.file))
        submitOptions.attachments = staged.map((image) => ({ stagedId: image.stagedId }))
      }

      await onSubmit(nextValue, submitOptions)
      setValue("")
      if (chatId) clearDraft(chatId)
      if (textareaRef.current) textareaRef.current.style.height = "auto"
      clearPendingImages()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[ChatInput] Submit failed:", error)
      setSubmitError(message)
      if (chatId) {
        setDraft(chatId, nextValue)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setValue(event.target.value)
    if (chatId) setDraft(chatId, event.target.value)
    syncCaretPosition(event.target.selectionStart)
    autoResize()
    if (submitError) {
      setSubmitError(null)
    }
  }

  function insertSelectedSkillToken(skill: SkillCatalogEntry) {
    if (!skillTriggerMatch) {
      return
    }

    const nextValue = insertSkillToken(value, skillTriggerMatch, skill.id)
    const nextCaretPosition = skillTriggerMatch.start + skill.id.length + 2
    setValue(nextValue)
    if (chatId) {
      setDraft(chatId, nextValue)
    }
    pendingSelectionRef.current = nextCaretPosition
    setSelectedSkillIndex(0)
    setSubmitError(null)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isSkillPickerOpen) {
      if (event.key === "ArrowDown" && filteredSkills.length > 0) {
        event.preventDefault()
        setSelectedSkillIndex((current) => clampIndex(current + 1, filteredSkills.length))
        return
      }

      if (event.key === "ArrowUp" && filteredSkills.length > 0) {
        event.preventDefault()
        setSelectedSkillIndex((current) => clampIndex(current - 1, filteredSkills.length))
        return
      }

      if (event.key === "Enter" && activeSkill) {
        event.preventDefault()
        insertSelectedSkillToken(activeSkill)
        return
      }

      if (event.key === "Escape") {
        event.preventDefault()
        setSelectedSkillIndex(0)
        setDismissedSkillQuery(activeSkillQuery)
        return
      }
    }

    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v") {
      scheduleNativeClipboardFallback()
    }

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault()
      focusNextChatInput(textareaRef.current, document)
      return
    }

    if (event.key === "Tab" && event.shiftKey && showPlanMode) {
      event.preventDefault()
      toggleEffectivePlanMode()
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

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    clearNativePasteFallback()

    const files = extractImageFilesFromDataTransfer(event.clipboardData)
    if (files.length === 0) {
      if (!clipboardHasTextPayload(event.clipboardData)) {
        event.preventDefault()
        void addNativeClipboardImage(true)
      }
      return
    }

    event.preventDefault()
    void addPendingFiles(files)
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? extractImageFiles(event.target.files) : []
    void addPendingFiles(files)
    event.target.value = ""
  }

  function handleComposerDragEnter(event: DragEvent<HTMLDivElement>) {
    if (extractImageFiles(event.dataTransfer.files).length === 0) {
      return
    }

    event.preventDefault()
    setIsDraggingImages(true)
  }

  function handleComposerDragOver(event: DragEvent<HTMLDivElement>) {
    if (extractImageFiles(event.dataTransfer.files).length === 0) {
      return
    }

    event.preventDefault()
    if (!isDraggingImages) {
      setIsDraggingImages(true)
    }
  }

  function handleComposerDragLeave(event: DragEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return
    }
    setIsDraggingImages(false)
  }

  function handleComposerDrop(event: DragEvent<HTMLDivElement>) {
    const files = extractImageFiles(event.dataTransfer.files)
    if (files.length === 0) {
      setIsDraggingImages(false)
      return
    }

    event.preventDefault()
    setIsDraggingImages(false)
    void addPendingFiles(files)
  }

  return (
    <div className={cn("p-3 pt-0 md:pb-2", isStandalone && "px-5 pb-5")}>
      <Popover open={isSkillPickerOpen}>
        <PopoverAnchor asChild>
          <div
            className={cn(
              "relative max-w-[840px] mx-auto overflow-hidden border border-border rounded-[29px] dark:bg-card/40 transition-colors",
              isDraggingImages && "border-primary/70 bg-primary/6"
            )}
            onDragEnter={handleComposerDragEnter}
            onDragOver={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
          >
            {pendingImages.length > 0 ? (
              <div className="border-b border-border/70 px-3 md:px-4 pt-3 pb-2.5">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {pendingImages.map((image) => (
                    <div
                      key={image.id}
                      className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted/40"
                    >
                      <img
                        src={image.previewUrl}
                        alt={image.file.name}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${image.file.name}`}
                        onClick={() => removePendingImage(image.id)}
                        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex items-end gap-2 pr-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />

              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Attach images"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || isSubmitting || canCancel}
                className="mb-1 ml-1.5 h-10 w-10 shrink-0 rounded-full text-muted-foreground md:mb-1.5 md:h-11 md:w-11"
              >
                <Paperclip className="h-4.5 w-4.5" />
              </Button>

              <Textarea
                ref={setTextareaRefs}
                placeholder="Build something..."
                value={value}
                autoFocus
                {...{ [CHAT_INPUT_ATTRIBUTE]: "" }}
                rows={1}
                onChange={handleTextChange}
                onPaste={handlePaste}
                onKeyDown={handleKeyDown}
                onSelect={(event) => syncCaretPosition(event.currentTarget.selectionStart)}
                onClick={(event) => syncCaretPosition(event.currentTarget.selectionStart)}
                onFocus={(event) => {
                  setIsTextareaFocused(true)
                  syncCaretPosition(event.currentTarget.selectionStart)
                }}
                onBlur={() => {
                  setIsTextareaFocused(false)
                }}
                disabled={disabled || isSubmitting}
                aria-autocomplete={isSkillPickerEnabled ? "list" : undefined}
                aria-expanded={isSkillPickerOpen ? "true" : "false"}
                aria-controls={isSkillPickerOpen ? "skill-picker-listbox" : undefined}
                className="flex-1 text-base p-3 md:p-4 resize-none max-h-[200px] outline-none bg-transparent border-0 shadow-none"
              />

              <Button
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault()
                  if (canCancel) {
                    onCancel?.()
                  } else if (!disabled && hasDraftContent) {
                    void handleSubmit()
                  }
                }}
                disabled={!canCancel && (disabled || isSubmitting || !hasDraftContent)}
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

            {isDraggingImages ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[29px] border-2 border-dashed border-primary/60 bg-background/70 text-sm font-medium text-foreground">
                Drop images to attach
              </div>
            ) : null}
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          side="top"
          sideOffset={14}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="w-[min(36rem,calc(100vw-2.5rem))] rounded-2xl border-border bg-popover p-2 shadow-xl"
        >
          <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
            <div className="inline-flex items-center gap-2">
              <Sparkles className="size-3.5" aria-hidden="true" />
              <span>Skills</span>
            </div>
            <span className="font-mono tabular-nums">
              {skillTriggerMatch ? `$${skillTriggerMatch.query}` : "$"}
            </span>
          </div>

          <div
            id="skill-picker-listbox"
            role="listbox"
            aria-label="Available skills"
            className="mt-1 max-h-72 overflow-y-auto"
          >
            {isLoadingSkills ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">Loading local skills…</div>
            ) : filteredSkills.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">No matching skills found.</div>
            ) : (
              <ul className="space-y-1">
                {filteredSkills.map((skill, index) => {
                  const isActive = index === selectedSkillIndex

                  return (
                    <li key={`${skill.source}:${skill.id}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        className={cn(
                          "w-full rounded-xl px-3 py-2 text-left transition-colors",
                          isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                        )}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          insertSelectedSkillToken(skill)
                        }}
                        onMouseEnter={() => setSelectedSkillIndex(index)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{skill.label}</span>
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[11px] uppercase text-muted-foreground">
                            Skill
                          </span>
                        </div>
                        <div className="mt-1 flex items-start justify-between gap-3">
                          <p className="line-clamp-2 text-sm text-muted-foreground">{skill.description}</p>
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">${skill.id}</span>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {submitError ? (
        <p className="max-w-[840px] mx-auto mt-2 px-1 text-sm text-destructive">
          {submitError}
        </p>
      ) : null}

      <ChatPreferenceControls
        availableProviders={availableProviders}
        selectedProvider={selectedProvider}
        providerLocked={providerLocked}
        model={providerPrefs.model}
        modelOptions={providerPrefs.modelOptions}
        onProviderChange={(provider) => {
          if (providerLocked) return
          resetComposerFromProvider(provider)
        }}
        onModelChange={(_, model) => {
          if (providerLocked) {
            setLockedComposerState((current) => {
              const next = current ?? createLockedComposerState(selectedProvider, composerState, providerDefaults)
              return { ...next, model }
            })
            return
          }

          setComposerModel(model)
        }}
        onClaudeReasoningEffortChange={(effort) => setReasoningEffort(effort)}
        onCodexReasoningEffortChange={(effort) => setReasoningEffort(effort)}
        onCodexFastModeChange={(fastMode) => {
          if (providerLocked) {
            setLockedComposerState((current) => {
              const next = current ?? createLockedComposerState(selectedProvider, composerState, providerDefaults)
              if (next.provider === "claude") return next
              return {
                ...next,
                modelOptions: { ...next.modelOptions, fastMode },
              }
            })
            return
          }

          setComposerModelOptions({ fastMode })
        }}
        planMode={providerPrefs.planMode}
        onPlanModeChange={setEffectivePlanMode}
        includePlanMode={showPlanMode}
        className="max-w-[840px] mx-auto mt-2"
      />
    </div>
  )
})

export const ChatInput = memo(ChatInputInner)

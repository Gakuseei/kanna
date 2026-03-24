import { afterEach, describe, expect, test } from "bun:test"
import { getChatInputKeyboardAction, resolvePlanModeState } from "./ChatInput"
import { useChatPreferencesStore } from "../../stores/chatPreferencesStore"

const INITIAL_STATE = useChatPreferencesStore.getInitialState()

afterEach(() => {
  useChatPreferencesStore.setState(INITIAL_STATE)
})

describe("resolvePlanModeState", () => {
  test("updates composer plan mode when the provider is not locked", () => {
    const result = resolvePlanModeState({
      providerLocked: false,
      planMode: true,
      selectedProvider: "claude",
      composerState: INITIAL_STATE.composerState,
      providerDefaults: INITIAL_STATE.providerDefaults,
      lockedComposerState: null,
    })

    expect(result).toEqual({
      composerPlanMode: true,
      lockedComposerState: null,
    })
  })

  test("updates only the locked state when the provider is locked", () => {
    const result = resolvePlanModeState({
      providerLocked: true,
      planMode: true,
      selectedProvider: "claude",
      composerState: {
        provider: "claude",
        model: "opus",
        modelOptions: { reasoningEffort: "high" },
        planMode: false,
      },
      providerDefaults: INITIAL_STATE.providerDefaults,
      lockedComposerState: null,
    })

    expect(result.composerPlanMode).toBe(false)
    expect(result.lockedComposerState).toEqual({
      provider: "claude",
      model: "opus",
      modelOptions: { reasoningEffort: "high" },
      planMode: true,
    })
  })

  test("reuses existing locked state instead of resetting to provider defaults", () => {
    const result = resolvePlanModeState({
      providerLocked: true,
      planMode: false,
      selectedProvider: "claude",
      composerState: {
        provider: "claude",
        model: "haiku",
        modelOptions: { reasoningEffort: "low" },
        planMode: true,
      },
      providerDefaults: {
        ...INITIAL_STATE.providerDefaults,
        claude: {
          model: "sonnet",
          modelOptions: { reasoningEffort: "max" },
          planMode: true,
        },
      },
      lockedComposerState: {
        provider: "claude",
        model: "opus",
        modelOptions: { reasoningEffort: "high" },
        planMode: true,
      },
    })

    expect(result.composerPlanMode).toBe(true)
    expect(result.lockedComposerState).toEqual({
      provider: "claude",
      model: "opus",
      modelOptions: { reasoningEffort: "high" },
      planMode: false,
    })
  })
})

describe("getChatInputKeyboardAction", () => {
  test("treats Tab as focus-next when shift is not pressed", () => {
    expect(getChatInputKeyboardAction({
      key: "Tab",
      code: "Tab",
      shiftKey: false,
      showPlanMode: true,
    })).toBe("focus_next")
  })

  test("toggles plan mode for Shift+Tab", () => {
    expect(getChatInputKeyboardAction({
      key: "Tab",
      code: "Tab",
      shiftKey: true,
      showPlanMode: true,
    })).toBe("toggle_plan_mode")
  })

  test("toggles plan mode for ISO_Left_Tab on Linux-style keyboards", () => {
    expect(getChatInputKeyboardAction({
      key: "ISO_Left_Tab",
      code: "Tab",
      shiftKey: true,
      showPlanMode: true,
    })).toBe("toggle_plan_mode")
  })

  test("ignores reverse tab when plan mode is unavailable", () => {
    expect(getChatInputKeyboardAction({
      key: "ISO_Left_Tab",
      code: "Tab",
      shiftKey: true,
      showPlanMode: false,
    })).toBeNull()
  })
})

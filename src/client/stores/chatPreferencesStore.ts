import { create } from "zustand"
import { persist } from "zustand/middleware"

export type ModelOption = "opus" | "sonnet" | "haiku"
export type EffortOption = "low" | "medium" | "high" | "max"

interface ChatPreferencesState {
  model: ModelOption
  effort: EffortOption
  planMode: boolean
  setModel: (model: ModelOption) => void
  setEffort: (effort: EffortOption) => void
  setPlanMode: (planMode: boolean) => void
}

export const useChatPreferencesStore = create<ChatPreferencesState>()(
  persist(
    (set) => ({
      model: "opus",
      effort: "high",
      planMode: false,

      setModel: (model) =>
        set((state) => {
          // "max" effort is only available for Opus — downgrade to "high" when switching away
          if (model !== "opus" && state.effort === "max") {
            return { model, effort: "high" }
          }
          return { model }
        }),

      setEffort: (effort) => set({ effort }),

      setPlanMode: (planMode) => set({ planMode }),
    }),
    {
      name: "chat-preferences",
    }
  )
)

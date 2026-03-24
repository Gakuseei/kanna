import { describe, expect, test } from "bun:test"
import { filterSkills, getSkillTriggerMatch, insertSkillToken } from "./skill-picker"

describe("getSkillTriggerMatch", () => {
  test("opens on a bare dollar token", () => {
    expect(getSkillTriggerMatch("$", 1)).toEqual({ start: 0, end: 1, query: "" })
  })

  test("matches the active skill query", () => {
    expect(getSkillTriggerMatch("Please use $br", 14)).toEqual({ start: 11, end: 14, query: "br" })
  })

  test("ignores dollar signs inside words", () => {
    expect(getSkillTriggerMatch("cost$br", 7)).toBeNull()
  })
})

describe("insertSkillToken", () => {
  test("replaces the active token", () => {
    expect(insertSkillToken("Try $br now", { start: 4, end: 7, query: "br" }, "brainstorm")).toBe("Try $brainstorm  now")
  })
})

describe("filterSkills", () => {
  const skills = [
    { id: "brainstorm", label: "Brainstorm", description: "Plan large changes", source: "codex" as const },
    { id: "baseline-ui", label: "Baseline UI", description: "Keep UI work tidy", source: "agents" as const },
    { id: "memory-sync", label: "Memory Sync", description: "Work with memory", source: "codex" as const },
  ]

  test("prioritizes prefix matches", () => {
    expect(filterSkills(skills, "br").map((entry) => entry.id)).toEqual(["brainstorm"])
  })

  test("uses descriptions as a fallback match source", () => {
    expect(filterSkills(skills, "memory").map((entry) => entry.id)).toEqual(["memory-sync"])
  })
})

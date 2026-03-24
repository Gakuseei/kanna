import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { listInstalledSkills } from "./skills"

function writeSkill(rootDir: string, folderName: string, contents: string) {
  const skillDir = path.join(rootDir, folderName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(path.join(skillDir, "SKILL.md"), contents)
}

describe("listInstalledSkills", () => {
  test("reads codex and agent skills from disk", () => {
    const homeDir = mkdtempSync(path.join(os.tmpdir(), "kanna-skills-"))

    writeSkill(path.join(homeDir, ".codex", "skills"), "brainstorm", `---
name: brainstorm
description: Plan larger work.
---

# Brainstorm
`)
    writeSkill(path.join(homeDir, ".agents", "skills"), "baseline-ui", `---
name: baseline-ui
description: Keep UI work tidy.
---

# Baseline UI
`)

    expect(listInstalledSkills(homeDir)).toEqual([
      {
        id: "baseline-ui",
        label: "Baseline UI",
        description: "Keep UI work tidy.",
        source: "agents",
      },
      {
        id: "brainstorm",
        label: "Brainstorm",
        description: "Plan larger work.",
        source: "codex",
      },
    ])
  })

  test("prefers codex entries when ids overlap", () => {
    const homeDir = mkdtempSync(path.join(os.tmpdir(), "kanna-skills-"))

    writeSkill(path.join(homeDir, ".codex", "skills"), "brainstorm", `---
name: brainstorm
description: Preferred version.
---

# Brainstorm
`)
    writeSkill(path.join(homeDir, ".agents", "skills"), "brainstorm", `---
name: brainstorm
description: Fallback version.
---

# Brainstorm
`)

    expect(listInstalledSkills(homeDir)).toEqual([
      {
        id: "brainstorm",
        label: "Brainstorm",
        description: "Preferred version.",
        source: "codex",
      },
    ])
  })

  test("parses folded descriptions and heading fallbacks", () => {
    const homeDir = mkdtempSync(path.join(os.tmpdir(), "kanna-skills-"))

    writeSkill(path.join(homeDir, ".agents", "skills"), "fixing-metadata", `---
name: fixing-metadata
description: >
  Audit metadata.
  Keep previews correct.
---

Body without heading.
`)

    expect(listInstalledSkills(homeDir)).toEqual([
      {
        id: "fixing-metadata",
        label: "Fixing Metadata",
        description: "Audit metadata. Keep previews correct.",
        source: "agents",
      },
    ])
  })
})

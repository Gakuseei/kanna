import { existsSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { SkillCatalogEntry } from "../shared/types"

type SkillSource = SkillCatalogEntry["source"]

function stripMatchingQuotes(value: string) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function prettifySkillName(value: string) {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
}

function parseFrontmatter(markdown: string) {
  if (!markdown.startsWith("---\n")) {
    return { data: {} as Record<string, string>, body: markdown }
  }

  const endIndex = markdown.indexOf("\n---", 4)
  if (endIndex === -1) {
    return { data: {} as Record<string, string>, body: markdown }
  }

  const data: Record<string, string> = {}
  const frontmatter = markdown.slice(4, endIndex)
  const body = markdown.slice(endIndex + 4).replace(/^\n/, "")
  const lines = frontmatter.split("\n")
  let multilineKey: string | null = null

  for (const line of lines) {
    if (multilineKey) {
      if (/^[ \t]+/.test(line)) {
        const nextValue = line.trim()
        data[multilineKey] = data[multilineKey]
          ? `${data[multilineKey]} ${nextValue}`.trim()
          : nextValue
        continue
      }
      multilineKey = null
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) {
      continue
    }

    const [, key, rawValue] = match
    if (rawValue === ">" || rawValue === "|") {
      data[key] = ""
      multilineKey = key
      continue
    }

    data[key] = stripMatchingQuotes(rawValue)
  }

  return { data, body }
}

function extractHeadingLabel(markdownBody: string) {
  const match = markdownBody.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : null
}

function readSkillCatalogEntry(skillDir: string, source: SkillSource): SkillCatalogEntry | null {
  const skillFile = path.join(skillDir, "SKILL.md")
  if (!existsSync(skillFile)) {
    return null
  }

  const markdown = readFileSync(skillFile, "utf8")
  const { data, body } = parseFrontmatter(markdown)
  const id = path.basename(skillDir)

  return {
    id,
    label: extractHeadingLabel(body) ?? prettifySkillName(data.name || id),
    description: data.description ?? "",
    source,
  }
}

function readSkillDirectory(rootDir: string, source: SkillSource) {
  if (!existsSync(rootDir)) {
    return []
  }

  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readSkillCatalogEntry(path.join(rootDir, entry.name), source))
    .filter((entry): entry is SkillCatalogEntry => entry !== null)
}

export function listInstalledSkills(homePath = homedir()) {
  const preferredSkills = readSkillDirectory(path.join(homePath, ".codex", "skills"), "codex")
  const fallbackSkills = readSkillDirectory(path.join(homePath, ".agents", "skills"), "agents")
  const deduped = new Map<string, SkillCatalogEntry>()

  for (const entry of [...preferredSkills, ...fallbackSkills]) {
    if (!deduped.has(entry.id)) {
      deduped.set(entry.id, entry)
    }
  }

  return [...deduped.values()].sort((left, right) => left.label.localeCompare(right.label))
}

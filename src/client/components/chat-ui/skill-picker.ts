import type { SkillCatalogEntry } from "../../../shared/types"

export interface SkillTriggerMatch {
  start: number
  end: number
  query: string
}

export function getSkillTriggerMatch(value: string, caretPosition: number | null) {
  if (caretPosition === null || caretPosition < 0) {
    return null
  }

  let tokenStart = caretPosition
  while (tokenStart > 0) {
    const previousCharacter = value[tokenStart - 1]
    if (/\s/.test(previousCharacter)) {
      break
    }
    tokenStart -= 1
  }

  const token = value.slice(tokenStart, caretPosition)
  if (!token.startsWith("$")) {
    return null
  }

  const query = token.slice(1)
  if (!/^[A-Za-z0-9-]*$/.test(query)) {
    return null
  }

  return {
    start: tokenStart,
    end: caretPosition,
    query,
  } satisfies SkillTriggerMatch
}

export function insertSkillToken(value: string, match: SkillTriggerMatch, skillId: string) {
  return `${value.slice(0, match.start)}$${skillId} ${value.slice(match.end)}`
}

function scoreSkill(entry: SkillCatalogEntry, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return 0
  }

  const id = entry.id.toLowerCase()
  const label = entry.label.toLowerCase()
  const description = entry.description.toLowerCase()

  if (id === normalizedQuery || label === normalizedQuery) {
    return 4
  }
  if (id.startsWith(normalizedQuery) || label.startsWith(normalizedQuery)) {
    return 3
  }
  if (id.includes(normalizedQuery)) {
    return 2
  }
  if (label.includes(normalizedQuery) || description.includes(normalizedQuery)) {
    return 1
  }
  return -1
}

export function filterSkills(skills: SkillCatalogEntry[], query: string) {
  return skills
    .map((entry) => ({ entry, score: scoreSkill(entry, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score
      }
      return left.entry.label.localeCompare(right.entry.label)
    })
    .map((entry) => entry.entry)
}

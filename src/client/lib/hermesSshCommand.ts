import { DEFAULT_NEW_PROJECT_ROOT } from "../../shared/branding"
import type { HermesSshSettings } from "../../shared/types"

export interface ParsedHermesSshCommand {
  title: string
  localPath: string
  settings: HermesSshSettings
}

function tokenizeShellCommand(command: string) {
  const tokens: string[] = []
  let current = ""
  let quote: "'" | "\"" | null = null
  let escaping = false

  for (const char of command.trim()) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === "\\") {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === "'" || char === "\"") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ""
      }
      continue
    }

    current += char
  }

  if (quote) {
    throw new Error("SSH command has an unterminated quote.")
  }

  if (escaping) {
    current += "\\"
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return tokens
}

function slugifyRemoteName(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9@.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/@/g, "-at-")

  return slug || "hermes-remote"
}

function extractTargetParts(token: string) {
  const trimmed = token.trim()
  if (!trimmed) {
    return { user: "", host: "" }
  }

  const atIndex = trimmed.lastIndexOf("@")
  if (atIndex === -1) {
    return { user: "", host: trimmed }
  }

  return {
    user: trimmed.slice(0, atIndex),
    host: trimmed.slice(atIndex + 1),
  }
}

export function parseHermesSshCommand(command: string): ParsedHermesSshCommand {
  const tokens = tokenizeShellCommand(command)
  if (tokens.length === 0) {
    throw new Error("Enter an SSH command.")
  }

  let cursor = 0
  if (tokens[0] === "ssh") {
    cursor += 1
  }

  let port = 22
  let keyPath = ""
  let user = ""
  let host = ""

  while (cursor < tokens.length) {
    const token = tokens[cursor]

    if (!token) {
      cursor += 1
      continue
    }

    if (!host && token.startsWith("-")) {
      if (token === "-p") {
        const value = tokens[cursor + 1]
        if (!value) {
          throw new Error("SSH command is missing the port after -p.")
        }
        const parsedPort = Number.parseInt(value, 10)
        if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
          throw new Error("SSH command contains an invalid port.")
        }
        port = parsedPort
        cursor += 2
        continue
      }

      if (token === "-i") {
        const value = tokens[cursor + 1]
        if (!value) {
          throw new Error("SSH command is missing the key path after -i.")
        }
        keyPath = value
        cursor += 2
        continue
      }

      if (token === "-l") {
        const value = tokens[cursor + 1]
        if (!value) {
          throw new Error("SSH command is missing the user after -l.")
        }
        user = value
        cursor += 2
        continue
      }

      if (token === "-o" || token === "-J" || token === "-F") {
        cursor += 2
        continue
      }

      cursor += 1
      continue
    }

    if (!host) {
      const target = extractTargetParts(token)
      user ||= target.user
      host = target.host
      cursor += 1
      continue
    }

    cursor += 1
  }

  if (!host) {
    throw new Error("SSH command must include a host, for example `hermes@example.com`.")
  }

  if (!user) {
    throw new Error("SSH command must include a user, for example `hermes@example.com`.")
  }

  const title = `${user}@${host}${port === 22 ? "" : `:${port}`}`
  const localPath = `${DEFAULT_NEW_PROJECT_ROOT}/remote/${slugifyRemoteName(title)}`

  return {
    title,
    localPath,
    settings: {
      host,
      port,
      user,
      keyPath,
      remoteCwd: "~",
      hermesCommand: "hermes acp",
    },
  }
}

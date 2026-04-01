import { describe, expect, test } from "bun:test"
import { parseHermesSshCommand } from "./hermesSshCommand"

describe("parseHermesSshCommand", () => {
  test("parses the common ssh command format", () => {
    expect(parseHermesSshCommand("ssh -p 2222 hermes@nexus.tail35c782.ts.net")).toEqual({
      title: "hermes@nexus.tail35c782.ts.net:2222",
      localPath: "~/Kanna/remote/hermes-at-nexus.tail35c782.ts.net-2222",
      settings: {
        host: "nexus.tail35c782.ts.net",
        port: 2222,
        user: "hermes",
        keyPath: "",
        remoteCwd: "~",
        hermesCommand: "hermes acp",
      },
    })
  })

  test("supports -l and -i options", () => {
    expect(parseHermesSshCommand("ssh -i ~/.ssh/hermes -l hermes nexus.tail35c782.ts.net")).toEqual({
      title: "hermes@nexus.tail35c782.ts.net",
      localPath: "~/Kanna/remote/hermes-at-nexus.tail35c782.ts.net",
      settings: {
        host: "nexus.tail35c782.ts.net",
        port: 22,
        user: "hermes",
        keyPath: "~/.ssh/hermes",
        remoteCwd: "~",
        hermesCommand: "hermes acp",
      },
    })
  })

  test("requires a user and host", () => {
    expect(() => parseHermesSshCommand("ssh nexus.tail35c782.ts.net")).toThrow(
      "SSH command must include a user, for example `hermes@example.com`."
    )
  })
})

import { describe, expect, test } from "bun:test"
import { UpdateManager } from "./update-manager"

describe("UpdateManager", () => {
  test("detects available updates", async () => {
    const manager = new UpdateManager({
      currentVersion: "0.12.0",
      fetchLatestVersion: async () => "0.13.0",
      installVersion: () => true,
    })

    const snapshot = await manager.checkForUpdates({ force: true })

    expect(snapshot.status).toBe("available")
    expect(snapshot.updateAvailable).toBe(true)
    expect(snapshot.latestVersion).toBe("0.13.0")
    expect(snapshot.installAction).toBe("restart")
  })

  test("bypasses cache when force is true", async () => {
    let calls = 0
    const manager = new UpdateManager({
      currentVersion: "0.12.0",
      fetchLatestVersion: async () => {
        calls += 1
        return calls === 1 ? "0.12.1" : "0.13.0"
      },
      installVersion: () => true,
    })

    await manager.checkForUpdates()
    await manager.checkForUpdates({ force: true })

    expect(calls).toBe(2)
    expect(manager.getSnapshot().latestVersion).toBe("0.13.0")
  })

  test("surfaces install failures without clearing the running version", async () => {
    let installedVersion: string | null = null
    const manager = new UpdateManager({
      currentVersion: "0.12.0",
      fetchLatestVersion: async () => "0.13.0",
      installVersion: (_packageName, version) => {
        installedVersion = version
        return false
      },
    })

    const result = await manager.installUpdate()

    expect(result).toEqual({ ok: false, action: "restart" })
    expect(installedVersion === "0.13.0").toBe(true)
    expect(manager.getSnapshot().status).toBe("error")
    expect(manager.getSnapshot().currentVersion).toBe("0.12.0")
  })

  test("always exposes an available reload action in dev mode", async () => {
    const manager = new UpdateManager({
      currentVersion: "0.12.0",
      fetchLatestVersion: async () => "9.9.9",
      installVersion: () => true,
      devMode: true,
    })

    expect(manager.getSnapshot()).toMatchObject({
      status: "available",
      updateAvailable: true,
      installAction: "restart",
    })

    const result = await manager.installUpdate()
    expect(result).toEqual({ ok: true, action: "restart" })
    expect(manager.getSnapshot().status).toBe("restart_pending")
  })
})

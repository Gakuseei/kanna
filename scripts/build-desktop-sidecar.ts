import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync } from "node:fs"
import path from "node:path"
import process from "node:process"

const rootDir = process.cwd()
const rustc = spawnSync("rustc", ["--print", "host-tuple"], {
  cwd: rootDir,
  encoding: "utf8",
})

if (rustc.status !== 0) {
  process.exit(rustc.status ?? 1)
}

const targetTriple = rustc.stdout.trim()
if (!targetTriple) {
  throw new Error("Could not determine Rust host target triple.")
}

const binariesDir = path.join(rootDir, "src-tauri", "binaries")
const extension = process.platform === "win32" ? ".exe" : ""
const outfile = path.join(binariesDir, `kanna-sidecar-${targetTriple}${extension}`)

mkdirSync(binariesDir, { recursive: true })

const build = spawnSync(process.execPath, [
  "build",
  "--compile",
  "./src/server/desktop.ts",
  "--outfile",
  outfile,
], {
  cwd: rootDir,
  stdio: "inherit",
  env: {
    ...process.env,
    KANNA_DISABLE_SELF_UPDATE: "1",
  },
})

if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

if (process.platform !== "win32") {
  chmodSync(outfile, 0o755)
}

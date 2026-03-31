import process from "node:process"
import { LOG_PREFIX } from "../shared/branding"
import { PROD_SERVER_PORT } from "../shared/ports"
import { startKannaServer } from "./server"

process.env.KANNA_DISABLE_SELF_UPDATE = "1"

const started = await startKannaServer({
  port: PROD_SERVER_PORT,
  strictPort: false,
})

console.log(JSON.stringify({
  type: "ready",
  origin: `http://127.0.0.1:${started.port}`,
  port: started.port,
}))

let shuttingDown = false

async function stopAndExit(code: number) {
  if (shuttingDown) {
    return
  }
  shuttingDown = true

  try {
    await started.stop()
  } catch (error) {
    console.error(`${LOG_PREFIX} desktop server shutdown failed`, error)
    process.exit(1)
  }

  process.exit(code)
}

process.once("SIGINT", () => {
  void stopAndExit(0)
})

process.once("SIGTERM", () => {
  void stopAndExit(0)
})

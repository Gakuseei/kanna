function getDesktopWindow() {
  if (typeof window === "undefined") {
    return null
  }

  return window as Window & {
    __KANNA_SERVER_ORIGIN__?: unknown
    isTauri?: unknown
  }
}

export function isTauriDesktopWindow() {
  const currentWindow = getDesktopWindow()
  if (!currentWindow) {
    return false
  }

  return Boolean(currentWindow.isTauri)
    || "__TAURI_INTERNALS__" in currentWindow
    || "__TAURI__" in currentWindow
}

export function getDesktopServerOrigin() {
  const currentWindow = getDesktopWindow()
  const candidate = currentWindow?.__KANNA_SERVER_ORIGIN__
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null
}

export function resolveServerUrl(pathOrUrl: string) {
  const serverOrigin = getDesktopServerOrigin()
  if (!serverOrigin) {
    return pathOrUrl
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(pathOrUrl)) {
    return pathOrUrl
  }

  return new URL(pathOrUrl, `${serverOrigin}/`).toString()
}

/** Static-export-safe project URL — always served via index.html (Tauri compatible). */
export function projectPath(projectId: string): string {
  return `/?project=${encodeURIComponent(projectId)}`
}

export function parseProjectIdFromLocation(): string | null {
  if (typeof window === "undefined") return null

  const params = new URLSearchParams(window.location.search)
  const fromProject = params.get("project")
  if (fromProject) return fromProject

  // Legacy: /project?id=...
  const fromLegacyQuery = params.get("id")
  if (fromLegacyQuery && window.location.pathname.startsWith("/project")) {
    return fromLegacyQuery
  }

  // Legacy: /project/<uuid>
  const match = window.location.pathname.match(/^\/project\/([^/]+)\/?$/)
  if (match && match[1] !== "placeholder" && match[1] !== "index.html") {
    return decodeURIComponent(match[1])
  }

  return null
}

/** Redirect legacy /project URLs to /?project= (call once on mount). */
export function redirectLegacyProjectUrl(): boolean {
  if (typeof window === "undefined") return false
  const id = parseProjectIdFromLocation()
  if (!id) return false
  if (window.location.pathname === "/" && new URLSearchParams(window.location.search).has("project")) {
    return false
  }
  window.location.replace(projectPath(id))
  return true
}

function normalizeProjectId(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  if (!/^\d+$/.test(normalized)) return null

  const id = Number(normalized)
  return Number.isSafeInteger(id) && id > 0 ? normalized : null
}

function isAimsHomePath(path: string) {
  return path === '/' || path === '/aims' || path === '/aims/'
}

export default defineNuxtRouteMiddleware((to) => {
  if (!isAimsHomePath(to.path)) return

  // Let auth callback style URLs be handled by the auth middleware/page first.
  if ('code' in to.query || 'state' in to.query) return

  const currentProjectId = useCookie<string | null>('aims_current_project_id')
  const projectId = normalizeProjectId(currentProjectId.value)
  if (!projectId) return

  return navigateTo(`/projects/${projectId}`, { replace: true })
})

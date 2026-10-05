import { parseAuthorizationSnapshotResponse } from '../../../foundation/shared/utils/authorizationSnapshotSource'
import { authorizationResourcesAllow } from '../../../foundation/shared/utils/authorizationActions'

// The Console administration entry in the personal menu. It is a UI hint only:
// Console re-checks every page with its own guard. Shown when the user may open
// the Console overview (console_overview:view), read from the same server-side
// Console permission snapshot the Host already serves; any failure hides it.
export function useConsoleEntryAccess() {
  const scope = useState<string>('enterprise-cache-scope', () => '')
  const allowed = ref(false)
  let generation = 0
  async function refresh() {
    const epoch = ++generation
    const current = scope.value
    allowed.value = false
    if (!current) return
    try {
      const response = await $fetch('/enterprise/api/auth/permissions', { query: { app: 'console' }, cache: 'no-store', retry: 0 })
      if (epoch !== generation || current !== scope.value) return
      const snapshot = parseAuthorizationSnapshotResponse(response, 'console')
      allowed.value = authorizationResourcesAllow(snapshot.resources, 'console_overview', 'view', snapshot.actionPolicies.console_overview)
    } catch {
      // Fail closed: no entry while the snapshot is unavailable or invalid.
    }
  }
  // The scope changes with the verified identity and policy version.
  watch(scope, () => {
    void refresh()
  }, { immediate: true })
  return { allowed }
}

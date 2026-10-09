import { parseAuthorizationSnapshotResponse } from '@hzy/foundation/shared/utils/authorizationSnapshotSource'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { useFinanceModule } from '../../layer/useFinanceModule'

export function useFinanceCostAccess(sensitive = false) {
  const { loaded, error, hasPermission, loadPermissions } = usePermissions()
  const { hosted, sessionScope } = useFinanceModule()
  const peopleLoaded = ref(!sensitive)
  const peopleError = ref(false)
  const peopleAllowed = ref(false)
  const admin = computed(() => loaded.value && !error.value && hasPermission('project_accounting', 'admin'))
  let generation = 0
  async function loadPeople() {
    const epoch = ++generation
    peopleLoaded.value = !sensitive || !admin.value
    peopleError.value = false
    peopleAllowed.value = false
    if (!sensitive || !admin.value)
      return
    try {
      // Independent snapshot, never combine resources from two applications.
      const raw = await $fetch('/enterprise/api/auth/permissions', { query: { app: 'people' }, retry: 0 })
      const snapshot = parseAuthorizationSnapshotResponse(raw, 'people')
      if (epoch === generation)
        peopleAllowed.value = authorizationResourcesAllow(snapshot.resources, 'standard_costs', 'view', snapshot.actionPolicies.standard_costs)
    } catch {
      if (epoch === generation)
        peopleError.value = true
    } finally {
      if (epoch === generation)
        peopleLoaded.value = true
    }
  }
  watch(() => [admin.value, sessionScope?.value], () => {
    void loadPeople()
  }, { immediate: true })
  onMounted(() => {
    void loadPermissions()
  })
  onScopeDispose(() => {
    generation++
  })
  const permissionError = computed(() => !!error.value || peopleError.value)
  const permissionLoaded = computed(() => loaded.value && peopleLoaded.value)
  const allowed = computed(() => hosted && permissionLoaded.value && !permissionError.value && (sensitive ? admin.value && peopleAllowed.value : hasPermission('project_accounting', 'view')))
  async function retryPermissions() {
    await loadPermissions({ force: true })
    await loadPeople()
  }
  return { allowed, admin, permissionLoaded, permissionError, retryPermissions }
}

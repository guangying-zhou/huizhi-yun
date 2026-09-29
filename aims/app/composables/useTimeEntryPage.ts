import { isTimeEntryPage, type TimeEntryPage } from '../utils/timeEntryPagination'
import { useAimsModule } from '../../layer/useAimsModule'

/** An independent read controller per list/window. Never allow a revoked or
 * superseded reply to refill the page or provide an editing baseline. */
export function useTimeEntryReadPage<T>(valid: (value: unknown, page: number, pageSize: number) => value is T) {
  const { hosted } = useAimsModule()
  const { cacheFingerprint } = useNotifications()
  const verifiedScope = hosted ? useState<string>('enterprise-verified-scope', () => '') : ref('')
  const fingerprint = computed(() => cacheFingerprint.value ? `${cacheFingerprint.value}:${verifiedScope.value}` : '')
  const data = shallowRef<T | null>(null), loading = ref(false), error = ref(false)
  const errorStatus = ref<number | null>(null)
  let generation = 0
  let controller: AbortController | undefined
  function clear() {
    generation++
    controller?.abort()
    data.value = null
    loading.value = false
    error.value = false
    errorStatus.value = null
  }
  async function read(path: string, query: Record<string, string | number | undefined>) {
    const epoch = ++generation, identity = fingerprint.value
    controller?.abort()
    controller = new AbortController()
    data.value = null
    error.value = false
    errorStatus.value = null
    if (!identity) {
      loading.value = false
      return null
    }
    loading.value = true
    try {
      const response = await $fetch<{ code: number, data: T }>(path, { query, signal: controller.signal })
      if (epoch !== generation || identity !== fingerprint.value) return null
      if (response.code !== 0 || !valid(response.data, Number(query.page || 1), Number(query.pageSize || 20))) throw new Error('Invalid time entry page')
      data.value = response.data
      return response.data
    } catch (failure: unknown) {
      if (epoch !== generation || identity !== fingerprint.value) return null
      const status = failure as { statusCode?: number, status?: number, response?: { status?: number } }
      errorStatus.value = status?.statusCode || status?.status || status?.response?.status || null
      error.value = true
      return null
    } finally { if (epoch === generation) loading.value = false }
  }
  watch(fingerprint, clear, { flush: 'sync' })
  onScopeDispose(clear)
  return { data, loading, error, errorStatus, fingerprint, read, clear }
}

export function useTimeEntryPage<T>() {
  return useTimeEntryReadPage<TimeEntryPage<T>>(isTimeEntryPage<T>)
}

import type { Ref } from 'vue'

export type HostPendingTask = { task_id: number, instance_no: string, biz_title: string, action_name: string, node_name: string, created_at: string }
export function useHostPendingApprovals(page: Ref<number>, pageSize = 20, business?: Ref<string>) {
  const { cacheFingerprint } = useNotifications()
  const tasks = ref<HostPendingTask[]>([]), total = ref(0), status = ref<'idle' | 'pending' | 'success' | 'error'>('idle'), error = ref(false)
  let generation = 0, mounted = false
  let controller: AbortController | undefined
  function clear() {
    generation++
    controller?.abort()
    tasks.value = []
    total.value = 0
    status.value = 'idle'
    error.value = false
  }
  async function refresh() {
    const epoch = ++generation, fingerprint = cacheFingerprint.value, requestedPage = page.value, requestedBusiness = business?.value || 'aims/tasks/complete'
    controller?.abort()
    controller = new AbortController()
    tasks.value = []
    total.value = 0
    error.value = false
    if (!fingerprint) {
      status.value = 'idle'
      return
    }
    status.value = 'pending'
    try {
      const response = await $fetch<{ code: number, data: { items: HostPendingTask[], total: number, page: number, pageSize: number } }>(sharedApiPath('/api/workflow-proxy/tasks/pending'), { query: { page: requestedPage, pageSize, ...(business ? Object.fromEntries(['app_code', 'resource_code', 'action_code'].map((name, index) => [name, requestedBusiness.split('/')[index]])) : {}) }, signal: controller.signal })
      if (epoch !== generation || fingerprint !== cacheFingerprint.value || page.value !== requestedPage || requestedBusiness !== (business?.value || 'aims/tasks/complete')) return
      const data = response.data
      if (response.code !== 0 || !Array.isArray(data?.items) || data.items.length > pageSize || !Number.isSafeInteger(data.total) || data.total < 0 || data.page !== requestedPage || data.pageSize !== pageSize) throw new Error('Invalid approval page')
      tasks.value = data.items
      total.value = data.total
      status.value = 'success'
    } catch {
      if (epoch !== generation || fingerprint !== cacheFingerprint.value) return
      status.value = 'error'
      error.value = true
    }
  }
  watch(cacheFingerprint, () => {
    clear()
    if (mounted && cacheFingerprint.value) void refresh()
  }, { flush: 'sync' })
  watch(page, () => {
    clear()
    if (mounted) void refresh()
  }, { flush: 'sync' })
  if (business) watch(business, () => {
    clear()
    if (page.value !== 1) {
      page.value = 1
      return
    }
    if (mounted) void refresh()
  }, { flush: 'sync' })
  onMounted(() => {
    mounted = true
    void refresh()
  })
  onScopeDispose(clear)
  return { tasks, total, status, error, refresh }
}

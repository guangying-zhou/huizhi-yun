import type { AnnouncementPage } from '../../../console/shared/announcements'

export function useAnnouncements() {
  const scope = useState<string>('enterprise-cache-scope', () => '')
  const data = useState<AnnouncementPage | null>('announcements:data', () => null)
  const failure = useState<string>('announcements:error', () => '')
  const pending = ref(false)
  async function refresh() {
    pending.value = true
    failure.value = ''
    const started = scope.value
    try {
      const result = await $fetch<AnnouncementPage>('/enterprise/api/announcements/surfaces')
      if (scope.value === started) data.value = result
    } catch (e) {
      data.value = null
      const status = Number((e as { statusCode?: number }).statusCode)
      failure.value = status === 403 ? '当前账号无权查看系统公告' : '系统公告暂不可用，请重试'
    } finally { pending.value = false }
  }
  async function markRead(id: string) {
    await $fetch(`/enterprise/api/announcements/${encodeURIComponent(id)}/read`, { method: 'POST', body: {}, headers: { 'Idempotency-Key': `announcement-read:${id}` } })
    const item = data.value?.data.items.find(x => x.id === id)
    if (item) item.read = true
    await refresh()
  }
  watch(scope, () => {
    data.value = null
    failure.value = ''
  })
  return { data, failure, pending, refresh, markRead, scope }
}

import { createSharedComposable } from '@vueuse/core'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'
export type NotificationStatusFilter = 'all' | 'unread' | 'read' | 'archived'

export interface NotificationItem {
  rowId: number
  notificationId: string
  sourceAppCode: string
  eventType: string | null
  category: string
  severity: NotificationSeverity
  title: string
  summary: string | null
  body: string | null
  actionUrl: string | null
  bizType: string | null
  bizId: string | null
  idempotencyKey: string | null
  metadata: Record<string, unknown>
  createdBy: string | null
  createdAt: string
  expiresAt: string | null
  recipient: {
    uid: string
    readAt: string | null
    archivedAt: string | null
    pinnedAt: string | null
    createdAt: string
    isRead: boolean
    isArchived: boolean
  }
}

export interface NotificationSummary {
  totalCount: number
  unreadCount: number
  unreadByCategory: Record<string, number>
  latest: NotificationItem[]
}

type ApiResponse<T> = {
  code?: number
  message?: string
  data: T
}

const emptySummary = (): NotificationSummary => ({
  totalCount: 0,
  unreadCount: 0,
  unreadByCategory: {},
  latest: []
})

const _useNotifications = () => {
  const items = ref<NotificationItem[]>([])
  const summary = ref<NotificationSummary>(emptySummary())
  const loading = ref(false)
  const summaryLoading = ref(false)
  const error = ref<string | null>(null)
  const status = ref<NotificationStatusFilter>('all')
  const nextCursor = ref<string | null>(null)

  async function loadSummary() {
    summaryLoading.value = true
    try {
      const response = await $fetch<ApiResponse<NotificationSummary>>('/api/notifications/summary')
      summary.value = response.data || emptySummary()
      return summary.value
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      summary.value = emptySummary()
      return summary.value
    } finally {
      summaryLoading.value = false
    }
  }

  async function loadNotifications(options: {
    status?: NotificationStatusFilter
    append?: boolean
    cursor?: string | null
    limit?: number
  } = {}) {
    loading.value = true
    error.value = null
    const requestedStatus = options.status || status.value
    try {
      const response = await $fetch<ApiResponse<{ items: NotificationItem[], nextCursor: string | null }>>('/api/notifications', {
        query: {
          status: requestedStatus,
          limit: options.limit || 20,
          cursor: options.cursor || undefined
        }
      })
      const payload = response.data || { items: [], nextCursor: null }
      status.value = requestedStatus
      items.value = options.append ? [...items.value, ...payload.items] : payload.items
      nextCursor.value = payload.nextCursor
      return payload
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      if (!options.append) {
        items.value = []
        nextCursor.value = null
      }
      return { items: [], nextCursor: null }
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (!nextCursor.value || loading.value) return
    await loadNotifications({ status: status.value, append: true, cursor: nextCursor.value })
  }

  async function markRead(notificationId: string) {
    await $fetch(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: 'POST'
    })
    const item = items.value.find(candidate => candidate.notificationId === notificationId)
    if (item && !item.recipient.isRead) {
      item.recipient.isRead = true
      item.recipient.readAt = new Date().toISOString()
    }
    await loadSummary()
  }

  async function archive(notificationId: string) {
    await $fetch(`/api/notifications/${encodeURIComponent(notificationId)}/archive`, {
      method: 'POST'
    })
    items.value = items.value.filter(item => item.notificationId !== notificationId)
    await loadSummary()
  }

  async function markAllRead() {
    await $fetch('/api/notifications/read-all', {
      method: 'POST',
      body: status.value === 'unread' ? {} : { status: status.value }
    })
    for (const item of items.value) {
      item.recipient.isRead = true
      item.recipient.readAt ||= new Date().toISOString()
    }
    await loadSummary()
  }

  return {
    items,
    summary,
    loading,
    summaryLoading,
    error,
    status,
    nextCursor,
    loadSummary,
    loadNotifications,
    loadMore,
    markRead,
    archive,
    markAllRead
  }
}

export const useNotifications = createSharedComposable(_useNotifications)

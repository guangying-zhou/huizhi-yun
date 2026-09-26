import { createSharedComposable } from '@vueuse/core'
import {
  buildShellCacheFingerprint,
  readShellSessionCache,
  writeShellSessionCache
} from '../utils/shellSessionCache'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'
export type NotificationStatusFilter = 'all' | 'unread' | 'read' | 'archived'

export interface NotificationItem {
  notificationId: string
  sourceAppCode: string
  category: string
  severity: NotificationSeverity
  displayLabel: string
  createdAt: string
  expiresAt: string | null
  recipient: {
    readAt: string | null
    archivedAt: string | null
    pinnedAt: string | null
    isRead: boolean
    isArchived: boolean
  }
}

export interface NotificationDetail {
  notificationId: string
  sourceAppCode: string
  title: string
  summary: string | null
  body: string | null
  actionUrl: string | null
  actionTargetAppCode: string
  bizType: string | null
  bizId: string | null
  createdAt: string
  expiresAt: string | null
  detailMode?: 'notification_snapshot'
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

const NOTIFICATION_SUMMARY_CACHE_KEY = 'hzy:notification-summary:v1'
const NOTIFICATION_SUMMARY_CACHE_TTL_MS = 30_000

function parseNotificationSummary(value: unknown): NotificationSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const summary = value as Partial<NotificationSummary>
  if (
    !Number.isFinite(Number(summary.totalCount))
    || !Number.isFinite(Number(summary.unreadCount))
    || !summary.unreadByCategory
    || typeof summary.unreadByCategory !== 'object'
    || Array.isArray(summary.unreadByCategory)
    || !Array.isArray(summary.latest)
  ) {
    return null
  }

  return {
    totalCount: Number(summary.totalCount),
    unreadCount: Number(summary.unreadCount),
    unreadByCategory: summary.unreadByCategory,
    latest: summary.latest
  }
}

const _useNotifications = () => {
  const runtimeConfig = useRuntimeConfig()
  const auth = useAuth()
  const currentAppCode = String(runtimeConfig.public.appCode || runtimeConfig.public.appName || '')
    .trim()
    .toLowerCase()
  const notificationItemApiBase = currentAppCode === 'console'
    ? '/api/v1/console/notifications'
    : '/api/notifications'
  const items = ref<NotificationItem[]>([])
  const summary = ref<NotificationSummary>(emptySummary())
  const loading = ref(false)
  const summaryLoading = ref(false)
  const error = ref<string | null>(null)
  const status = ref<NotificationStatusFilter>('all')
  const nextCursor = ref<string | null>(null)
  let summaryLoadedAt = 0
  let summaryFingerprint = ''
  let pendingSummary: Promise<NotificationSummary> | null = null

  function currentAuthFingerprint() {
    return buildShellCacheFingerprint({
      authenticated: auth.authenticated.value,
      user: auth.user.value,
      tenant: auth.tenant.value,
      policyVersion: auth.policyVersion.value
    })
  }

  async function loadSummary(options: { force?: boolean } = {}) {
    const fingerprint = currentAuthFingerprint()
    if (fingerprint !== summaryFingerprint) {
      summary.value = emptySummary()
      summaryLoadedAt = 0
      summaryFingerprint = fingerprint
    }

    if (!options.force && summaryLoadedAt && Date.now() - summaryLoadedAt <= NOTIFICATION_SUMMARY_CACHE_TTL_MS) {
      return summary.value
    }

    if (!options.force && import.meta.client && fingerprint) {
      const cached = readShellSessionCache(
        sessionStorage,
        NOTIFICATION_SUMMARY_CACHE_KEY,
        fingerprint,
        NOTIFICATION_SUMMARY_CACHE_TTL_MS,
        parseNotificationSummary
      )
      if (cached) {
        summary.value = cached.value
        summaryLoadedAt = cached.cachedAt
        return summary.value
      }
    }

    if (pendingSummary) return await pendingSummary

    summaryLoading.value = true
    pendingSummary = (async () => {
      try {
        const response = await $fetch<ApiResponse<NotificationSummary>>('/api/notifications/summary')
        summary.value = parseNotificationSummary(response.data) || emptySummary()
        summaryLoadedAt = Date.now()
        if (import.meta.client && fingerprint) {
          writeShellSessionCache(
            sessionStorage,
            NOTIFICATION_SUMMARY_CACHE_KEY,
            fingerprint,
            summary.value,
            summaryLoadedAt
          )
        }
        return summary.value
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err)
        return summary.value
      } finally {
        summaryLoading.value = false
        pendingSummary = null
      }
    })()

    return await pendingSummary
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

  async function loadDetail(notificationId: string) {
    const response = await $fetch<ApiResponse<NotificationDetail>>(
      `${notificationItemApiBase}/${encodeURIComponent(notificationId)}/detail`
    )
    return response.data
  }

  async function markRead(notificationId: string) {
    await $fetch(`${notificationItemApiBase}/${encodeURIComponent(notificationId)}/read`, {
      method: 'POST',
      headers: {
        'idempotency-key': `notification:read:${notificationId}:${globalThis.crypto?.randomUUID?.() || Date.now()}`
      }
    })
    const item = items.value.find(candidate => candidate.notificationId === notificationId)
    if (item && !item.recipient.isRead) {
      item.recipient.isRead = true
      item.recipient.readAt = new Date().toISOString()
    }
    await loadSummary({ force: true })
  }

  async function archive(notificationId: string) {
    await $fetch(`/api/notifications/${encodeURIComponent(notificationId)}/archive`, {
      method: 'POST',
      headers: {
        'idempotency-key': `notification:archive:${notificationId}:${globalThis.crypto?.randomUUID?.() || Date.now()}`
      }
    })
    items.value = items.value.filter(item => item.notificationId !== notificationId)
    await loadSummary({ force: true })
  }

  async function markAllRead() {
    await $fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: {
        'idempotency-key': `notification:read-all:${globalThis.crypto?.randomUUID?.() || Date.now()}`
      },
      body: status.value === 'unread' ? {} : { status: status.value }
    })
    for (const item of items.value) {
      item.recipient.isRead = true
      item.recipient.readAt ||= new Date().toISOString()
    }
    await loadSummary({ force: true })
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
    loadDetail,
    markRead,
    archive,
    markAllRead
  }
}

export const useNotifications = createSharedComposable(_useNotifications)

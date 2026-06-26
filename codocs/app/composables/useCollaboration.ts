/**
 * 协同编辑 Composable
 *
 * 管理 Y.js 文档和 Hocuspocus WebSocket 连接
 */

import { ref, computed, onUnmounted, toValue } from 'vue'
import * as Y from 'yjs'
import type { MaybeRefOrGetter } from 'vue'
import { HocuspocusCollaborationProvider } from '../utils/hocuspocus-provider'

export interface CollaborationUser {
  id: string
  name: string
  color: string
  cursor?: { anchor: number, head: number }
}

export interface UseCollaborationOptions {
  /** 文档 ID */
  documentId: MaybeRefOrGetter<string>
  /** WebSocket 服务器地址 */
  wsUrl?: MaybeRefOrGetter<string>
  /** 用户认证 Token */
  token?: MaybeRefOrGetter<string>
  /** 当前用户信息 */
  user?: MaybeRefOrGetter<{
    id: string
    name: string
    color?: string
  }>
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizeBasePath(value: unknown) {
  const normalized = stringValue(value)
  if (!normalized || normalized === '/') return '/'
  if (!normalized.startsWith('/')) return '/'
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

function wsOrigin() {
  if (!import.meta.client) return ''
  return window.location.origin.replace(/^http/i, 'ws')
}

function resolveCollaborationUrl(value: unknown, config: ReturnType<typeof useRuntimeConfig>) {
  const explicit = stringValue(value)
  if (/^wss?:\/\//i.test(explicit)) {
    return explicit
  }

  const origin = wsOrigin()
  if (!origin) return explicit

  if (explicit.startsWith('/')) {
    return `${origin}${explicit}`
  }

  const publicConfig = (config.public || {}) as Record<string, unknown>
  const appConfig = (config.app || {}) as Record<string, unknown>
  const appBasePath = normalizeBasePath(publicConfig.appBasePath || appConfig.baseURL || '/codocs/')
  return `${origin}${appBasePath}ws`
}

export function useCollaboration(options: UseCollaborationOptions) {
  const config = useRuntimeConfig()
  const {
    documentId,
    wsUrl = config.public.collaborationUrl,
    token = '',
    user = { id: 'anonymous', name: '匿名用户' }
  } = options

  const documentName = computed(() => {
    const currentDocumentId = toValue(documentId)
    return currentDocumentId.startsWith('doc:') ? currentDocumentId : `doc:${currentDocumentId}`
  })

  // 状态
  const isConnected = ref(false)
  const isConnecting = ref(false)
  const synced = ref(false)
  const scope = ref<'read-write' | 'readonly' | null>(null)
  const error = ref<Error | null>(null)
  const collaborators = ref<CollaborationUser[]>([])

  // Y.js 文档
  const ydoc = new Y.Doc()

  // WebSocket Provider
  let provider: HocuspocusCollaborationProvider | null = null
  let awarenessCleanup: (() => void) | null = null

  // 生成用户颜色
  const generateColor = (userId: string): string => {
    let hash = 0
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash)
    }
    const colors = [
      '#f87171', '#fb923c', '#fbbf24', '#a3e635',
      '#4ade80', '#2dd4bf', '#38bdf8', '#818cf8',
      '#c084fc', '#f472b6'
    ]
    return colors[Math.abs(hash) % colors.length] ?? '#f87171'
  }

  // 当前用户信息
  const currentUser = computed(() => ({
    id: toValue(user).id,
    name: toValue(user).name,
    color: toValue(user).color || generateColor(toValue(user).id)
  }))

  // 连接到协同服务
  const resolveToken = async (currentDocumentName: string) => {
    const explicitToken = String(toValue(token) || '').trim()
    if (explicitToken) {
      return explicitToken
    }

    const response = await $fetch<{ success: boolean, data?: { token?: string } }>('/api/collaboration/token', {
      query: {
        documentName: currentDocumentName
      }
    })

    const signedToken = String(response.data?.token || '').trim()
    if (!signedToken) {
      throw new Error('协同认证令牌获取失败')
    }

    return signedToken
  }

  const connect = async () => {
    const currentWsUrl = resolveCollaborationUrl(toValue(wsUrl), config)
    const currentDocumentName = documentName.value

    isConnecting.value = true
    error.value = null

    if (provider) {
      if (provider.documentName === currentDocumentName) {
        provider.connect()
        return
      }

      disconnect()
    }

    scope.value = null

    try {
      const currentToken = await resolveToken(currentDocumentName)

      // 创建 Hocuspocus Provider
      provider = new HocuspocusCollaborationProvider({
        url: currentWsUrl,
        documentName: currentDocumentName,
        document: ydoc,
        token: currentToken,
        params: {
          app: 'codocs',
          doc: currentDocumentName.replace(/^doc:/, ''),
          documentName: currentDocumentName,
          uid: currentUser.value.id,
          name: currentUser.value.name
        },
        connect: false
      })

      provider.awareness.setLocalStateField('user', {
        id: currentUser.value.id,
        name: currentUser.value.name,
        color: currentUser.value.color
      })

      // 监听连接状态
      provider.on('status', (event: { status: string }) => {
        isConnected.value = event.status === 'connected'
        isConnecting.value = event.status === 'connecting'
        if (event.status === 'connected') {
          error.value = null
        }
      })

      // 监听同步状态
      provider.on('sync', (isSynced: boolean) => {
        synced.value = isSynced
        if (isSynced) {
          error.value = null
        }
      })

      provider.on('authenticated', ({ scope: authenticatedScope }) => {
        scope.value = authenticatedScope
        error.value = null
      })

      provider.on('authenticationFailed', ({ reason }) => {
        error.value = new Error(reason)
        isConnecting.value = false
      })

      provider.on('connection-error', () => {
        error.value = new Error('协同连接异常')
      })

      provider.on('connection-close', () => {
        if (!provider?.isAuthenticated) {
          error.value = error.value || new Error('协同连接已断开')
        }
      })

      const awareness = provider.awareness
      const handleAwarenessChange = () => {
        const states = awareness.getStates() as Map<number, { user?: CollaborationUser }>
        const users: CollaborationUser[] = []

        states.forEach((state, clientId) => {
          if (state.user && clientId !== awareness.clientID) {
            users.push(state.user)
          }
        })

        collaborators.value = users
      }

      awareness.on('change', handleAwarenessChange)
      awarenessCleanup = () => {
        awareness.off('change', handleAwarenessChange)
        awarenessCleanup = null
      }

      provider.connect()
      console.log(`✅ Connected to collaboration: ${currentDocumentName}`)
    } catch (err) {
      error.value = err as Error
      isConnecting.value = false
      console.error('❌ Connection failed:', err)
    }
  }

  // 断开连接
  const disconnect = () => {
    awarenessCleanup?.()
    if (provider) {
      provider.disconnect()
      provider.destroy()
      provider = null
    }
    isConnected.value = false
    isConnecting.value = false
    synced.value = false
    scope.value = null
    collaborators.value = []
  }

  // 获取 Y.js 文档
  const getYDoc = () => ydoc

  // 获取 Provider
  const getProvider = () => provider

  // 获取 Awareness
  const getAwareness = () => provider?.awareness
  const getTextContent = () => ydoc.getText('content').toString()
  const setTextContent = (content: string) => {
    const ytext = ydoc.getText('content')
    const nextContent = String(content || '')

    if (ytext.toString() === nextContent) {
      return
    }

    ydoc.transact(() => {
      if (ytext.length > 0) {
        ytext.delete(0, ytext.length)
      }
      if (nextContent) {
        ytext.insert(0, nextContent)
      }
    }, 'markdown-mirror')
  }

  // 清理
  onUnmounted(() => {
    disconnect()
    ydoc.destroy()
  })

  return {
    // 状态
    isConnected,
    isConnecting,
    synced,
    scope,
    error,
    collaborators,
    currentUser,
    documentName,

    // 方法
    connect,
    disconnect,
    getYDoc,
    getProvider,
    getAwareness,
    getTextContent,
    setTextContent
  }
}

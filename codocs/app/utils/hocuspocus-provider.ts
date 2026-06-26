/**
 * HocuspocusCollaborationProvider
 * =================================================================
 * 面向 Collab Runtime（内部 Hocuspocus provider）的 WebSocket 客户端，
 * 替代官方 @hocuspocus/provider。
 *
 * ## 为什么自写（事后复盘）
 * - 不想引入 @hocuspocus/provider 的间接依赖链（mitt / reconnecting-websocket 等），
 *   项目已经自带 yjs + y-protocols + lib0，核心协议直接复用就够。
 * - 需要把 token 放在 URL query 上（便于 nginx 前置鉴权 / 网关透传），
 *   官方 provider 走的是 parameters 约定，不一致。
 * - 协议实现极薄，几百行就够，方便按需裁剪重连策略、事件命名。
 *
 * 从 @hocuspocus/common 仅复用了 auth 握手的编解码（readAuthMessage /
 * writeAuthentication），其它协议帧全部在本文件手动读写。
 *
 * ## 协议对齐到的 Collab Runtime provider 版本
 * **Collab Runtime 内部 @hocuspocus/server 3.4.x**（2026-04 核对过源码）
 *
 * 已覆盖的消息类型（见 @hocuspocus/server 的 MessageType 枚举）：
 *   0 Sync / 1 Awareness / 2 Auth / 3 QueryAwareness / 4 SyncReply
 *   5 Stateless / 6 BroadcastStateless / 7 CLOSE / 8 SyncStatus
 *
 * Stateless 和 BroadcastStateless 业务上暂未使用，仅读掉 payload 保持
 * decoder 对齐，不做分发。CLOSE 按 reason 字符串区分是否应当重连。
 *
 * ## 升级 Collab Runtime 内部 Hocuspocus provider 时的 checklist
 * 升服务端版本（尤其跨大版本）前，**必须**做以下三件事，否则客户端可能
 * 在新消息类型上打 "Unknown Hocuspocus message type: X" 并吞掉消息：
 *
 * 1. 对照新版 @hocuspocus/server 的 MessageType 枚举，检查有没有新增类型
 *    - 节点路径示例：../collab/node_modules/.pnpm/@hocuspocus+server@X.Y.Z/
 *      node_modules/@hocuspocus/server/dist/hocuspocus-server.esm.js
 *    - 搜 `var MessageType` 即可定位枚举
 * 2. 如有新增，在本文件的 MESSAGE_TYPE_* 常量里补齐，并在 handleMessage
 *    的 switch 里加 case（即使只是 silently ignore，也要先读掉 payload）
 * 3. 如果 server 对某些 reason 字符串做了语义变更（比如新增一种致命
 *    CLOSE reason），同步更新 FATAL_CLOSE_REASONS 集合
 *
 * ## 与官方 provider 的已知功能差异
 * 本实现为协议对齐的最小实现，**不包含**以下官方能力：
 *   - BroadcastChannel 跨标签同步（同用户多标签会各开一条 websocket）
 *   - Tab visibility 休眠（后台标签仍保持活跃连接）
 *   - Stateless / sendStateless 业务 API
 *   - 鉴权完成前的本地 update 缓冲（现在未 authenticated 时会直接丢弃）
 *   - 细粒度错误事件（MessageTooBig / ConnectionTimeout / ResetConnection
 *     都被归拢到 connection-error / status: disconnected）
 *
 * 如果将来业务需要上述能力，评估一下是加功能还是切换到官方 provider。
 * 切换时注意：params 拼接、token 传递、事件命名可能要做一层适配层。
 */

import type * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import type { Awareness } from 'y-protocols/awareness'
import { readAuthMessage, writeAuthentication } from '@hocuspocus/common'

const MESSAGE_TYPE_SYNC = 0
const MESSAGE_TYPE_AWARENESS = 1
const MESSAGE_TYPE_AUTH = 2
const MESSAGE_TYPE_QUERY_AWARENESS = 3
const MESSAGE_TYPE_SYNC_REPLY = 4
const MESSAGE_TYPE_STATELESS = 5
const MESSAGE_TYPE_BROADCAST_STATELESS = 6
const MESSAGE_TYPE_CLOSE = 7
const MESSAGE_TYPE_SYNC_STATUS = 8

// 服务端 CLOSE 消息的原因，这些不应该再重连
const FATAL_CLOSE_REASONS = new Set(['Unauthorized', 'Forbidden'])

type ProviderStatus = 'connecting' | 'connected' | 'disconnected'
type AuthenticationScope = 'read-write' | 'readonly'

type ProviderEvents = {
  'status': { status: ProviderStatus }
  'sync': boolean
  'authenticated': { scope: AuthenticationScope }
  'authenticationFailed': { reason: string }
  'connection-close': CloseEvent | Event | null
  'connection-error': Event
}

interface HocuspocusProviderOptions {
  url: string
  documentName: string
  document: Y.Doc
  token?: string
  params?: Record<string, string>
  awareness?: Awareness
  connect?: boolean
  maxBackoffTime?: number
}

type EventHandler<T> = (payload: T) => void

export class HocuspocusCollaborationProvider {
  readonly awareness: Awareness
  readonly doc: Y.Doc
  readonly documentName: string

  private readonly baseUrl: string
  private readonly maxBackoffTime: number
  private readonly token: string
  private readonly params: Record<string, string>
  private readonly listeners = new Map<keyof ProviderEvents, Set<EventHandler<unknown>>>()

  private ws: WebSocket | null = null
  private shouldConnect = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private wsUnsuccessfulReconnects = 0

  isAuthenticated = false
  authorizedScope: AuthenticationScope | null = null
  synced = false

  constructor(options: HocuspocusProviderOptions) {
    this.baseUrl = options.url.replace(/\/$/, '')
    this.documentName = options.documentName
    this.doc = options.document
    this.token = options.token || ''
    this.params = options.params || {}
    this.maxBackoffTime = options.maxBackoffTime || 2500
    this.awareness = options.awareness || new awarenessProtocol.Awareness(this.doc)

    this.doc.on('update', this.handleDocumentUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)

    if (options.connect !== false) {
      this.connect()
    }
  }

  on<K extends keyof ProviderEvents>(event: K, handler: EventHandler<ProviderEvents[K]>) {
    const handlers = this.listeners.get(event) || new Set<EventHandler<unknown>>()
    handlers.add(handler as EventHandler<unknown>)
    this.listeners.set(event, handlers)
    return this
  }

  off<K extends keyof ProviderEvents>(event: K, handler: EventHandler<ProviderEvents[K]>) {
    this.listeners.get(event)?.delete(handler as EventHandler<unknown>)
    return this
  }

  connect() {
    this.shouldConnect = true
    if (this.ws === null) {
      this.setupWebSocket()
    }
  }

  disconnect() {
    this.shouldConnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.closeWebSocket(this.ws, null)
    } else {
      this.resetConnectionState()
    }
  }

  destroy() {
    this.disconnect()
    this.awareness.off('update', this.handleAwarenessUpdate)
    this.doc.off('update', this.handleDocumentUpdate)
    this.listeners.clear()
  }

  private emit<K extends keyof ProviderEvents>(event: K, payload: ProviderEvents[K]) {
    this.listeners.get(event)?.forEach((handler) => {
      ;(handler as EventHandler<ProviderEvents[K]>)(payload)
    })
  }

  private get url() {
    const finalUrl = new URL(this.baseUrl)
    Object.entries(this.params).forEach(([key, value]) => {
      if (value) {
        finalUrl.searchParams.set(key, value)
      }
    })
    return finalUrl.toString()
  }

  private createEncoder(messageType: number) {
    const encoder = encoding.createEncoder()
    encoding.writeVarString(encoder, this.documentName)
    encoding.writeVarUint(encoder, messageType)
    return encoder
  }

  private send(encoder: encoding.Encoder) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(encoding.toUint8Array(encoder))
  }

  private sendAuthentication() {
    const encoder = this.createEncoder(MESSAGE_TYPE_AUTH)
    writeAuthentication(encoder, this.token)
    this.send(encoder)
  }

  private sendSyncStepOne() {
    const encoder = this.createEncoder(MESSAGE_TYPE_SYNC)
    syncProtocol.writeSyncStep1(encoder, this.doc)
    this.send(encoder)
  }

  private sendAwarenessUpdate(clients = Array.from(this.awareness.getStates().keys())) {
    const encoder = this.createEncoder(MESSAGE_TYPE_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients)
    )
    this.send(encoder)
  }

  private handleDocumentUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || !this.isAuthenticated || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }

    const encoder = this.createEncoder(MESSAGE_TYPE_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    this.send(encoder)
  }

  private handleAwarenessUpdate = ({ added, updated, removed }: { added: number[], updated: number[], removed: number[] }, origin: unknown) => {
    if (origin === this || !this.isAuthenticated || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }

    const changedClients = added.concat(updated).concat(removed)
    if (changedClients.length === 0) return
    this.sendAwarenessUpdate(changedClients)
  }

  private handleAuthenticated(scope: string) {
    this.isAuthenticated = true
    this.authorizedScope = scope === 'readonly' ? 'readonly' : 'read-write'
    this.emit('authenticated', { scope: this.authorizedScope })
    this.sendSyncStepOne()

    if (this.awareness.getLocalState() !== null) {
      this.sendAwarenessUpdate([this.doc.clientID])
    }
  }

  private handleAuthenticationFailed(reason: string) {
    this.emit('authenticationFailed', { reason })
    this.shouldConnect = false
    if (this.ws) {
      this.closeWebSocket(this.ws, null)
    }
  }

  private handleMessage = (event: MessageEvent<ArrayBuffer>) => {
    const decoder = decoding.createDecoder(new Uint8Array(event.data))
    const documentName = decoding.readVarString(decoder)
    if (documentName !== this.documentName) return

    const messageType = decoding.readVarUint(decoder)

    switch (messageType) {
      case MESSAGE_TYPE_SYNC:
      case MESSAGE_TYPE_SYNC_REPLY: {
        const encoder = this.createEncoder(MESSAGE_TYPE_SYNC)
        const baseLength = encoding.length(encoder)
        const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this)

        if (encoding.length(encoder) > baseLength) {
          this.send(encoder)
        }

        if (syncMessageType === syncProtocol.messageYjsSyncStep2 && !this.synced) {
          this.synced = true
          this.emit('sync', true)
        }
        break
      }

      case MESSAGE_TYPE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          this
        )
        break

      case MESSAGE_TYPE_QUERY_AWARENESS:
        this.sendAwarenessUpdate()
        break

      case MESSAGE_TYPE_AUTH:
        readAuthMessage(
          decoder,
          () => this.sendAuthentication(),
          reason => this.handleAuthenticationFailed(reason),
          scope => this.handleAuthenticated(scope)
        )
        break

      case MESSAGE_TYPE_SYNC_STATUS:
        break

      case MESSAGE_TYPE_STATELESS:
      case MESSAGE_TYPE_BROADCAST_STATELESS:
        // 业务未使用 stateless 消息，silently ignore；仍读掉 payload 以保持 decoder 对齐
        try {
          decoding.readVarString(decoder)
        } catch {
          // 无 payload
        }
        break

      case MESSAGE_TYPE_CLOSE: {
        let reason = ''
        try {
          reason = decoding.readVarString(decoder)
        } catch {
          // 无 reason
        }
        if (FATAL_CLOSE_REASONS.has(reason)) {
          // 认证/权限问题，不应重连
          this.handleAuthenticationFailed(reason)
        } else {
          // ResetConnection / ConnectionTimeout 等：让 ws 自然断开走重连逻辑
          if (this.ws) this.closeWebSocket(this.ws, null)
        }
        break
      }

      default:
        console.error(`Unknown Hocuspocus message type: ${messageType}`)
    }
  }

  private resetConnectionState() {
    if (this.synced) {
      this.synced = false
      this.emit('sync', false)
    }

    this.isAuthenticated = false
    this.authorizedScope = null

    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      Array.from(this.awareness.getStates().keys()).filter(clientId => clientId !== this.doc.clientID),
      this
    )

    this.emit('status', { status: 'disconnected' })
  }

  private closeWebSocket(websocket: WebSocket, event: CloseEvent | Event | null) {
    if (websocket !== this.ws) return

    this.emit('connection-close', event)
    this.ws = null

    try {
      websocket.close()
    } catch {
      // noop
    }

    const wasConnected = websocket.readyState === WebSocket.OPEN || this.isAuthenticated || this.synced
    if (wasConnected) {
      this.wsUnsuccessfulReconnects = 0
      this.resetConnectionState()
    } else {
      this.wsUnsuccessfulReconnects++
      this.emit('status', { status: 'disconnected' })
    }

    if (this.shouldConnect) {
      const delay = Math.min((2 ** this.wsUnsuccessfulReconnects) * 100, this.maxBackoffTime)
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this.setupWebSocket()
      }, delay)
    }
  }

  private setupWebSocket() {
    if (!this.shouldConnect || this.ws) return

    const websocket = new WebSocket(this.url)
    websocket.binaryType = 'arraybuffer'
    this.ws = websocket
    this.emit('status', { status: 'connecting' })

    websocket.onopen = () => {
      if (websocket !== this.ws) return
      this.wsUnsuccessfulReconnects = 0
      this.emit('status', { status: 'connected' })
      this.sendAuthentication()
    }

    websocket.onmessage = this.handleMessage
    websocket.onerror = (event) => {
      this.emit('connection-error', event)
    }
    websocket.onclose = (event) => {
      this.closeWebSocket(websocket, event)
    }
  }
}

import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import { writeAuthenticated, writePermissionDenied } from '@hocuspocus/common'

const MESSAGE_TYPE_SYNC = 0
const MESSAGE_TYPE_AWARENESS = 1
const MESSAGE_TYPE_AUTH = 2
const MESSAGE_TYPE_QUERY_AWARENESS = 3
const MESSAGE_TYPE_SYNC_REPLY = 4
const MESSAGE_TYPE_STATELESS = 5
const MESSAGE_TYPE_BROADCAST_STATELESS = 6
const MESSAGE_TYPE_CLOSE = 7
const MESSAGE_TYPE_SYNC_STATUS = 8

type DurableObjectId = unknown

type DurableObjectStub = {
  fetch(request: Request): Promise<Response>
}

type DurableObjectNamespace = {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

type DurableObjectStorage = {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
}

type DurableObjectState = {
  acceptWebSocket?: (webSocket: WebSocket) => void
  getWebSockets?: () => WebSocket[]
  storage: DurableObjectStorage
}

type CollabDurableObjectEnv = {
  COLLAB_ROOM: DurableObjectNamespace
  HZY_ALLOWED_TENANTS?: string
  HZY_DEFAULT_TENANT?: string
  COLLABORATION_AUTH_SECRET?: string
  HZY_COLLABORATION_AUTH_SECRET?: string
  NUXT_COLLABORATION_AUTH_SECRET?: string
  NODE_ENV?: string
}

type CollaborationDocumentClaims = {
  docId: number
  docUuid: string
  docType: string
  ossPath: string
  ownerUid: string
  sharePermission: 'read' | 'write' | null
  readonly: boolean
}

type CollaborationAuthPayload = {
  uid: string
  name: string
  documentName: string
  issuedAt: number
  expiresAt: number
  document: CollaborationDocumentClaims
}

type SocketAttachment = {
  authenticated: boolean
  documentName: string
  uid?: string
  name?: string
  readonly?: boolean
}

type CloudflareWebSocket = WebSocket & {
  accept?: () => void
  serializeAttachment?: (value: SocketAttachment) => void
  deserializeAttachment?: () => SocketAttachment | undefined
}

declare const WebSocketPair: {
  new(): {
    0: WebSocket
    1: WebSocket
  }
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const DEV_FALLBACK_SECRET = 'codocs-collaboration-dev-secret'
const SNAPSHOT_KEY = 'snapshot'
const SNAPSHOT_META_KEY = 'snapshotMeta'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json;charset=utf-8')
  return new Response(JSON.stringify(data), {
    ...init,
    headers
  })
}

function getSecret(env: CollabDurableObjectEnv) {
  const secret = stringValue(
    env.COLLABORATION_AUTH_SECRET
    || env.HZY_COLLABORATION_AUTH_SECRET
    || env.NUXT_COLLABORATION_AUTH_SECRET
  )

  if (secret) return secret
  return env.NODE_ENV === 'production' ? '' : DEV_FALLBACK_SECRET
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function timingSafeEqual(a: string, b: string) {
  const left = textEncoder.encode(a)
  const right = textEncoder.encode(b)
  if (left.length !== right.length) return false

  let mismatch = 0
  for (let i = 0; i < left.length; i++) {
    mismatch |= (left[i] || 0) ^ (right[i] || 0)
  }
  return mismatch === 0
}

async function createSignature(encodedPayload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(encodedPayload))
  return base64UrlEncode(new Uint8Array(signature))
}

function parsePayload(encodedPayload: string): CollaborationAuthPayload | null {
  try {
    const payload = JSON.parse(textDecoder.decode(base64UrlDecode(encodedPayload))) as Partial<CollaborationAuthPayload>
    const issuedAt = Number(payload.issuedAt)
    const expiresAt = Number(payload.expiresAt)

    if (
      typeof payload.uid !== 'string'
      || typeof payload.name !== 'string'
      || typeof payload.documentName !== 'string'
      || !Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt)
      || typeof payload.document !== 'object'
      || payload.document === null
    ) {
      return null
    }

    const document = payload.document as Partial<CollaborationDocumentClaims>
    if (
      typeof document.docId !== 'number'
      || typeof document.docUuid !== 'string'
      || typeof document.docType !== 'string'
      || typeof document.ossPath !== 'string'
      || typeof document.ownerUid !== 'string'
      || typeof document.readonly !== 'boolean'
      || (
        document.sharePermission !== null
        && document.sharePermission !== 'read'
        && document.sharePermission !== 'write'
      )
    ) {
      return null
    }

    return {
      uid: payload.uid,
      name: payload.name,
      documentName: payload.documentName,
      issuedAt,
      expiresAt,
      document: {
        docId: document.docId,
        docUuid: document.docUuid,
        docType: document.docType,
        ossPath: document.ossPath,
        ownerUid: document.ownerUid,
        sharePermission: document.sharePermission,
        readonly: document.readonly
      }
    }
  } catch {
    return null
  }
}

async function verifyCollaborationToken(
  token: string,
  expectedDocumentName: string,
  env: CollabDurableObjectEnv
) {
  const [encodedPayload, signature] = String(token || '').split('.')
  const secret = getSecret(env)

  if (!encodedPayload || !signature || !secret) return null

  const expectedSignature = await createSignature(encodedPayload, secret)
  if (!timingSafeEqual(signature, expectedSignature)) return null

  const payload = parsePayload(encodedPayload)
  if (!payload) return null
  if (payload.documentName !== expectedDocumentName) return null
  if (payload.expiresAt <= Date.now()) return null

  return payload
}

function normalizeDocumentName(value: string) {
  const normalized = stringValue(value)
  if (!normalized) return ''
  return normalized.startsWith('doc:') ? normalized : `doc:${normalized}`
}

function roomDocumentFromRequest(url: URL) {
  return normalizeDocumentName(
    url.searchParams.get('documentName')
    || url.searchParams.get('document')
    || url.searchParams.get('doc')
    || 'poc'
  )
}

function roomNameFromRequest(request: Request, env: CollabDurableObjectEnv) {
  const url = new URL(request.url)
  const fallbackTenant = stringValue(env.HZY_DEFAULT_TENANT) || 'wiztek'
  const tenant = stringValue(url.searchParams.get('tenant') || request.headers.get('x-hzy-tenant') || fallbackTenant)
  const documentName = roomDocumentFromRequest(url)
  const app = stringValue(url.searchParams.get('app') || 'codocs')
  const allowedTenants = stringValue(env.HZY_ALLOWED_TENANTS)

  if (allowedTenants) {
    const allowed = new Set(allowedTenants.split(',').map(item => item.trim()).filter(Boolean))
    if (!allowed.has(tenant)) {
      throw new Response('Unknown tenant', { status: 404 })
    }
  }

  return `${tenant}:${app}:${documentName}`
}

function isWebSocketRequest(request: Request) {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket'
}

function createMessageEncoder(documentName: string, messageType: number) {
  const encoder = encoding.createEncoder()
  encoding.writeVarString(encoder, documentName)
  encoding.writeVarUint(encoder, messageType)
  return encoder
}

function toUint8Array(message: string | ArrayBuffer) {
  if (typeof message === 'string') {
    return textEncoder.encode(message)
  }
  return new Uint8Array(message)
}

function toStoredArrayBuffer(value: Uint8Array) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
}

function attachmentOf(webSocket: WebSocket): SocketAttachment | undefined {
  return (webSocket as CloudflareWebSocket).deserializeAttachment?.()
}

function setAttachment(webSocket: WebSocket, attachment: SocketAttachment) {
  ;(webSocket as CloudflareWebSocket).serializeAttachment?.(attachment)
}

export class CodocsCollabRoom {
  private readonly state: DurableObjectState
  private readonly env: CollabDurableObjectEnv
  private readonly fallbackSessions = new Set<WebSocket>()
  private readonly document = new Y.Doc()
  private loaded = false

  constructor(state: DurableObjectState, env: CollabDurableObjectEnv) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    if (!isWebSocketRequest(request)) {
      return jsonResponse({
        ok: true,
        provider: 'cloudflare-durable-object',
        room: roomNameFromRequest(request, this.env),
        hibernation: Boolean(this.state.acceptWebSocket)
      })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1] as CloudflareWebSocket
    const documentName = roomDocumentFromRequest(new URL(request.url))

    setAttachment(server, {
      authenticated: false,
      documentName
    })

    if (this.state.acceptWebSocket) {
      this.state.acceptWebSocket(server)
    } else {
      server.accept?.()
      this.fallbackSessions.add(server)
      server.addEventListener('message', event => this.webSocketMessage(server, event.data as string | ArrayBuffer))
      server.addEventListener('close', () => this.webSocketClose(server))
      server.addEventListener('error', () => this.webSocketError(server))
    }

    return new Response(null, {
      status: 101,
      webSocket: client
    } as ResponseInit & { webSocket: WebSocket })
  }

  async webSocketMessage(webSocket: WebSocket, message: string | ArrayBuffer) {
    await this.ensureLoaded()

    let bytes: Uint8Array
    let decoder: decoding.Decoder
    let documentName: string
    let messageType: number

    try {
      bytes = toUint8Array(message)
      decoder = decoding.createDecoder(bytes)
      documentName = decoding.readVarString(decoder)
      messageType = decoding.readVarUint(decoder)
    } catch {
      webSocket.close(1003, 'Invalid message')
      return
    }

    const attachment = attachmentOf(webSocket) || {
      authenticated: false,
      documentName
    }

    if (attachment.documentName && attachment.documentName !== documentName) {
      webSocket.close(1008, 'Document mismatch')
      return
    }

    if (messageType === MESSAGE_TYPE_AUTH) {
      await this.handleAuthentication(webSocket, decoder, documentName)
      return
    }

    if (!attachment.authenticated) {
      this.sendPermissionDenied(webSocket, documentName, 'Unauthorized')
      webSocket.close(4401, 'Unauthorized')
      return
    }

    switch (messageType) {
      case MESSAGE_TYPE_SYNC:
      case MESSAGE_TYPE_SYNC_REPLY:
        await this.handleSyncMessage(webSocket, bytes, decoder, documentName, messageType, Boolean(attachment.readonly))
        break
      case MESSAGE_TYPE_AWARENESS:
        this.broadcast(webSocket, bytes, documentName)
        break
      case MESSAGE_TYPE_QUERY_AWARENESS:
        this.broadcast(webSocket, bytes, documentName)
        break
      case MESSAGE_TYPE_STATELESS:
      case MESSAGE_TYPE_BROADCAST_STATELESS:
      case MESSAGE_TYPE_CLOSE:
      case MESSAGE_TYPE_SYNC_STATUS:
        break
      default:
        webSocket.close(1003, `Unknown message type: ${messageType}`)
    }
  }

  webSocketClose(webSocket: WebSocket) {
    this.fallbackSessions.delete(webSocket)
  }

  webSocketError(webSocket: WebSocket) {
    this.fallbackSessions.delete(webSocket)
  }

  private async ensureLoaded() {
    if (this.loaded) return

    const storedSnapshot = await this.state.storage.get<ArrayBuffer | Uint8Array>(SNAPSHOT_KEY)
    if (storedSnapshot) {
      const update = storedSnapshot instanceof Uint8Array ? storedSnapshot : new Uint8Array(storedSnapshot)
      if (update.byteLength > 0) {
        Y.applyUpdate(this.document, update, this)
      }
    }

    this.loaded = true
  }

  private async persistSnapshot(documentName: string) {
    const update = Y.encodeStateAsUpdate(this.document)
    await this.state.storage.put(SNAPSHOT_KEY, toStoredArrayBuffer(update))
    await this.state.storage.put(SNAPSHOT_META_KEY, {
      documentName,
      bytes: update.byteLength,
      updatedAt: new Date().toISOString()
    })
  }

  private async handleAuthentication(webSocket: WebSocket, decoder: decoding.Decoder, documentName: string) {
    let token = ''

    try {
      const authMessageType = decoding.readVarUint(decoder)
      if (authMessageType === 0) {
        token = decoding.readVarString(decoder)
      }
    } catch {
      this.sendPermissionDenied(webSocket, documentName, 'Invalid authentication')
      webSocket.close(4401, 'Unauthorized')
      return
    }

    const payload = await verifyCollaborationToken(token, documentName, this.env)
    if (!payload) {
      this.sendPermissionDenied(webSocket, documentName, 'Unauthorized')
      webSocket.close(4401, 'Unauthorized')
      return
    }

    const readonly = Boolean(payload.document.readonly)
    setAttachment(webSocket, {
      authenticated: true,
      documentName,
      uid: payload.uid,
      name: payload.name,
      readonly
    })

    const encoder = createMessageEncoder(documentName, MESSAGE_TYPE_AUTH)
    writeAuthenticated(encoder, readonly ? 'readonly' : 'read-write')
    webSocket.send(encoding.toUint8Array(encoder))
  }

  private sendPermissionDenied(webSocket: WebSocket, documentName: string, reason: string) {
    const encoder = createMessageEncoder(documentName, MESSAGE_TYPE_AUTH)
    writePermissionDenied(encoder, reason)
    webSocket.send(encoding.toUint8Array(encoder))
  }

  private async handleSyncMessage(
    webSocket: WebSocket,
    originalBytes: Uint8Array,
    decoder: decoding.Decoder,
    documentName: string,
    messageType: number,
    readonly: boolean
  ) {
    const probeDecoder = decoding.createDecoder(originalBytes)
    decoding.readVarString(probeDecoder)
    decoding.readVarUint(probeDecoder)
    const incomingSyncMessageType = decoding.readVarUint(probeDecoder)

    const isIncomingWrite = incomingSyncMessageType === syncProtocol.messageYjsSyncStep2
      || incomingSyncMessageType === syncProtocol.messageYjsUpdate

    if (readonly && isIncomingWrite) {
      webSocket.close(4403, 'Forbidden')
      return
    }

    const encoder = createMessageEncoder(documentName, MESSAGE_TYPE_SYNC)
    const baseLength = encoding.length(encoder)
    let syncMessageType = -1

    try {
      syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, this.document, this)
    } catch {
      webSocket.close(1003, 'Invalid sync message')
      return
    }

    if (encoding.length(encoder) > baseLength) {
      webSocket.send(encoding.toUint8Array(encoder))
    }

    const isWrite = syncMessageType === syncProtocol.messageYjsSyncStep2
      || syncMessageType === syncProtocol.messageYjsUpdate

    if (isWrite) {
      await this.persistSnapshot(documentName)
      this.broadcast(webSocket, originalBytes, documentName)
      return
    }

    if (messageType === MESSAGE_TYPE_SYNC_REPLY) {
      this.broadcast(webSocket, originalBytes, documentName)
    }
  }

  private sockets() {
    return this.state.getWebSockets?.() || Array.from(this.fallbackSessions)
  }

  private broadcast(sender: WebSocket, message: string | ArrayBuffer | Uint8Array, documentName: string) {
    for (const session of this.sockets()) {
      if (session === sender) continue

      const attachment = attachmentOf(session)
      if (!attachment?.authenticated || attachment.documentName !== documentName) continue

      try {
        session.send(message)
      } catch {
        this.fallbackSessions.delete(session)
      }
    }
  }
}

export default {
  async fetch(request: Request, env: CollabDurableObjectEnv): Promise<Response> {
    const url = new URL(request.url)

    if (!isWebSocketRequest(request) && isHealthRoute(url.pathname)) {
      return jsonResponse({
        ok: true,
        appCode: 'collab',
        provider: 'cloudflare-durable-object',
        runtimeMode: 'cloudflare-worker',
        durableObjectBinding: 'COLLAB_ROOM',
        allowedTenants: stringValue(env.HZY_ALLOWED_TENANTS)
      })
    }

    try {
      const roomName = roomNameFromRequest(request, env)
      const id = env.COLLAB_ROOM.idFromName(roomName)
      return await env.COLLAB_ROOM.get(id).fetch(request)
    } catch (error: unknown) {
      if (error instanceof Response) return error
      const message = error instanceof Error ? error.message : String(error)
      return new Response(message, { status: 500 })
    }
  }
}

function isHealthRoute(pathname: string) {
  return pathname === '/'
    || pathname === '/collab'
    || pathname === '/collab/'
    || pathname === '/collab/health'
    || pathname === '/api/v1/collab/health'
    || pathname === '/api/v1/collab/runtime'
}

/**
 * Stage B: collaboration on v2 snapshot documents (docs/Codocs-Document-Write-Coordination.md).
 *
 * - Admission: the browser presents a one-time ticket ("v2.<hex>") issued by the
 *   Host; Collab redeems it with its own service identity (collab.runtime)
 *   before any document state is loaded or sent (ADR-020 §5.1).
 * - Load: the exact published Yjs state, or the published Markdown seeding a
 *   new CRDT history; bytes are verified against the published size/SHA-256.
 * - Store: Markdown + Yjs from the same Y.Doc, uploaded write-once to a fresh
 *   attempt directory under the prepared prefix, then published as a pair.
 * - Storage: Collab holds no OSS credential. Bytes go through the Runtime
 *   (:upload / :download), which uses the vault-bound oss.default integration,
 *   writes only under the prepared candidate and reads only the published head.
 * - Lease: renewed at a short interval; a refused renewal closes the room so
 *   revoked access takes effect on live connections (ADR-020 §5.2).
 */

import crypto from 'node:crypto'
import * as Y from 'yjs'
import { createStandaloneServiceTokenClient } from '@hzy/foundation/server/utils/standaloneServiceToken'
import type { CollabV2Config } from '../config.js'
import { yjsDocumentToMarkdown } from './prosemirror-markdown.js'

const READ_CAPABILITY = 'codocs:collaboration-snapshots:read'
const PUBLISH_CAPABILITY = 'codocs:collaboration-snapshots:publish'
const TICKET_PATTERN = /^v2\.([a-f0-9]{64})$/

export type V2Admission = {
  sessionId: string, documentUuid: string, userUid: string, access: 'read' | 'write', epoch: number, generation: number, expiresAt: string
  /** Present only for department sessions; selects the per-participant renewal protocol. Never used for authorization. */
  deptCode?: string
  participantAccess?: string
}
type SnapshotObject = { key: string, version: string }
type ObjectPart = 'markdown' | 'yjs'
/** Runtime upload limit per object; larger documents cannot be stored. */
export const V2_OBJECT_MAX_BYTES = 16 * 1024 * 1024
type SnapshotRead = {
  documentUuid: string, generation: number, epoch: number, sessionEpoch: number, expiresAt: string
  markdownSize: number, markdownSha256: string, yjsSize: number, yjsSha256: string
  objects?: { markdown: SnapshotObject, yjs?: SnapshotObject }
}

/** Department sessions: lease is 90s (Runtime-issued); Collab caps whatever expiry it is told to this. */
export const DEPARTMENT_LEASE_MS = 90_000
/** Department sessions: renew at most every 30s (design 2.4). */
export const DEPARTMENT_RENEW_INTERVAL_MS = 30_000
/** Concurrent distinct writers per document (design Q7). */
export const DEPARTMENT_MAX_WRITERS = 20
const RESERVATION_MS = 60_000
export const REVOKED_CLOSE_EVENT = { code: 4403, reason: 'collaboration_access_revoked' }
export const ROOM_CLOSED_EVENT = { code: 4403, reason: 'collaboration_session_closed' }

export class V2RuntimeError extends Error {
  status: number
  code: string
  revokedUids: string[]
  constructor(status: number, code: string, revokedUids: string[] = []) {
    super(`collab-v2-runtime:${status}:${code}`)
    this.status = status
    this.code = code
    this.revokedUids = revokedUids
  }
}

// Only well-formed machine codes are kept; anything else (free text, echoed
// input) is dropped so Runtime bodies never reach logs or error messages.
const safeCode = (value: unknown) => {
  const code = String(value ?? '')
  return /^[a-z0-9_.:-]{1,64}$/i.test(code) ? code : 'runtime_error'
}
const uidList = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 128))]
  : []

export function isV2Ticket(token: string) {
  return TICKET_PATTERN.test(token)
}

const sha256 = (bytes: Uint8Array | string) => crypto.createHash('sha256').update(bytes).digest('hex')

export function createV2RuntimeClient(endpoint: string, config: CollabV2Config, fetchImpl: typeof fetch = fetch) {
  const base = endpoint.replace(/\/+$/, '')
  const tokens = createStandaloneServiceTokenClient({ tokenUrl: config.tokenUrl, clientId: config.clientId, clientSecret: config.clientSecret, fetchImpl })
  async function call<T>(action: string, capability: string, body: Record<string, unknown>, idempotencyKey?: string, retried = false, signal?: AbortSignal): Promise<T> {
    const token = await tokens.getToken('data-runtime', capability, { forceRefresh: retried })
    if (signal?.aborted) throw signal.reason
    const response = await fetchImpl(`${base}/v1/codocs/collaboration-snapshots:${action}`, {
      method: 'POST',
      signal,
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'authorization': `Bearer ${token}`, ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
      body: JSON.stringify(body)
    })
    const payload = await response.json().catch(() => null) as { data?: unknown, code?: string, revokedUids?: unknown, error?: { code?: string, revokedUids?: unknown, details?: { revokedUids?: unknown } } } | null
    if (response.status === 401 && !retried) return await call<T>(action, capability, body, idempotencyKey, true, signal)
    if (!response.ok) {
      const revoked = uidList(payload?.revokedUids ?? payload?.error?.details?.revokedUids ?? payload?.error?.revokedUids ?? (payload?.data as { revokedUids?: unknown } | undefined)?.revokedUids)
      throw new V2RuntimeError(response.status, safeCode(payload?.code || payload?.error?.code), revoked)
    }
    return (payload?.data ?? payload) as T
  }
  return {
    admit: (ticket: string) => call<V2Admission>('admit', READ_CAPABILITY, { ticket }),
    read: (sessionId: string) => call<SnapshotRead>('read', READ_CAPABILITY, { sessionId }),
    prepare: (sessionId: string, command: Record<string, unknown>, key: string) => call<{ prefix: string, generation: number, replayed: boolean }>('prepare', PUBLISH_CAPABILITY, { sessionId, ...command }, key),
    publish: (sessionId: string, command: Record<string, unknown>, key: string) => call<{ generation: number, replayed: boolean }>('publish', PUBLISH_CAPABILITY, { sessionId, ...command }, key),
    upload: (sessionId: string, command: Record<string, unknown>, key: string, attempt: string, part: ObjectPart, bytes: Buffer) =>
      call<SnapshotObject>('upload', PUBLISH_CAPABILITY, { sessionId, ...command, attempt, part, contentBase64: bytes.toString('base64') }, key),
    download: (sessionId: string, part: ObjectPart) =>
      call<SnapshotObject & { contentBase64: string }>('download', READ_CAPABILITY, { sessionId, part }),
    renew: (sessionId: string, signal?: AbortSignal) => call<{ expiresAt: string }>('renew', PUBLISH_CAPABILITY, { sessionId }, undefined, false, signal),
    /** Department sessions: reports the connected participants; the Runtime answers with the ones it revoked. */
    renewDepartment: (sessionId: string, connectedUids: string[], signal?: AbortSignal) =>
      call<{ expiresAt: string, revokedUids?: string[] }>('renew', PUBLISH_CAPABILITY, { sessionId, connectedUids }, undefined, false, signal),
    close: (sessionId: string) => call<{ closed: boolean }>('close', PUBLISH_CAPABILITY, { sessionId })
  }
}

export type V2RuntimeClient = ReturnType<typeof createV2RuntimeClient>

// The Runtime verifies too; Collab re-checks so it never applies bytes that
// differ from the head it read.
async function readExact(runtime: V2RuntimeClient, sessionId: string, part: ObjectPart, object: SnapshotObject, size: number, digest: string): Promise<Buffer> {
  const result = await runtime.download(sessionId, part)
  const content = Buffer.from(String(result.contentBase64 || ''), 'base64')
  if (result.key !== object.key || result.version !== object.version || content.length !== size || sha256(content) !== digest) {
    throw new V2RuntimeError(503, 'snapshot_bytes_invalid')
  }
  return content
}

export function createV2Snapshots(runtime: V2RuntimeClient, config: CollabV2Config) {
  const lastStored = new Map<string, string>()
  const confirmed = new Map<string, { sessionId: string, expiresAt: number }>()
  const lostSessions = new Map<string, string>()
  type Lease = { sessionId: string, onLost: () => void, interval?: ReturnType<typeof setInterval>, deadline?: ReturnType<typeof setTimeout>, controller?: AbortController, inFlight: boolean, closed: boolean }
  const leases = new Map<string, Lease>()
  const safetyMs = 1_000

  // Per-room participant registry (uid -> live connections). Personal rooms are
  // tracked too but nothing acts on it; only department rooms use it.
  type RoomConn = { close: (event: { code: number, reason: string }) => void, write: boolean }
  type Room = { dept: boolean, conns: Map<string, Set<RoomConn>>, reserved: Map<string, number>, revoked: Set<string> }
  const rooms = new Map<string, Room>()
  const roomOf = (documentName: string) => {
    let room = rooms.get(documentName)
    if (!room) {
      room = { dept: false, conns: new Map(), reserved: new Map(), revoked: new Set() }
      rooms.set(documentName, room)
    }
    return room
  }
  const isDept = (documentName: string) => rooms.get(documentName)?.dept === true
  const liveReservations = (room: Room) => {
    const now = Date.now()
    for (const [uid, until] of room.reserved) if (until <= now) room.reserved.delete(uid)
    return room.reserved
  }
  const writerUids = (room: Room) => {
    const writers = new Set<string>()
    for (const [uid, set] of room.conns) if ([...set].some(conn => conn.write)) writers.add(uid)
    for (const uid of liveReservations(room).keys()) writers.add(uid)
    return writers
  }
  const connectedUidsOf = (documentName: string) => {
    const room = rooms.get(documentName)
    if (!room) return []
    // Reserved-but-not-yet-connected admissions count as connected so a
    // renewal in that window cannot mark an admitted user as having left.
    return [...new Set([...room.conns.keys(), ...liveReservations(room).keys()])].sort()
  }
  /** Marks the users revoked and closes only their connections. */
  const revokeUids = (documentName: string, uids: string[]) => {
    const room = rooms.get(documentName)
    if (!room || uids.length === 0) return
    let closed = 0
    for (const uid of uids) {
      room.revoked.add(uid)
      room.reserved.delete(uid)
      const set = room.conns.get(uid)
      room.conns.delete(uid)
      for (const conn of set || []) {
        closed += 1
        try { conn.close(REVOKED_CLOSE_EVENT) } catch { /* connection already gone */ }
      }
    }
    console.warn(`[collab] v2 participants revoked: room=${documentName} users=${uids.length} connections=${closed}`)
  }
  const closeAllConnections = (documentName: string, event = ROOM_CLOSED_EVENT) => {
    const room = rooms.get(documentName)
    if (!room?.dept) return
    for (const set of room.conns.values()) for (const conn of set) { try { conn.close(event) } catch { /* gone */ } }
    room.conns.clear()
    room.reserved.clear()
  }
  const expiry = (value: string) => {
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed) || parsed <= Date.now() + safetyMs) throw new V2RuntimeError(409, 'collaboration_session_expired')
    return parsed
  }
  const lose = (documentName: string, lease: Lease) => {
    if (lease.closed) return
    lease.closed = true
    if (lease.interval) clearInterval(lease.interval)
    if (lease.deadline) clearTimeout(lease.deadline)
    lease.controller?.abort()
    if (leases.get(documentName) === lease) leases.delete(documentName)
    confirmed.delete(documentName)
    lostSessions.set(documentName, lease.sessionId)
    lease.onLost()
    closeAllConnections(documentName)
  }
  const scheduleDeadline = (documentName: string, lease: Lease, expiresAt: number) => {
    if (lease.deadline) clearTimeout(lease.deadline)
    lease.deadline = setTimeout(() => lose(documentName, lease), Math.max(0, expiresAt - Date.now() - safetyMs))
  }
  const remember = (documentName: string, sessionId: string, value: string) => {
    if (lostSessions.get(documentName) === sessionId) throw new V2RuntimeError(409, 'collaboration_session_expired')
    let expiresAt = expiry(value)
    // Department lease is 90s: whatever the Runtime reports, Collab never
    // trusts a longer window than that from the moment it heard it.
    if (isDept(documentName)) expiresAt = Math.min(expiresAt, Date.now() + DEPARTMENT_LEASE_MS)
    // Use the most recently observed Runtime expiry. A shorter value must not
    // be ignored if the session was curtailed between two reads.
    confirmed.set(documentName, { sessionId, expiresAt })
    const lease = leases.get(documentName)
    if (lease && lease.sessionId === sessionId && !lease.closed) scheduleDeadline(documentName, lease, expiresAt)
  }
  const assertActive = (documentName: string, sessionId: string) => {
    const current = confirmed.get(documentName)
    if (lostSessions.get(documentName) === sessionId || !current || current.sessionId !== sessionId || current.expiresAt <= Date.now() + safetyMs) {
      const lease = leases.get(documentName)
      if (lease) lose(documentName, lease)
      throw new V2RuntimeError(409, 'collaboration_session_expired')
    }
  }

  return {
    async admit(ticketToken: string, documentName: string): Promise<V2Admission> {
      const ticket = TICKET_PATTERN.exec(ticketToken)?.[1]
      if (!ticket) throw new V2RuntimeError(401, 'collaboration_ticket_invalid')
      const admission = await runtime.admit(ticket)
      const requested = documentName.startsWith('doc:') ? documentName.slice(4) : documentName
      if (admission.documentUuid !== requested) throw new V2RuntimeError(403, 'collaboration_document_mismatch')
      // A new one-time admission is fresh authority even if the same Runtime
      // session was extended elsewhere after this room closed.
      lostSessions.delete(documentName)
      const dept = typeof admission.deptCode === 'string' && admission.deptCode.length > 0
      const before = rooms.get(documentName)
      if (dept) roomOf(documentName).dept = true
      try {
        remember(documentName, admission.sessionId, admission.expiresAt)
        if (dept) {
          const room = roomOf(documentName)
          const write = admission.access === 'write'
          if (write) {
            const writers = writerUids(room)
            if (!writers.has(admission.userUid) && writers.size >= DEPARTMENT_MAX_WRITERS) {
              console.warn(`[collab] v2 writer limit reached: room=${documentName} limit=${DEPARTMENT_MAX_WRITERS}`)
              throw new V2RuntimeError(409, 'collaboration_writer_limit')
            }
            room.reserved.set(admission.userUid, Date.now() + RESERVATION_MS)
          }
          // A fresh, Runtime-verified admission supersedes an earlier revocation.
          room.revoked.delete(admission.userUid)
        }
      } catch (error) {
        const room = rooms.get(documentName)
        if (!before && room && room.conns.size === 0 && room.reserved.size === 0) rooms.delete(documentName)
        throw error
      }
      return admission
    },

    /** Registers a live connection so it can be closed on its own. Returns the unregister function. */
    registerConnection(documentName: string, uid: string, close: (event: { code: number, reason: string }) => void, write = true) {
      const room = roomOf(documentName)
      const conn: RoomConn = { close, write }
      if (room.dept && room.revoked.has(uid)) {
        try { close(REVOKED_CLOSE_EVENT) } catch { /* gone */ }
        return () => {}
      }
      let set = room.conns.get(uid)
      if (!set) { set = new Set(); room.conns.set(uid, set) }
      set.add(conn)
      room.reserved.delete(uid)
      return () => {
        const current = rooms.get(documentName)?.conns.get(uid)
        if (!current) return
        current.delete(conn)
        if (current.size === 0) rooms.get(documentName)?.conns.delete(uid)
      }
    },

    /** True when this user was revoked in a department room; their updates must be dropped. */
    isRevoked(documentName: string, uid: string) {
      const room = rooms.get(documentName)
      return Boolean(room?.dept && room.revoked.has(uid))
    },

    connectedUids(documentName: string) {
      return connectedUidsOf(documentName)
    },

    async load(documentName: string, sessionId: string, document: Y.Doc) {
      const head = await runtime.read(sessionId)
      remember(documentName, sessionId, head.expiresAt)
      if (!head.objects) throw new V2RuntimeError(409, 'document_not_on_snapshot_v2')
      if (head.objects.yjs && head.yjsSha256) {
        Y.applyUpdate(document, new Uint8Array(await readExact(runtime, sessionId, 'yjs', head.objects.yjs, head.yjsSize, head.yjsSha256)))
      } else {
        // Published by a normal save: seed a new CRDT history from that Markdown.
        const markdown = (await readExact(runtime, sessionId, 'markdown', head.objects.markdown, head.markdownSize, head.markdownSha256)).toString('utf-8')
        const text = document.getText('content')
        if (text.length === 0 && markdown.length > 0) text.insert(0, markdown)
      }
      assertActive(documentName, sessionId)
      lastStored.set(documentName, `${head.markdownSha256}:${head.yjsSha256 || ''}`)
    },

    async store(documentName: string, sessionId: string, document: Y.Doc) {
      if (confirmed.has(documentName) || lostSessions.get(documentName) === sessionId) assertActive(documentName, sessionId)
      const markdown = Buffer.from(yjsDocumentToMarkdown(document), 'utf-8')
      const state = Buffer.from(Y.encodeStateAsUpdate(document))
      if (markdown.length > V2_OBJECT_MAX_BYTES || state.length > V2_OBJECT_MAX_BYTES) {
        // Fail loudly: Hocuspocus retries, and the Runtime would refuse it anyway.
        throw new V2RuntimeError(413, 'collaboration_object_too_large')
      }
      const markdownSha256 = sha256(markdown)
      const yjsSha256 = sha256(state)
      const pairHash = `${markdownSha256}:${yjsSha256}`
      if (lastStored.get(documentName) === pairHash) return
      const head = await runtime.read(sessionId)
      remember(documentName, sessionId, head.expiresAt)
      if (markdown.length === 0 && head.markdownSize > 0) {
        // Never publish an empty body over non-empty content (same guard as v1).
        console.warn(`[collab] refuse to publish empty markdown over non-empty content: ${documentName}`)
        return
      }
      const command = { generation: head.generation, epoch: head.sessionEpoch, markdownSha256, markdownSize: markdown.length, yjsSha256, yjsSize: state.length }
      // Deterministic: a retry of the same pair at the same generation replays.
      const key = sha256(`${sessionId}:${head.generation}:${markdownSha256}:${yjsSha256}`).slice(0, 48)
      const plan = await runtime.prepare(sessionId, command, key)
      assertActive(documentName, sessionId)
      if (plan.replayed) {
        // A replayed prepare refers to the already-published receipt for this
        // exact immutable pair. No object upload is needed.
        lastStored.set(documentName, pairHash)
        return
      }
      // A fresh attempt per store: write-once keys are never reused.
      const attempt = crypto.randomBytes(16).toString('hex')
      const markdownObject = await runtime.upload(sessionId, command, key, attempt, 'markdown', markdown)
      const yjsObject = await runtime.upload(sessionId, command, key, attempt, 'yjs', state)
      assertActive(documentName, sessionId)
      if (!markdownObject.key.startsWith(plan.prefix) || !yjsObject.key.startsWith(plan.prefix)) {
        throw new V2RuntimeError(503, 'snapshot_object_invalid')
      }
      try {
        await runtime.publish(sessionId, { ...command, objects: { markdown: markdownObject, yjs: yjsObject } }, key)
      } catch (error) {
        if (error instanceof V2RuntimeError && error.status === 409 && isDept(documentName)) {
          const lease = leases.get(documentName)
          if (error.code === 'collaboration_participant_revoked' && error.revokedUids.length > 0) {
            // Disconnect the named users; the next save cycle retries without them.
            revokeUids(documentName, error.revokedUids)
          } else if (error.code === 'collaboration_participant_revoked' || error.code === 'collaboration_session_invalid' || error.code === 'collaboration_session_expired') {
            // Session gone (or a revocation we cannot attribute): close the room, never retry.
            if (lease) lose(documentName, lease)
            else { confirmed.delete(documentName); lostSessions.set(documentName, sessionId) }
            closeAllConnections(documentName)
          }
        }
        throw error
      }
      assertActive(documentName, sessionId)
      lastStored.set(documentName, pairHash)
    },

    /** Starts the lease; `onLost` must close the room's connections. */
    startLease(documentName: string, sessionId: string, onLost: () => void) {
      this.stopLease(documentName)
      const dept = isDept(documentName)
      const interval = Math.min(Math.max(config.renewIntervalMs, 5_000), dept ? DEPARTMENT_RENEW_INTERVAL_MS : 60_000)
      const current = confirmed.get(documentName)
      if (!current || current.sessionId !== sessionId || current.expiresAt <= Date.now() + safetyMs) {
        onLost()
        return
      }
      const lease: Lease = { sessionId, onLost, inFlight: false, closed: false }
      scheduleDeadline(documentName, lease, current.expiresAt)
      lease.interval = setInterval(() => {
        if (lease.closed || lease.inFlight) return
        if (confirmed.get(documentName)?.expiresAt! <= Date.now() + safetyMs) { lose(documentName, lease); return }
        lease.inFlight = true
        const controller = new AbortController()
        lease.controller = controller
        const timeout = setTimeout(() => controller.abort(), Math.min(interval, 10_000))
        const renewal = dept
          ? runtime.renewDepartment(sessionId, connectedUidsOf(documentName), controller.signal)
          : runtime.renew(sessionId, controller.signal)
        renewal.then(result => {
          if (lease.closed || leases.get(documentName) !== lease) return
          if (dept) revokeUids(documentName, uidList((result as { revokedUids?: unknown }).revokedUids))
          remember(documentName, sessionId, result.expiresAt)
        }).catch((error: unknown) => {
          if (lease.closed || leases.get(documentName) !== lease) return
          // Transient failures retry on the next tick, but never beyond the
          // last confirmed expiry. Explicit refusal ends the room now.
          // Department 409 is document-level (epoch advanced, recycled, read-only...): whole room.
          if (error instanceof V2RuntimeError && [401, 403, 404, 409].includes(error.status)) {
            console.warn(`[collab] v2 lease refused (${error.status} ${error.code}): room=${documentName}`)
            lose(documentName, lease)
          }
        }).finally(() => {
          clearTimeout(timeout)
          lease.inFlight = false
          if (lease.controller === controller) lease.controller = undefined
        })
      }, interval)
      leases.set(documentName, lease)
    },

    stopLease(documentName: string) {
      const lease = leases.get(documentName)
      if (lease) {
        lease.closed = true
        if (lease.interval) clearInterval(lease.interval)
        if (lease.deadline) clearTimeout(lease.deadline)
        lease.controller?.abort()
      }
      leases.delete(documentName)
    },

    async release(documentName: string, sessionId: string) {
      this.stopLease(documentName)
      lastStored.delete(documentName)
      confirmed.delete(documentName)
      rooms.delete(documentName)
      lostSessions.set(documentName, sessionId)
      await runtime.close(sessionId).catch(() => {})
    }
  }
}

export type V2Snapshots = ReturnType<typeof createV2Snapshots>

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

export type V2Admission = { sessionId: string, documentUuid: string, userUid: string, access: 'read' | 'write', epoch: number, generation: number, expiresAt: string }
type SnapshotObject = { key: string, version: string }
type ObjectPart = 'markdown' | 'yjs'
/** Runtime upload limit per object; larger documents cannot be stored. */
export const V2_OBJECT_MAX_BYTES = 16 * 1024 * 1024
type SnapshotRead = {
  documentUuid: string, generation: number, epoch: number, sessionEpoch: number, expiresAt: string
  markdownSize: number, markdownSha256: string, yjsSize: number, yjsSha256: string
  objects?: { markdown: SnapshotObject, yjs?: SnapshotObject }
}

export class V2RuntimeError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) {
    super(`collab-v2-runtime:${status}:${code}`)
    this.status = status
    this.code = code
  }
}

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
    const payload = await response.json().catch(() => null) as { data?: unknown, code?: string, error?: { code?: string } } | null
    if (response.status === 401 && !retried) return await call<T>(action, capability, body, idempotencyKey, true, signal)
    if (!response.ok) throw new V2RuntimeError(response.status, String(payload?.code || payload?.error?.code || 'runtime_error'))
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
  }
  const scheduleDeadline = (documentName: string, lease: Lease, expiresAt: number) => {
    if (lease.deadline) clearTimeout(lease.deadline)
    lease.deadline = setTimeout(() => lose(documentName, lease), Math.max(0, expiresAt - Date.now() - safetyMs))
  }
  const remember = (documentName: string, sessionId: string, value: string) => {
    if (lostSessions.get(documentName) === sessionId) throw new V2RuntimeError(409, 'collaboration_session_expired')
    const expiresAt = expiry(value)
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
      remember(documentName, admission.sessionId, admission.expiresAt)
      return admission
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
      await runtime.publish(sessionId, { ...command, objects: { markdown: markdownObject, yjs: yjsObject } }, key)
      assertActive(documentName, sessionId)
      lastStored.set(documentName, pairHash)
    },

    /** Starts the lease; `onLost` must close the room's connections. */
    startLease(documentName: string, sessionId: string, onLost: () => void) {
      this.stopLease(documentName)
      const interval = Math.min(Math.max(config.renewIntervalMs, 5_000), 60_000)
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
        runtime.renew(sessionId, controller.signal).then(result => {
          if (lease.closed || leases.get(documentName) !== lease) return
          remember(documentName, sessionId, result.expiresAt)
        }).catch((error: unknown) => {
          if (lease.closed || leases.get(documentName) !== lease) return
          // Transient failures retry on the next tick, but never beyond the
          // last confirmed expiry. Explicit refusal ends the room now.
          if (error instanceof V2RuntimeError && [401, 403, 404, 409].includes(error.status)) lose(documentName, lease)
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
      lostSessions.set(documentName, sessionId)
      await runtime.close(sessionId).catch(() => {})
    }
  }
}

export type V2Snapshots = ReturnType<typeof createV2Snapshots>

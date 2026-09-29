import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'
import { AuthenticationExtension } from '../src/extensions/authentication.js'
import { PersistenceExtension } from '../src/extensions/persistence.js'
import { configureCodocsRuntime } from '../src/utils/codocs-runtime.js'
import { createV2RuntimeClient, createV2Snapshots, DEPARTMENT_MAX_WRITERS, V2RuntimeError } from '../src/utils/v2-snapshots.js'
import type { CollabV2Config } from '../src/config.js'

const config: CollabV2Config = { enabled: true, tokenUrl: 'https://console.test/oauth/token', clientId: 'collab.runtime', clientSecret: 'secret', renewIntervalMs: 45_000 }
const docUuid = '11111111-2222-4333-8444-555555555555'
const room = `doc:${docUuid}`
const ticketFor = (n: string) => `v2.${n.repeat(64).slice(0, 64)}`
const future = (ms = 90_000) => new Date(Date.now() + ms).toISOString()

type Call = { action: string, body: Record<string, any>, headers: Record<string, string> }
type Handler = (action: string, body: Record<string, any>, call: Call) => { status: number, body: unknown }

function fakeRuntime(handler: Handler) {
  const calls: Call[] = []
  const impl = (async (url: string, init: { body: string, headers: Record<string, string> }) => {
    if (url.endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 'token-1', expires_in: 900 }), { status: 200 })
    const call = { action: url.split(':').pop() || '', body: JSON.parse(init.body), headers: init.headers }
    calls.push(call)
    const result = handler(call.action, call.body, call)
    return new Response(JSON.stringify(result.body), { status: result.status })
  }) as unknown as typeof fetch
  return { impl, calls }
}

/** Admissions are keyed by the first ticket digit: a -> alice, b -> bob, c -> carol, else a numbered user. */
function admissionHandler(dept: boolean, extra?: Handler): Handler {
  return (action, body, call) => {
    if (action === 'admit') {
      const key = String(body.ticket)
      const uid = ({ a: 'alice', b: 'bob', c: 'carol' } as Record<string, string>)[key[0]!.repeat(64) === key ? key[0]! : ''] || `user-${key.slice(0, 8)}`
      return { status: 200, body: { data: { sessionId: 's-1', documentUuid: docUuid, userUid: uid, access: 'write', epoch: 0, generation: 1, expiresAt: future(dept ? 600_000 : 300_000), ...(dept ? { deptCode: 'D001', participantAccess: 'manager' } : {}) } } }
    }
    return extra ? extra(action, body, call) : { status: 200, body: { data: { expiresAt: future() } } }
  }
}

function harness(dept: boolean, extra?: Handler) {
  const runtime = fakeRuntime(admissionHandler(dept, extra))
  const v2 = createV2Snapshots(createV2RuntimeClient('https://runtime.test', config, runtime.impl), config)
  const closed: Record<string, Array<{ code: number, reason: string }>> = {}
  const connect = async (letter: string, uid: string) => {
    await v2.admit(ticketFor(letter), room)
    closed[uid] = []
    return v2.registerConnection(room, uid, event => { closed[uid]!.push(event) })
  }
  return { runtime, v2, closed, connect }
}

/** Captures the lease timer so tests drive renewal ticks by hand. */
function captureTimers() {
  const original = globalThis.setInterval
  const ticks: Array<{ fn: () => void, delay: number }> = []
  globalThis.setInterval = ((fn: () => void, delay: number) => { ticks.push({ fn, delay }); return 1 as unknown as ReturnType<typeof setInterval> }) as unknown as typeof setInterval
  return { ticks, restore: () => { globalThis.setInterval = original } }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

function storable(text = 'hello') {
  const doc = new Y.Doc()
  doc.getText('content').insert(0, text)
  return doc
}
const storeHandler = (publish: Handler): Handler => (action, body, call) => {
  if (action === 'read') return { status: 200, body: { data: { generation: 1, epoch: 0, sessionEpoch: 0, expiresAt: future(), markdownSize: 1, markdownSha256: 'x', yjsSize: 0, yjsSha256: '' } } }
  if (action === 'prepare') return { status: 200, body: { data: { prefix: 'p/', generation: 1, replayed: false } } }
  if (action === 'upload') return { status: 200, body: { data: { key: `p/${body.attempt}/${body.part}`, version: 'v1' } } }
  if (action === 'publish') return publish(action, body, call)
  return { status: 200, body: { data: { expiresAt: future() } } }
}

test('department renewal reports connectedUids every 30s and disconnects only the revoked users', async () => {
  const timers = captureTimers()
  try {
    let revoked: string[] = []
    const { runtime, v2, closed, connect } = harness(true, () => ({ status: 200, body: { data: { expiresAt: future(), revokedUids: revoked } } }))
    await connect('a', 'alice')
    await connect('b', 'bob')
    const lost: number[] = []
    v2.startLease(room, 's-1', () => lost.push(1))
    assert.equal(timers.ticks[0]!.delay, 30_000, 'config says 45s; department is capped at 30s')
    timers.ticks[0]!.fn()
    await settle()
    assert.deepEqual(runtime.calls.find(call => call.action === 'renew')!.body, { sessionId: 's-1', connectedUids: ['alice', 'bob'] })
    revoked = ['bob']
    timers.ticks[0]!.fn()
    await settle()
    assert.deepEqual(closed.bob, [{ code: 4403, reason: 'collaboration_access_revoked' }])
    assert.deepEqual(closed.alice, [], 'other participants stay connected')
    assert.equal(lost.length, 0, 'the room stays open for the remaining users')
    assert.equal(v2.isRevoked(room, 'bob'), true)
    assert.equal(v2.isRevoked(room, 'alice'), false)
    revoked = []
    timers.ticks[0]!.fn()
    await settle()
    assert.deepEqual(runtime.calls.filter(call => call.action === 'renew').at(-1)!.body.connectedUids, ['alice'])
    v2.stopLease(room)
  } finally { timers.restore() }
})

test('a revoked user is blocked from further updates until a fresh Runtime admission; closing unregisters', async () => {
  const timers = captureTimers()
  try {
    const { v2, connect } = harness(true, () => ({ status: 200, body: { data: { expiresAt: future(), revokedUids: ['carol'] } } }))
    await connect('b', 'bob')
    await v2.admit(ticketFor('c'), room)
    const auth = new AuthenticationExtension()
    auth.useV2(v2)
    const closes: unknown[] = []
    let onClose = () => {}
    await auth.connected({ context: { mode: 'v2', actorUid: 'carol', readonly: false }, documentName: room, connection: { close: (event: unknown) => closes.push(event), onClose: (fn: () => void) => { onClose = fn } } } as never)
    assert.deepEqual(v2.connectedUids(room), ['bob', 'carol'])
    const message = (uid: string) => ({ context: { mode: 'v2', actorUid: uid }, documentName: room }) as never
    await auth.beforeHandleMessage(message('carol'))
    v2.startLease(room, 's-1', () => {})
    timers.ticks[0]!.fn()
    await settle()
    assert.deepEqual(closes, [{ code: 4403, reason: 'collaboration_access_revoked' }])
    await assert.rejects(auth.beforeHandleMessage(message('carol')), /collaboration_access_revoked/)
    await auth.beforeHandleMessage(message('bob'))
    await v2.admit(ticketFor('c'), room)
    await auth.beforeHandleMessage(message('carol'))
    v2.stopLease(room)
    onClose()
    await auth.connected({ context: { mode: 'v2', actorUid: 'dave' }, documentName: room, connection: { close: () => {}, onClose: () => {} } } as never)
    assert.equal(v2.connectedUids(room).includes('dave'), true)
  } finally { timers.restore() }
})

test('publish rejected for revoked participants: they are disconnected, nothing is retried in-call, the next save cycle publishes', async () => {
  let rejectOnce = true
  const { runtime, v2, closed, connect } = harness(true, storeHandler(() => {
    if (rejectOnce) { rejectOnce = false; return { status: 409, body: { error: { code: 'collaboration_participant_revoked', details: { revokedUids: ['bob'] } } } } }
    return { status: 200, body: { data: { generation: 2, replayed: false } } }
  }))
  await connect('a', 'alice')
  await connect('b', 'bob')
  const doc = storable()
  await assert.rejects(v2.store(room, 's-1', doc), (error: V2RuntimeError) => error.code === 'collaboration_participant_revoked')
  assert.equal(runtime.calls.filter(call => call.action === 'publish').length, 1, 'no automatic retry')
  assert.equal(closed.bob!.length, 1)
  assert.equal(closed.alice!.length, 0)
  await v2.store(room, 's-1', doc)
  assert.equal(runtime.calls.filter(call => call.action === 'publish').length, 2)
})

test('a publish for an invalid or expired session closes the room and later saves never reach the Runtime', async () => {
  const { runtime, v2, closed, connect } = harness(true, storeHandler(() => ({ status: 409, body: { code: 'collaboration_session_invalid' } })))
  await connect('a', 'alice')
  await connect('b', 'bob')
  v2.startLease(room, 's-1', () => {})
  const doc = storable()
  await assert.rejects(v2.store(room, 's-1', doc), (error: V2RuntimeError) => error.code === 'collaboration_session_invalid')
  assert.equal(closed.alice!.length, 1)
  assert.equal(closed.bob!.length, 1)
  const before = runtime.calls.length
  await assert.rejects(v2.store(room, 's-1', doc), (error: V2RuntimeError) => error.code === 'collaboration_session_expired')
  assert.equal(runtime.calls.length, before, 'late publishes are not sent')
  // A participant revocation that names nobody is treated as a lost session too.
  const other = harness(true, storeHandler(() => ({ status: 409, body: { code: 'collaboration_participant_revoked' } })))
  await other.connect('a', 'alice')
  await assert.rejects(other.v2.store(room, 's-1', storable()))
  assert.equal(other.closed.alice!.length, 1)
})

test('a document-level 409 on renewal closes the whole room and blocks persistence', async () => {
  const timers = captureTimers()
  try {
    const { runtime, v2, closed, connect } = harness(true, () => ({ status: 409, body: { code: 'collaboration_session_invalid' } }))
    await connect('a', 'alice')
    await connect('b', 'bob')
    let lost = 0
    v2.startLease(room, 's-1', () => { lost += 1 })
    timers.ticks[0]!.fn()
    await settle()
    assert.equal(lost, 1)
    assert.equal(closed.alice!.length, 1)
    assert.equal(closed.bob!.length, 1)
    assert.equal(closed.alice![0]!.reason, 'collaboration_session_closed')
    await assert.rejects(v2.store(room, 's-1', storable()), (error: V2RuntimeError) => error.code === 'collaboration_session_expired')
    assert.equal(runtime.calls.filter(call => call.action === 'read' || call.action === 'publish').length, 0)
  } finally { timers.restore() }
})

test('department lease is capped at 90s even if the Runtime reports longer; personal is not', async () => {
  const realNow = Date.now
  try {
    const dept = harness(true)
    await dept.connect('a', 'alice')
    Date.now = () => realNow() + 95_000
    await assert.rejects(dept.v2.store(room, 's-1', storable()), (error: V2RuntimeError) => error.code === 'collaboration_session_expired')
    Date.now = realNow
    const personal = harness(false, storeHandler(() => ({ status: 200, body: { data: { generation: 2, replayed: false } } })))
    await personal.v2.admit(ticketFor('a'), room)
    Date.now = () => realNow() + 95_000
    await personal.v2.store(room, 's-1', storable())
    assert.equal(personal.runtime.calls.filter(call => call.action === 'publish').length, 1)
  } finally { Date.now = realNow }
})

test('department sessions cap concurrent writers at 20 distinct users', async () => {
  const { v2 } = harness(true)
  for (let i = 0; i < DEPARTMENT_MAX_WRITERS; i++) await v2.admit(ticketFor(i.toString(16).padStart(2, '0')), room)
  await assert.rejects(v2.admit(ticketFor('fffff'), room), (error: V2RuntimeError) => error.code === 'collaboration_writer_limit')
  // The same user opening another tab is not an additional writer.
  await v2.admit(ticketFor('00'), room)
})

test('personal path is unchanged: no connectedUids, revokedUids ignored, no writer cap, no targeted close', async () => {
  const timers = captureTimers()
  try {
    const { runtime, v2, closed, connect } = harness(false, (action, body, call) => action === 'renew'
      ? { status: 200, body: { data: { expiresAt: future(), revokedUids: ['alice'] } } }
      : storeHandler(() => ({ status: 409, body: { code: 'collaboration_participant_revoked', revokedUids: ['alice'] } }))(action, body, call))
    await connect('a', 'alice')
    let lost = 0
    v2.startLease(room, 's-1', () => { lost += 1 })
    assert.equal(timers.ticks[0]!.delay, 45_000)
    timers.ticks[0]!.fn()
    await settle()
    assert.deepEqual(runtime.calls.find(call => call.action === 'renew')!.body, { sessionId: 's-1' })
    assert.equal(lost, 0)
    assert.equal(v2.isRevoked(room, 'alice'), false)
    await assert.rejects(v2.store(room, 's-1', storable()), (error: V2RuntimeError) => error.code === 'collaboration_participant_revoked')
    assert.equal(closed.alice!.length, 0, 'personal rooms never close individual connections')
    for (let i = 0; i < DEPARTMENT_MAX_WRITERS + 1; i++) await v2.admit(ticketFor(i.toString(16).padStart(2, '0')), room)
    v2.stopLease(room)
  } finally { timers.restore() }
})

test('logs and errors never contain tickets, tokens, Runtime bodies or document text', async () => {
  const output: string[] = []
  const originals = { log: console.log, warn: console.warn, error: console.error }
  const capture = (...args: unknown[]) => { output.push(args.map(String).join(' ')) }
  console.log = capture
  console.warn = capture
  console.error = capture
  const secretText = 'CONFIDENTIAL BODY TEXT'
  const timers = captureTimers()
  const errors: string[] = []
  try {
    const { v2, connect } = harness(true, (action, body, call) => {
      if (action === 'publish') return { status: 409, body: { code: 'collaboration_participant_revoked bearer token-1 secret', message: `Bearer token-1 ${secretText}`, revokedUids: ['bob'] } }
      if (action === 'renew') return { status: 409, body: { code: 'oops', message: `ticket ${ticketFor('a')}` } }
      return storeHandler(() => ({ status: 200, body: {} }))(action, body, call)
    })
    await connect('a', 'alice')
    await connect('b', 'bob')
    v2.startLease(room, 's-1', () => {})
    timers.ticks[0]!.fn()
    await settle()
    // Renewal already lost the room; use a fresh harness for the publish failure.
    const second = harness(true, storeHandler(() => ({ status: 409, body: { code: 'collaboration_participant_revoked bearer token-1 secret', message: `Bearer token-1 ${secretText}`, revokedUids: ['bob'] } })))
    await second.connect('b', 'bob')
    await second.v2.store(room, 's-1', storable(secretText)).catch((error: Error) => errors.push(error.message))
  } finally {
    Object.assign(console, originals)
    timers.restore()
  }
  const everything = [...output, ...errors].join('\n')
  assert.ok(output.length > 0, 'the flow logs something to check')
  assert.ok(errors.length > 0)
  for (const forbidden of ['a'.repeat(64), 'token-1', 'Bearer', 'secret', secretText]) assert.equal(everything.includes(forbidden), false, forbidden)
})

test('a v1 room refuses to save a document the Runtime reports as v2, and stays closed', async () => {
  const puts: string[] = []
  const blank = { bucketName: '', endpoint: '', accessKeyId: '', accessKeySecret: '', region: '' }
  const persistence = new PersistenceExtension(blank)
  Object.assign(persistence, { defaultClient: { put: async (path: string) => { puts.push(path); return { res: { headers: {} } } } } })
  configureCodocsRuntime({ endpoint: 'https://runtime.test' })
  const originalFetch = globalThis.fetch
  let status = 409
  let fetches = 0
  globalThis.fetch = (async () => {
    fetches += 1
    return new Response(JSON.stringify({ error: { message: 'document_on_snapshot_v2' } }), { status })
  }) as unknown as typeof fetch
  const context = { docId: 1, docUuid, docType: 'department', ossPath: 'codocs/dept/doc.md', ownerUid: 'o', actorUid: 'o', actorName: 'O', sharePermission: null, readonly: false }
  let closedRooms = 0
  const payload = { documentName: room, document: storable(), context, instance: { closeConnections: () => { closedRooms += 1 } } } as never
  try {
    await persistence.onStoreDocument(payload)
    assert.deepEqual(puts, [], 'no .yjs or mirror write')
    assert.equal(closedRooms, 1)
    await persistence.onStoreDocument(payload)
    assert.equal(fetches, 1, 'the refusal is remembered without another Runtime call')
    assert.deepEqual(puts, [])
    // Unknown state fails closed too.
    const other = new PersistenceExtension(blank)
    Object.assign(other, { defaultClient: { put: async (path: string) => { puts.push(path); return { res: { headers: {} } } } } })
    status = 503
    await assert.rejects(other.onStoreDocument(payload))
    assert.deepEqual(puts, [])
  } finally { globalThis.fetch = originalFetch }
})

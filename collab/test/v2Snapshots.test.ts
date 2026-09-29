import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import * as Y from 'yjs'
import { createV2RuntimeClient, createV2Snapshots, isV2Ticket, V2RuntimeError } from '../src/utils/v2-snapshots.js'
import type { CollabV2Config } from '../src/config.js'

const sha = (value: Uint8Array | string) => crypto.createHash('sha256').update(value).digest('hex')
const config: CollabV2Config = { enabled: true, tokenUrl: 'https://console.test/oauth/token', clientId: 'collab.runtime', clientSecret: 'secret', renewIntervalMs: 5_000 }
const docUuid = '11111111-2222-4333-8444-555555555555'
const ticket = `v2.${'a'.repeat(64)}`
const futureExpiry = () => new Date(Date.now() + 5 * 60_000).toISOString()

type Handler = (action: string, body: Record<string, unknown>, headers: Record<string, string>) => { status: number, body: unknown }

function fakeRuntime(handler: Handler) {
  const calls: Array<{ action: string, body: Record<string, unknown>, headers: Record<string, string> }> = []
  let tokens = 0
  const impl = (async (url: string, init: { body: string, headers: Record<string, string> }) => {
    if (url.endsWith('/oauth/token')) {
      tokens += 1
      return new Response(JSON.stringify({ access_token: `token-${tokens}`, expires_in: 900 }), { status: 200 })
    }
    const action = url.split(':').pop() || ''
    const body = JSON.parse(init.body)
    calls.push({ action, body, headers: init.headers })
    const result = handler(action, body, init.headers)
    return new Response(JSON.stringify(result.body), { status: result.status })
  }) as unknown as typeof fetch
  return { impl, calls, tokenCount: () => tokens }
}

// Stands in for the Runtime's :upload / :download: Collab never sees storage.
function fakeObjects(objects = new Map<string, { bytes: Buffer, version: string }>()) {
  const uploads: Array<Record<string, unknown>> = []
  let version = 0
  return {
    objects,
    uploads,
    upload(prefix: string, body: Record<string, unknown>) {
      version += 1
      const key = `${prefix}${body.attempt}/${body.part === 'yjs' ? 'state.yjs' : 'body.md'}`
      objects.set(key, { bytes: Buffer.from(String(body.contentBase64), 'base64'), version: `v${version}` })
      uploads.push(body)
      return { status: 200, body: { data: { key, version: `v${version}` } } }
    },
    download(object: { key: string, version: string }) {
      const stored = objects.get(object.key)
      return { status: 200, body: { data: { key: object.key, version: stored?.version, contentBase64: stored?.bytes.toString('base64') } } }
    }
  }
}

test('only well-formed v2 tickets are recognised; admission must match the requested document', async () => {
  assert.equal(isV2Ticket(ticket), true)
  for (const value of ['', 'v2.', `v2.${'A'.repeat(64)}`, `v1.${'a'.repeat(64)}`, `v2.${'a'.repeat(63)}`]) assert.equal(isV2Ticket(value), false, value)
  const runtime = fakeRuntime(action => ({ status: 200, body: { data: { sessionId: 's-1', documentUuid: docUuid, userUid: 'alice', access: 'write', epoch: 0, generation: 1, expiresAt: futureExpiry(), action } } }))
  const v2 = createV2Snapshots(createV2RuntimeClient('https://runtime.test', config, runtime.impl), config)
  assert.equal((await v2.admit(ticket, `doc:${docUuid}`)).userUid, 'alice')
  assert.deepEqual(runtime.calls[0]!.body, { ticket: 'a'.repeat(64) })
  await assert.rejects(v2.admit(ticket, 'doc:99999999-2222-4333-8444-555555555555'), (error: V2RuntimeError) => error.code === 'collaboration_document_mismatch')
  await assert.rejects(v2.admit('not-a-ticket', `doc:${docUuid}`), (error: V2RuntimeError) => error.status === 401)
})

test('admission without a valid confirmed expiry fails closed', async () => {
  for (const expiresAt of [undefined, 'invalid', new Date(Date.now() - 1000).toISOString()]) {
    const runtime = fakeRuntime(() => ({ status: 200, body: { data: { sessionId: 's-1', documentUuid: docUuid, userUid: 'alice', access: 'write', epoch: 0, generation: 1, expiresAt } } }))
    const v2 = createV2Snapshots(createV2RuntimeClient('https://runtime.test', config, runtime.impl), config)
    await assert.rejects(v2.admit(ticket, `doc:${docUuid}`), (error: V2RuntimeError) => error.code === 'collaboration_session_expired')
  }
})

test('load reads exact bytes through the Runtime: paired Yjs is applied, Markdown-only seeds a new history, tampering fails', async () => {
  const source = new Y.Doc()
  source.getText('content').insert(0, '# shared')
  const state = Buffer.from(Y.encodeStateAsUpdate(source))
  const markdown = Buffer.from('# from http save')
  const markdownObject = { key: 'codocs/snapshots/p/a/body.md', version: 'm1' }
  const yjsObject = { key: 'codocs/snapshots/p/a/state.yjs', version: 'y1' }
  const store = fakeObjects(new Map([[yjsObject.key, { bytes: state, version: 'y1' }], [markdownObject.key, { bytes: markdown, version: 'm1' }]]))
  let withYjs = true
  const runtime = fakeRuntime((action, body) => {
    if (action === 'download') return store.download(body.part === 'yjs' ? yjsObject : markdownObject)
    return { status: 200, body: { data: { documentUuid: docUuid, generation: 3, epoch: 0, sessionEpoch: 0, expiresAt: futureExpiry(), markdownSize: markdown.length, markdownSha256: sha(markdown), yjsSize: withYjs ? state.length : 0, yjsSha256: withYjs ? sha(state) : '', objects: { markdown: markdownObject, ...(withYjs ? { yjs: yjsObject } : {}) } } } }
  })
  const v2 = createV2Snapshots(createV2RuntimeClient('https://runtime.test', config, runtime.impl), config)
  const paired = new Y.Doc()
  await v2.load('doc:x', 's-1', paired)
  assert.equal(paired.getText('content').toString(), '# shared')
  const download = runtime.calls.find(call => call.action === 'download')!
  assert.deepEqual(download.body, { sessionId: 's-1', part: 'yjs' })
  withYjs = false
  const seeded = new Y.Doc()
  await v2.load('doc:y', 's-1', seeded)
  assert.equal(seeded.getText('content').toString(), '# from http save')
  store.objects.set(markdownObject.key, { bytes: Buffer.from('# tampered!!!!!!'), version: 'm1' })
  await assert.rejects(v2.load('doc:z', 's-1', new Y.Doc()), (error: V2RuntimeError) => error.code === 'snapshot_bytes_invalid')
  store.objects.set(markdownObject.key, { bytes: markdown, version: 'm2' })
  await assert.rejects(v2.load('doc:z', 's-1', new Y.Doc()), (error: V2RuntimeError) => error.code === 'snapshot_bytes_invalid')
})

test('store uploads a Markdown/Yjs pair through the Runtime under one fresh attempt, then publishes it with one retry key', async () => {
  const store = fakeObjects()
  const prefix = 'codocs/snapshots/h/doc/k/'
  const runtime = fakeRuntime((action, body) => {
    if (action === 'read') return { status: 200, body: { data: { generation: 4, epoch: 1, sessionEpoch: 1, expiresAt: futureExpiry(), markdownSize: 3, markdownSha256: 'x', yjsSize: 0, yjsSha256: '' } } }
    if (action === 'prepare') return { status: 200, body: { data: { prefix, generation: 4, replayed: false } } }
    if (action === 'upload') return store.upload(prefix, body)
    return { status: 200, body: { data: { generation: 5, replayed: false } } }
  })
  const v2 = createV2Snapshots(createV2RuntimeClient('https://runtime.test', config, runtime.impl), config)
  const doc = new Y.Doc()
  doc.getText('content').insert(0, 'hello')
  await v2.store('doc:a', 's-1', doc)
  const prepare = runtime.calls.find(call => call.action === 'prepare')!
  const uploads = runtime.calls.filter(call => call.action === 'upload')
  const publish = runtime.calls.find(call => call.action === 'publish')!
  assert.equal(prepare.headers['idempotency-key'], publish.headers['idempotency-key'])
  assert.ok(uploads.every(call => call.headers['idempotency-key'] === prepare.headers['idempotency-key']))
  assert.equal(prepare.body.generation, 4)
  assert.equal(prepare.body.epoch, 1)
  assert.equal(prepare.body.sessionId, 's-1')
  assert.deepEqual(uploads.map(call => call.body.part), ['markdown', 'yjs'])
  assert.match(String(uploads[0]!.body.attempt), /^[a-f0-9]{32}$/)
  assert.equal(uploads[0]!.body.attempt, uploads[1]!.body.attempt)
  // Each upload carries the prepared command, so the Runtime can match bytes to it.
  for (const upload of uploads) {
    for (const field of ['generation', 'epoch', 'markdownSha256', 'markdownSize', 'yjsSha256', 'yjsSize']) assert.equal(upload.body[field], prepare.body[field], field)
  }
  assert.equal(sha(Buffer.from(String(uploads[0]!.body.contentBase64), 'base64')), prepare.body.markdownSha256)
  assert.equal(sha(Buffer.from(String(uploads[1]!.body.contentBase64), 'base64')), prepare.body.yjsSha256)
  const objects = publish.body.objects as { markdown: { key: string, version: string }, yjs: { key: string, version: string } }
  assert.deepEqual([objects.markdown.version, objects.yjs.version], ['v1', 'v2'])
  assert.match(objects.markdown.key, /^codocs\/snapshots\/h\/doc\/k\/[a-f0-9]{32}\/body\.md$/)
  // Unchanged content is not published again.
  await v2.store('doc:a', 's-1', doc)
  assert.equal(runtime.calls.filter(call => call.action === 'publish').length, 1)
  // A CRDT-only change keeps Markdown equal but must publish a new pair.
  doc.getMap('meta').set('marker', 'same-markdown-new-yjs')
  await v2.store('doc:a', 's-1', doc)
  assert.equal(runtime.calls.filter(call => call.action === 'publish').length, 2)
  assert.equal(runtime.calls.filter(call => call.action === 'publish')[0]!.body.markdownSha256, runtime.calls.filter(call => call.action === 'publish')[1]!.body.markdownSha256)
  assert.notEqual(runtime.calls.filter(call => call.action === 'publish')[0]!.body.yjsSha256, runtime.calls.filter(call => call.action === 'publish')[1]!.body.yjsSha256)
  await v2.store('doc:a', 's-1', doc)
  assert.equal(runtime.calls.filter(call => call.action === 'publish').length, 2)
  // Empty content is never published over non-empty content.
  await v2.store('doc:empty', 's-1', new Y.Doc())
  assert.equal(runtime.calls.filter(call => call.action === 'publish').length, 2)
})

test('failed publish does not advance the paired lastStored baseline', async () => {
  const prefix = 'codocs/snapshots/h/doc/k/'
  const store = fakeObjects()
  let fail = true
  const runtime = fakeRuntime((action, body) => {
    if (action === 'read') return { status: 200, body: { data: { generation: 1, epoch: 0, sessionEpoch: 0, expiresAt: futureExpiry(), markdownSize: 0, markdownSha256: sha(''), yjsSize: 0, yjsSha256: '' } } }
    if (action === 'prepare') return { status: 200, body: { data: { prefix, generation: 1, replayed: false } } }
    if (action === 'upload') return store.upload(prefix, body)
    if (action === 'publish' && fail) return { status: 503, body: { code: 'unavailable' } }
    return { status: 200, body: { data: { generation: 2, replayed: false } } }
  })
  const v2 = createV2Snapshots(createV2RuntimeClient('https://runtime.test', config, runtime.impl), config)
  const doc = new Y.Doc()
  doc.getText('content').insert(0, 'retry')
  await assert.rejects(v2.store('doc:a', 's-1', doc), (error: V2RuntimeError) => error.status === 503)
  fail = false
  await v2.store('doc:a', 's-1', doc)
  assert.equal(runtime.calls.filter(call => call.action === 'publish').length, 2)
  await v2.store('doc:a', 's-1', doc)
  assert.equal(runtime.calls.filter(call => call.action === 'publish').length, 2)
})

test('store refuses an object the Runtime returns outside the prepared prefix', async () => {
  const runtime = fakeRuntime((action) => {
    if (action === 'read') return { status: 200, body: { data: { generation: 1, epoch: 0, sessionEpoch: 0, expiresAt: futureExpiry(), markdownSize: 1, markdownSha256: 'x', yjsSize: 0, yjsSha256: '' } } }
    if (action === 'prepare') return { status: 200, body: { data: { prefix: 'codocs/snapshots/h/doc/k/', generation: 1, replayed: false } } }
    if (action === 'upload') return { status: 200, body: { data: { key: 'codocs/snapshots/other/body.md', version: 'v1' } } }
    return { status: 200, body: { data: { generation: 2, replayed: false } } }
  })
  const v2 = createV2Snapshots(createV2RuntimeClient('https://runtime.test', config, runtime.impl), config)
  const doc = new Y.Doc()
  doc.getText('content').insert(0, 'x')
  await assert.rejects(v2.store('doc:a', 's-1', doc), (error: V2RuntimeError) => error.code === 'snapshot_object_invalid')
  assert.equal(runtime.calls.filter(call => call.action === 'publish').length, 0)
})

test('a Runtime refusal of the lease closes the room; transient failures do not', async () => {
  let status = 503
  const runtime = fakeRuntime(action => action === 'admit'
    ? { status: 200, body: { data: { sessionId: 's-1', documentUuid: docUuid, userUid: 'alice', access: 'write', epoch: 0, generation: 1, expiresAt: futureExpiry() } } }
    : { status, body: { code: status === 409 ? 'collaboration_session_invalid' : 'unavailable' } })
  const v2 = createV2Snapshots(createV2RuntimeClient('https://runtime.test', config, runtime.impl), config)
  await v2.admit(ticket, `doc:${docUuid}`)
  let lost = 0
  const originalSetInterval = globalThis.setInterval
  const ticks: Array<() => void> = []
  globalThis.setInterval = ((fn: () => void) => { ticks.push(fn); return 1 as unknown as ReturnType<typeof setInterval> }) as unknown as typeof setInterval
  try {
    v2.startLease(`doc:${docUuid}`, 's-1', () => { lost += 1 })
    ticks[0]!()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(lost, 0, '503 keeps the room')
    status = 409
    ticks[0]!()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(lost, 1, '409 closes the room')
  } finally {
    globalThis.setInterval = originalSetInterval
    v2.stopLease(`doc:${docUuid}`)
  }
})

test('a transient renewal failure cannot extend the confirmed lease; expiry closes and blocks stores', async () => {
  const runtime = fakeRuntime(action => action === 'admit'
    ? { status: 200, body: { data: { sessionId: 's-1', documentUuid: docUuid, userUid: 'alice', access: 'write', epoch: 0, generation: 1, expiresAt: new Date(Date.now() + 1_250).toISOString() } } }
    : { status: 503, body: { code: 'unavailable' } })
  const v2 = createV2Snapshots(createV2RuntimeClient('https://runtime.test', config, runtime.impl), config)
  await v2.admit(ticket, `doc:${docUuid}`)
  let lost = 0
  v2.startLease(`doc:${docUuid}`, 's-1', () => { lost += 1 })
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.equal(lost, 1)
  const doc = new Y.Doc()
  doc.getText('content').insert(0, 'late write')
  await assert.rejects(v2.store(`doc:${docUuid}`, 's-1', doc), (error: V2RuntimeError) => error.code === 'collaboration_session_expired')
  assert.equal(runtime.calls.filter(call => call.action === 'read').length, 0, 'no Runtime write path after expiry')
})

test('renewal is single-flight and a late result after stop cannot revive the lease', async () => {
  const runtime = fakeRuntime(action => ({ status: 200, body: { data: { sessionId: 's-1', documentUuid: docUuid, userUid: 'alice', access: 'write', epoch: 0, generation: 1, expiresAt: futureExpiry(), action } } }))
  const client = createV2RuntimeClient('https://runtime.test', config, runtime.impl)
  let renewCalls = 0
  let finishRenew!: (value: { expiresAt: string }) => void
  client.renew = () => {
    renewCalls += 1
    return new Promise(resolve => { finishRenew = resolve })
  }
  const v2 = createV2Snapshots(client, config)
  await v2.admit(ticket, `doc:${docUuid}`)
  const originalSetInterval = globalThis.setInterval
  const ticks: Array<() => void> = []
  globalThis.setInterval = ((fn: () => void) => { ticks.push(fn); return 1 as unknown as ReturnType<typeof setInterval> }) as unknown as typeof setInterval
  try {
    let lost = 0
    v2.startLease(`doc:${docUuid}`, 's-1', () => { lost += 1 })
    ticks[0]!()
    ticks[0]!()
    assert.equal(renewCalls, 1)
    v2.stopLease(`doc:${docUuid}`)
    finishRenew({ expiresAt: futureExpiry() })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(lost, 0)
    assert.equal(renewCalls, 1)
  } finally {
    globalThis.setInterval = originalSetInterval
    v2.stopLease(`doc:${docUuid}`)
  }
})

test('a hanging renewal is aborted at the timeout and may retry only while the confirmed lease is live', async () => {
  const runtime = fakeRuntime(() => ({ status: 200, body: { data: { sessionId: 's-1', documentUuid: docUuid, userUid: 'alice', access: 'write', epoch: 0, generation: 1, expiresAt: futureExpiry() } } }))
  const client = createV2RuntimeClient('https://runtime.test', config, runtime.impl)
  let renewCalls = 0
  client.renew = (_sessionId, signal) => {
    renewCalls += 1
    return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  }
  const v2 = createV2Snapshots(client, config)
  await v2.admit(ticket, `doc:${docUuid}`)
  const originalInterval = globalThis.setInterval
  const originalTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const ticks: Array<() => void> = []
  const timeouts: Array<{ fn: () => void, delay: number }> = []
  globalThis.setInterval = ((fn: () => void) => { ticks.push(fn); return 1 as unknown as ReturnType<typeof setInterval> }) as unknown as typeof setInterval
  globalThis.setTimeout = ((fn: () => void, delay: number) => { timeouts.push({ fn, delay }); return timeouts.length as unknown as ReturnType<typeof setTimeout> }) as unknown as typeof setTimeout
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout
  try {
    v2.startLease(`doc:${docUuid}`, 's-1', () => {})
    ticks[0]!()
    ticks[0]!()
    assert.equal(renewCalls, 1)
    timeouts.find(item => item.delay === 5_000)!.fn()
    await new Promise(resolve => setImmediate(resolve))
    ticks[0]!()
    assert.equal(renewCalls, 2)
  } finally {
    v2.stopLease(`doc:${docUuid}`)
    globalThis.setInterval = originalInterval
    globalThis.setTimeout = originalTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
})

test('a 401 from the Runtime forces one token refresh and retries once', async () => {
  let first = true
  const runtime = fakeRuntime(() => {
    if (first) {
      first = false
      return { status: 401, body: { code: 'invalid_token' } }
    }
    return { status: 200, body: { data: { expiresAt: 'x' } } }
  })
  const client = createV2RuntimeClient('https://runtime.test', config, runtime.impl)
  await client.renew('s-1')
  assert.equal(runtime.tokenCount(), 2)
  assert.equal(runtime.calls[1]!.headers.authorization, 'Bearer token-2')
})

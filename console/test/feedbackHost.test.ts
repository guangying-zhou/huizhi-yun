import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { executeFeedbackRequest } from '../server/utils/feedbackHost'
import type { RuntimeScopedAuthorizationSnapshot } from '@hzy/foundation/server/utils/platformBundleAuthorization'

test('feedback BFF authorizes current scoped grants, binds identity and rejects injected authority', async () => {
  let permission = 'submit'
  let mode = 'merged'
  let unavailable = false
  const calls: Record<string, unknown>[] = []
  const app = createApp().use(defineEventHandler(event => executeFeedbackRequest(event, 'draft', {
    identity: async () => ({ uid: 'alice', tenant: 'T1', deployment: 'T1-enterprise' }),
    authorize: async () => {
      if (unavailable) throw Object.assign(new Error('policy unavailable'), { statusCode: 503 })
      return { uid: 'alice', appCode: 'console', roles: [], availableRoles: [], activeRoleCode: '', authorizationMode: mode, bundleVersion: 'v1', bundleHash: 'hash', policyRevision: 1, authorizationExpiresAt: Date.now() + 5000, grants: [{ grantId: 'g1', scopes: [{ dimension: 'subject', predicate: 'self' }], permissions: [{ appCode: 'console', resourceCode: 'feedback', action: permission }] }] } satisfies RuntimeScopedAuthorizationSnapshot
    },
    call: async (body) => {
      calls.push(body)
      return { code: 0 }
    }
  })))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const send = (body: unknown) => fetch(`http://127.0.0.1:${address.port}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'attempt-1' }, body: JSON.stringify(body) })
    assert.equal((await send({ text: { title: '反馈' } })).status, 200)
    const permit = calls[0]!.authorization as Record<string, unknown>
    assert.equal(permit.actorUid, 'alice')
    assert.equal(permit.tenant, 'T1')
    assert.equal(permit.action, 'submit')
    assert.equal(permit.global, false)
    assert.ok(Number(permit.expiresAt) <= Date.now() + 5000)
    assert.equal((await send({ text: { title: '反馈' }, authorization: { action: 'admin' } })).status, 400)
    assert.equal((await send({ uid: 'bob' })).status, 400)
    permission = 'admin'
    assert.equal((await send({ text: { title: '反馈' } })).status, 403)
    permission = 'submit'
    mode = 'role_simulation'
    assert.equal((await send({ text: { title: '反馈' } })).status, 403)
    mode = 'merged'
    unavailable = true
    assert.equal((await send({ text: { title: '反馈' } })).status, 503)
    assert.equal(calls.length, 1, 'denials never call Runtime')
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('feedback list filters are signed command fields and never expand the actor scope', async () => {
  const calls: Record<string, unknown>[] = []
  const app = createApp().use(defineEventHandler(event => executeFeedbackRequest(event, 'list', {
    identity: async () => ({ uid: 'alice', tenant: 'T1', deployment: 'T1-enterprise' }),
    authorize: async () => ({ uid: 'alice', appCode: 'console', roles: [], availableRoles: [], activeRoleCode: '', authorizationMode: 'merged', bundleVersion: 'v1', bundleHash: 'hash', policyRevision: 1, authorizationExpiresAt: Date.now() + 5000, grants: [{ grantId: 'g1', scopes: [{ dimension: 'subject', predicate: 'self' }], permissions: [{ appCode: 'console', resourceCode: 'feedback', action: 'view' }] }] } satisfies RuntimeScopedAuthorizationSnapshot),
    call: async (body) => {
      calls.push(body)
      return { code: 0 }
    }
  })))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as { port: number }
    const url = `http://127.0.0.1:${port}`
    assert.equal((await fetch(`${url}?page=2&pageSize=5&status=failed&kind=bug`)).status, 200)
    assert.deepEqual(JSON.parse(String(calls[0]!.payload)), { page: 2, pageSize: 5, status: 'failed', kind: 'bug' })
    assert.equal((calls[0]!.authorization as Record<string, unknown>).global, false)
    assert.equal((await fetch(`${url}?reporterUid=bob`)).status, 400)
    assert.equal(calls.length, 1)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('binary feedback upload is bounded, signed with submit and refuses simulation or view-only authority', async () => {
  let permission = 'submit', mode = 'merged'
  const calls: Record<string, unknown>[] = []
  const app = createApp().use(defineEventHandler((event) => {
    event.context.params = { id: 'F1', attachmentId: '11111111-1111-4111-8111-111111111111' }
    return executeFeedbackRequest(event, 'attachment-put', {
      identity: async () => ({ uid: 'alice', tenant: 'T1', deployment: 'T1-enterprise' }),
      authorize: async () => ({ uid: 'alice', appCode: 'console', roles: [], availableRoles: [], activeRoleCode: '', authorizationMode: mode, bundleVersion: 'v1', bundleHash: 'hash', policyRevision: 1, authorizationExpiresAt: Date.now() + 5000, grants: [{ grantId: 'self', scopes: [{ dimension: 'subject', predicate: 'self' }], permissions: [{ appCode: 'console', resourceCode: 'feedback', action: permission }] }] } satisfies RuntimeScopedAuthorizationSnapshot),
      call: async (body) => {
        calls.push(body)
        return { data: {} }
      }
    })
  }))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const send = (body: Uint8Array, mime = 'image/png') => fetch(url, { method: 'PUT', headers: { 'Content-Type': mime, 'Idempotency-Key': 'media-attempt' }, body })
  try {
    assert.equal((await send(new Uint8Array([1, 2, 3]))).status, 200)
    const command = JSON.parse(String(calls[0]!.payload))
    assert.equal(command.image, 'AQID')
    assert.equal(command.id, 'F1')
    assert.equal(command.attachmentId, '11111111-1111-4111-8111-111111111111')
    assert.equal((calls[0]!.authorization as Record<string, unknown>).action, 'submit')
    assert.match(command.sha256, /^[a-f0-9]{64}$/)
    assert.equal((await send(new Uint8Array([1]), 'image/svg+xml')).status, 415)
    assert.equal((await send(new Uint8Array(5 * 1024 * 1024 + 1))).status, 413)
    permission = 'view'
    assert.equal((await send(new Uint8Array([1]))).status, 403)
    permission = 'submit'
    mode = 'role_simulation'
    assert.equal((await send(new Uint8Array([1]))).status, 403)
    assert.equal(calls.length, 1)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('media cleanup binds the route object and requires an explicit global admin grant', async () => {
  let action = 'admin'
  const calls: Record<string, unknown>[] = []
  const server = createServer(toNodeListener(createApp().use(defineEventHandler((event) => {
    event.context.params = { id: 'cancelled-feedback' }
    return executeFeedbackRequest(event, 'cleanup-media', {
      identity: async () => ({ uid: 'admin', tenant: 'T1', deployment: 'T1-console' }),
      authorize: async () => ({ uid: 'admin', appCode: 'console', authorizationMode: 'merged', roles: [], availableRoles: [], activeRoleCode: '', bundleVersion: 'v1', bundleHash: 'hash', policyRevision: 1, authorizationExpiresAt: Date.now() + 5000, grants: [{ grantId: 'admin', scopes: [{ dimension: 'tenant', predicate: 'global' }], permissions: [{ appCode: 'console', resourceCode: 'feedback', action }] }] } satisfies RuntimeScopedAuthorizationSnapshot),
      call: async (body) => {
        calls.push(body)
        return { data: {} }
      }
    })
  }))))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const send = () => fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'cleanup-intent' }, body: '{}' })
  try {
    assert.equal((await send()).status, 200)
    assert.deepEqual(JSON.parse(String(calls[0]!.payload)), { id: 'cancelled-feedback' })
    action = 'view'
    assert.equal((await send()).status, 403)
    assert.equal(calls.length, 1)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

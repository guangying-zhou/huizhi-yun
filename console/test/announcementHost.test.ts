import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { executeAnnouncementRequest } from '../server/utils/announcementHost'
import type { RuntimeScopedAuthorizationSnapshot } from '@hzy/foundation/server/utils/platformBundleAuthorization'

test('announcement BFF authorizes current scoped grants, binds identity and rejects injected authority', async () => {
  let permission = 'admin'
  let mode = 'merged'
  let unavailable = false
  const calls: Record<string, unknown>[] = []
  const app = createApp().use(defineEventHandler(event => executeAnnouncementRequest(event, 'save', {
    identity: async () => ({ uid: 'alice', tenant: 'T1', deployment: 'T1-enterprise' }),
    authorize: async () => {
      if (unavailable) throw Object.assign(new Error('policy unavailable'), { statusCode: 503 })
      return { uid: 'alice', appCode: 'console', roles: [], availableRoles: [], activeRoleCode: '', authorizationMode: mode, bundleVersion: 'v1', bundleHash: 'hash', policyRevision: 1, authorizationExpiresAt: Date.now() + 5000, grants: [{ grantId: 'g1', permissions: [{ appCode: 'console', resourceCode: 'announcements', action: permission }] }] } satisfies RuntimeScopedAuthorizationSnapshot
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
    assert.equal((await send({ title: '公告' })).status, 200)
    const permit = calls[0]!.authorization as Record<string, unknown>
    assert.equal(permit.actorUid, 'alice')
    assert.equal(permit.tenant, 'T1')
    assert.equal(permit.action, 'admin')
    assert.ok(Number(permit.expiresAt) <= Date.now() + 5000)
    assert.equal((await send({ title: '公告', authorization: { action: 'admin' } })).status, 400)
    assert.equal((await send({ uid: 'bob' })).status, 400)
    permission = 'view'
    assert.equal((await send({ title: '公告' })).status, 403)
    permission = 'admin'
    mode = 'role_simulation'
    assert.equal((await send({ title: '公告' })).status, 403)
    mode = 'merged'
    unavailable = true
    assert.equal((await send({ title: '公告' })).status, 503)
    assert.equal(calls.length, 1, 'denials never call Runtime')
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('trusted immediate-delivery status targets its own announcement, while employee reads remain view-only', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  let action = 'view'
  let operation: 'list' | 'deliver' = 'list'
  const calls: Record<string, unknown>[] = []
  const app = createApp().use(defineEventHandler(event => executeAnnouncementRequest(event, operation, {
    identity: async () => ({ uid: 'alice', tenant: 'T1', deployment: 'T1-enterprise' }),
    authorize: async () => ({ uid: 'alice', appCode: 'console', roles: [], availableRoles: [], activeRoleCode: '', authorizationMode: 'merged', bundleVersion: 'v1', bundleHash: 'hash', policyRevision: 1, authorizationExpiresAt: Date.now() + 5000, grants: [{ grantId: 'g1', permissions: [{ appCode: 'console', resourceCode: 'announcements', action }] }] }),
    commandOverride: operation === 'deliver' ? { id } : {},
    keyOverride: 'announcement-status:test',
    call: async (body) => {
      calls.push(body)
      return { code: 0 }
    }
  })))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as { port: number }
    const send = () => fetch(`http://127.0.0.1:${port}`, { method: 'POST', body: '{}' })
    assert.equal((await send()).status, 200)
    operation = 'deliver'
    assert.equal((await send()).status, 403)
    action = 'admin'
    assert.equal((await send()).status, 200)
    assert.deepEqual(JSON.parse(String(calls[1]!.payload)), { id })
    assert.equal(calls.length, 2)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

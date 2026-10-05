import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createShareCreationAttempt } from '../layer/shareCreationAttempt.mjs'

function memoryStorage() {
  const entries = new Map()
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key),
    entries
  }
}

test('share retry key survives reload for the same scoped request and clears on success', async () => {
  const storage = memoryStorage()
  let next = 0
  const attempt = () => createShareCreationAttempt({ storage: () => storage, newKey: () => `retry-${++next}` })
  const scope = 'tenant:user:doc-a:target-a:read'
  const payload = { sharedToUid: 'target-a', permission: 'read', message: 'note' }
  const first = await attempt().keyFor(scope, payload)
  assert.equal(first, 'retry-1')
  assert.equal(await attempt().keyFor(scope, { message: 'note', permission: 'read', sharedToUid: 'target-a' }), first)
  assert.equal(storage.entries.size, 1)
  assert.doesNotMatch([...storage.entries.values()][0], /note/)

  const changed = await attempt().keyFor(scope, { ...payload, message: 'new note' })
  assert.notEqual(changed, first)
  const inFlight = attempt()
  assert.equal(await inFlight.keyFor(scope, { ...payload, message: 'new note' }), changed)
  inFlight.complete(scope, first)
  assert.equal(storage.entries.size, 1, 'an older completion does not clear the new attempt')
  inFlight.complete(scope, changed)
  assert.equal(storage.entries.size, 0)
  assert.notEqual(await attempt().keyFor(scope, { ...payload, message: 'new note' }), changed)
})

test('document, target, permission and session scopes do not share keys', async () => {
  const storage = memoryStorage()
  let next = 0
  const attempt = createShareCreationAttempt({ storage: () => storage, newKey: () => `retry-${++next}` })
  const body = { sharedToUid: 'target-a', permission: 'read', message: null }
  const scopes = [
    'tenant:user:doc-a:target-a:read',
    'tenant:user:doc-b:target-a:read',
    'tenant:user:doc-a:target-b:read',
    'tenant:user:doc-a:target-a:write',
    'tenant:other-user:doc-a:target-a:read'
  ]
  const keys = await Promise.all(scopes.map(scope => attempt.keyFor(scope, body)))
  assert.equal(new Set(keys).size, scopes.length)
  assert.equal(storage.entries.size, scopes.length)
})

test('unavailable sessionStorage falls back to a component-local retry', async () => {
  let next = 0
  const attempt = createShareCreationAttempt({
    storage: () => { throw Error('blocked') },
    newKey: () => `retry-${++next}`
  })
  const body = { sharedToUid: 'target-a', permission: 'read', message: null }
  const key = await attempt.keyFor('scope', body)
  assert.equal(await attempt.keyFor('scope', body), key)
  attempt.complete('scope', key)
  assert.notEqual(await attempt.keyFor('scope', body), key)
})

test('share modal binds effective permission and current user to the stored attempt', () => {
  const source = readFileSync(new URL('../app/components/document/ShareDocumentModal.vue', import.meta.url), 'utf8')
  assert.match(source, /cacheKey\(`document-share:\$\{user\.value \|\| 'unverified'\}:\$\{props\.docId\}:\$\{targetUser\.uid\}:\$\{payload\.permission\}`\)/)
  assert.match(source, /await shareAttempt\.keyFor\(attemptScope, payload\)/)
  assert.match(source, /shareAttempt\.complete\(attemptScope, attemptKey\)/)
})

test('transfer retry survives reload within its own namespace and clears after success', async () => {
  const storage = memoryStorage()
  let next = 0
  const attempt = () => createShareCreationAttempt({
    storage: () => storage,
    newKey: () => `transfer-${++next}`,
    storagePrefix: 'codocs:pending-document-transfer'
  })
  const scope = 'tenant:session:document-transfer:department:owner:doc-a:dept-a'
  const payload = { deptCode: 'dept-a', departmentName: 'Department A' }
  const first = await attempt().keyFor(scope, payload)
  assert.equal(await attempt().keyFor(scope, payload), first)
  assert.equal([...storage.entries.keys()][0], `codocs:pending-document-transfer:${scope}`)
  assert.equal(await attempt().keyFor(scope, { ...payload, deptCode: 'dept-b' }), 'transfer-2')
  const restored = attempt()
  assert.equal(await restored.keyFor(scope, payload), 'transfer-3', 'changed target cannot reuse another target key')
  restored.complete(scope, 'transfer-3')
  assert.equal(storage.entries.size, 0)
  assert.notEqual(await attempt().keyFor(scope, payload), first)
})

test('transfer modal scopes retry keys by session, actor, document, action and target', () => {
  const source = readFileSync(new URL('../app/components/document/TransferDocumentModal.vue', import.meta.url), 'utf8')
  assert.match(source, /storagePrefix: 'codocs:pending-document-transfer'/)
  assert.match(source, /document-transfer:department:\$\{user\.value \|\| 'unverified'\}:\$\{props\.docId\}:\$\{payload\.deptCode\}/)
  assert.match(source, /document-transfer:project:\$\{user\.value \|\| 'unverified'\}:\$\{props\.docId\}:\$\{payload\.projectCode\}/)
  assert.equal((source.match(/transferAttempt\.complete\(attemptScope, attemptKey\)/g) || []).length, 2)
})

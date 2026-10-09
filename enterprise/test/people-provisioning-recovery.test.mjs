import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseProvisioningRecovery, serializeProvisioningRecovery, provisioningIdentityScope } from '../app/utils/peopleProvisioningRecovery.ts'

const intent = { id: '17', action: 'provision', expectedVersion: 4, key: 'people-onboarding-account:12345678-1234-4234-8234-123456789abc' }
test('refresh restores only original scope-bound request metadata, never target facts', () => {
  const raw = serializeProvisioningRecovery(intent, 'actor:tenant:deployment')
  assert.deepEqual(parseProvisioningRecovery(raw, 'actor:tenant:deployment'), intent)
  assert.equal(parseProvisioningRecovery(raw, 'other:tenant:deployment'), null)
  for (const change of [{ action: 'force-success' }, { expectedVersion: 0 }, { expectedVersion: 4294967296 }, { key: 'new-key' }, { id: '../17' }, { confirmation: { succeeded: true } }, { uid: 'someone' }]) {
    assert.equal(parseProvisioningRecovery(JSON.stringify({ scope: 'actor:tenant:deployment', ...intent, ...change }), 'actor:tenant:deployment'), null)
  }
  assert.equal(parseProvisioningRecovery('{', 'actor:tenant:deployment'), null)
  assert.doesNotMatch(raw, /candidate_name|canonical_uid|token|secret|confirmation|command/)
})
test('recovery UI retains original key/version/action before request, blocks competing intent and separates target stages', () => {
  const s = readFileSync(new URL('../app/components/PeopleOnboardingPage.vue', import.meta.url), 'utf8')
  assert.ok(s.indexOf('sessionStorage.setItem') < s.indexOf('accountIntent.submit'))
  for (const x of ['parseProvisioningRecovery', 'original.row.object_version', 'original.action', 'Idempotency-Key', 'Boolean(accountRetry)', 'scope.value !== currentScope', 'Console 开通', 'Directory 同步', 'Platform 授权']) assert.ok(s.includes(x), x)
  assert.doesNotMatch(s, /localStorage|force-success|confirmation:\s*\{/)
})

test('policy refresh retains the original intent only for the same verified identity and deployment', () => {
  const cache = (tenant = 'C000001', uid = 'HR-A', deployment = 'C000001-test-enterprise', revision = '41') => JSON.stringify([tenant, uid, 'subject-A', revision, deployment])
  const identity = provisioningIdentityScope(cache())
  const raw = serializeProvisioningRecovery(intent, identity)
  assert.deepEqual(parseProvisioningRecovery(raw, provisioningIdentityScope(cache(undefined, undefined, undefined, '42'))), intent)
  for (const changed of [cache('other'), cache(undefined, 'HR-B'), cache(undefined, undefined, 'C000001-prod-enterprise')]) assert.equal(parseProvisioningRecovery(raw, provisioningIdentityScope(changed)), null)
  for (const malformed of ['', '{}', '[]', JSON.stringify(['C000001', 'HR-A', '', '41', '']), JSON.stringify(['C000001', '', '', '41', 'test'])]) assert.equal(provisioningIdentityScope(malformed), '')
})

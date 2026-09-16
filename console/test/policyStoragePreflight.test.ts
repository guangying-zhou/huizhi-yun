import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyPolicyStorageIssuance } from '../server/utils/policyStoragePreflight.ts'

const context = { tenant: 'tenant-a', deployment: 'console-a', issuer: 'https://tenant.example' }
function issued(audience: string, scope: string, overrides = {}) {
  const now = Math.floor(Date.now() / 1000)
  return `header.${Buffer.from(JSON.stringify({ iss: context.issuer, aud: audience, scope, tenant: context.tenant, deployment: context.deployment, source_app: 'console', target_app: audience, token_use: 'service', client_id: 'console.runtime', hzy: { credentialId: 1 }, iat: now, exp: now + 60, ...overrides })).toString('base64url')}.signature`
}
test('policy rollout probes both audiences and all three scope combinations without returning tokens', async () => {
  const results = await verifyPolicyStorageIssuance(async (audience, scope) => issued(audience, scope), context)
  assert.equal(results.length, 6)
  assert.ok(results.every(result => result.issued))
  assert.ok(!JSON.stringify(results).includes('signature'))
})
test('policy rollout stops on denied issuance and wrong tenant or expired tokens', async () => {
  await assert.rejects(verifyPolicyStorageIssuance(async () => {
    throw new Error('denied')
  }, context), /denied/)
  for (const overrides of [{ tenant: 'other' }, { exp: 1 }, { target_app: 'other' }, { hzy: {} }]) {
    await assert.rejects(verifyPolicyStorageIssuance(async (audience, scope) => issued(audience, scope, overrides), context), /binding invalid/)
  }
})

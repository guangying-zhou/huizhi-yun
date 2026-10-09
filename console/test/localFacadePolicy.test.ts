import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../server/utils/oidc.ts', import.meta.url), 'utf8')
const body = source.split('export async function loadOidcPolicyDigest(event: H3Event) {')[1]!.split('\nfunction buildDirectorySnapshot')[0]!
const make = new Function('resolveLocalConsoleFacade', 'loadPlatformRuntimeConfig', 'readCachedBundle',
  'resolvePlatformRuntimeCacheScope', 'createError', 'verifiedPolicyStoreEnabled',
  ts.transpile(`return async function(event) {${body}`, { target: ts.ScriptTarget.ES2022 }))

function load(local: boolean, read: () => Promise<unknown>, verified = false) {
  return make(() => local ? {} : null, () => ({ tenantCode: 'C000001', deploymentCode: 'test' }),
    read, () => 'scope', (input: object) => Object.assign(new Error('fixture'), input), () => verified)({})
}

test('local facade refuses missing or unreadable policy before issuing tokens', async () => {
  const failedRead = async () => {
    throw Error('integrity failure')
  }
  for (const read of [async () => null, failedRead]) {
    await assert.rejects(load(true, read), { statusCode: 503, data: { code: 'local_console_policy_unavailable' } })
  }
  const result = await load(true, async () => ({ tenantCode: 'C000001', deploymentCode: 'test', bundleVersion: 'v1', bundleHash: 'hash' }))
  assert.equal(result.policyVersion, 'v1')
})

test('non-facade policy behavior remains unchanged', async () => {
  assert.equal((await load(false, async () => null)).policyVersion, null)
})

test('explicit verified backend refuses policyless sessions outside local facade', async () => {
  const failedRead = async () => {
    throw Error('expired envelope')
  }
  for (const read of [async () => null, failedRead]) {
    await assert.rejects(load(false, read, true), { statusCode: 503, data: { code: 'verified_console_policy_unavailable' } })
  }
})

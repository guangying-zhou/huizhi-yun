import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { coalescePolicyRead } from '../server/utils/persistentPolicyBundle'

test('local issuer merges only identical pending requests in the same HTTP event', async () => {
  const source = readFileSync(new URL('../server/plugins/service-token-issuer.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  let issuer: (input: Record<string, unknown>) => Promise<unknown> = async () => null
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const dependencies = {
    '@hzy/foundation/server/utils/serviceOidc': { setLocalServiceTokenIssuer: (fn: typeof issuer) => { issuer = fn } },
    '@hzy/foundation/server/utils/consoleTenantRuntimeClient': { issueConsoleRuntimeServiceToken: async () => {
      calls++
      await gate
      return { data: { accessToken: 'fixture' } }
    } },
    '~~/server/utils/oidc': { getOidcIssuer: () => 'https://fixture.test', getOidcTtl: () => 60,
      loadOidcPolicyDigest: async () => ({ policyVersion: 'v1', caps: 'fixture' }) },
    '~~/server/utils/policyStorageToken': { isPolicyStorageToken: () => false },
    '~~/server/utils/persistentPolicyBundle': { coalescePolicyRead }
  }
  new Function('require', 'exports', 'defineNitroPlugin', compiled)(
    (key: keyof typeof dependencies) => dependencies[key], {}, (setup: () => void) => setup())
  const input = { event: {}, audience: 'data-runtime', scope: 'console:auth-session:read' }
  const work = [issuer(input), issuer(input), issuer({ ...input, event: {} }),
    issuer({ ...input, scope: 'console:policy-bundle:read' }),
    issuer({ ...input, sourceBinding: 'service-client-policy' }),
    issuer({ ...input, deploymentCodeOverride: 'other' }), issuer({ ...input, audience: 'console' })]
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 6)
  release()
  await Promise.all(work)
  await issuer(input)
  assert.equal(calls, 7, 'settled token must not be reused for a later grant decision')
  assert.equal(await issuer({ ...input, event: null }), null)
})

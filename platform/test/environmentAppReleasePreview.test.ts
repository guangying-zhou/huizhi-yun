import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createError } from 'h3'
import { generateKeyPairSync, sign as signBytes, verify } from 'node:crypto'
import { stableStringifyPolicyPayload } from '../server/utils/policyEnvelopeDelivery.ts'
import { hashPolicyBundlePayload } from '../server/utils/environmentPolicyPayload.ts'
import type { Fact } from '../server/utils/environmentAppReleaseModel.ts'

test('actual preview + payload builder: zero writes/signing, historical catalog, secret redaction and stable review hash', async () => {
  const base = resolve(import.meta.dirname, '..')
  const releases = [
    { id: 3, app_code: 'console', release_version: 'v3', source_tag: 'console/v3', manifest_id: 3, manifest_hash: 'three', manifest_json: { recommendedRoles: [] } },
    { id: 1, app_code: 'finance', release_version: 'v1', source_tag: 'finance/v1', manifest_id: 1, manifest_hash: 'one', manifest_json: { recommendedRoles: [] } },
    { id: 2, app_code: 'finance', release_version: 'v2', source_tag: 'finance/v2', manifest_id: 2, manifest_hash: 'two', manifest_json: { recommendedRoles: [] } }
  ]
  const resources = (id: number) => [{ appCode: 'finance', manifestId: id, resourceCode: id === 1 ? 'overview' : 'future-apf', status: 'active' }]
  const baseline = { tenant: { tenantCode: 'T' }, environment: 'prod', policyRevision: 39, manifestResources: resources(1), applications: [{ appCode: 'finance' }], consoleLogin: { oidc: { clientSecret: 'BASELINE_TEST_SECRET' } } }
  const bundle = { id: 40, tenant_code: 'T', environment: 'prod', policy_revision: 39, bundle_hash: hashPolicyBundlePayload(stableStringifyPolicyPayload(baseline)), bundle_payload_json: baseline, signature: 'trusted-db-fixture' }
  const pair = generateKeyPairSync('ed25519')
  let allowSigning = false
  let signedText = ''
  const mutations: Array<{ sql: string, params: unknown[] }> = []
  let reads = 0
  let writes = 0
  let signs = 0
  const queryRows = async (sql: string, params: unknown[] = []): Promise<Fact[]> => {
    reads++
    assert.match(sql.trim(), /^SELECT\b/)
    if (sql.includes('information_schema.COLUMNS')) return [{ COLUMN_NAME: 'source_type' }]
    if (sql.includes('tenant_environment_app_release_sets')) return [{ revision: 1, source_bundle_id: 40, source_bundle_hash: bundle.bundle_hash }]
    if (sql.includes('tenant_environment_app_releases')) return [{ appCode: 'finance', releaseId: 1 }]
    if (sql.includes('MAX(id) AS id FROM policy_bundles')) return [{ id: 40 }]
    if (sql.includes('COUNT(*) + 1 AS nextSeq')) return [{ nextSeq: 2 }]
    if (sql.includes('FROM tenant_environment_policy_revisions')) return [{ policyRevision: 39, policyHash: null }]
    if (sql.includes('FROM policy_bundles')) return [bundle]
    if (sql.includes('FROM platform_app_releases r JOIN')) return [releases.find(r => r.id === Number(params[1] || 2))!]
    if (sql.includes('FROM platform_app_manifest_resources')) return resources(sql.includes('WHERE manifest_id=?') ? Number(params[0]) : 2)
    if (sql.includes('FROM platform_app_manifest_resource_actions')) return []
    if (sql.includes('FROM platform_app_manifests')) return [{ appCode: 'finance', manifestJson: {} }]
    if (sql.includes('FROM tenants')) return [{ tenantCode: 'T', tenantName: 'Fixture', tenantType: 'enterprise', status: 'active', settingsJson: {} }]
    if (sql.includes('FROM subscriptions')) return [{ appCode: 'finance' }]
    if (sql.includes('FROM platform_applications pa')) return [{ appCode: 'finance', appName: 'Finance', status: 'active' }]
    if (sql.includes('FROM deployments')) return [{ id: 1, deploymentCode: 'T-finance-prod', appCode: 'finance', environment: 'prod', status: 'active' }]
    return []
  }
  const mocks = {
    queryRows,
    queryRow: async (sql: string, params?: unknown[]) => (await queryRows(sql, params))[0] || null,
    execute: (sql: string, params: unknown[] = []) => {
      writes++
      if (!allowSigning) throw new Error('preview must not write')
      mutations.push({ sql, params })
      return { insertId: 41, affectedRows: 1 }
    },
    withTransaction: async (callback: (tx: unknown) => unknown) => {
      if (!allowSigning) {
        writes++
        throw new Error('preview must not start a write transaction')
      }
      return callback(mocks)
    },
    sign: (payload: string) => {
      signs++
      if (!allowSigning) throw new Error('preview must not sign')
      signedText = payload
      return { signature: signBytes(null, Buffer.from(payload), pair.privateKey).toString('base64'), kid: 'isolated-test-key', alg: 'Ed25519' }
    }
  }

  const globals = globalThis as typeof globalThis & { __pinPreviewMock?: typeof mocks, createError?: typeof createError }
  globals.__pinPreviewMock = mocks
  globals.createError = createError
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let candidate: string | undefined
      if (specifier.startsWith('~~/')) candidate = resolve(base, specifier.slice(3))
      else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) candidate += '.ts'
      if (candidate) {
        if (candidate === resolve(base, 'server/utils/db.ts')) return { url: 'pin-mock:db', shortCircuit: true }
        if (candidate === resolve(base, 'server/utils/platformSigning.ts')) return { url: 'pin-mock:signer', shortCircuit: true }
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
      return next(specifier, context)
    },
    load(url, context, next) {
      if (url === 'pin-mock:db') return { format: 'module', shortCircuit: true, source: 'export const {queryRow,queryRows,execute,withTransaction}=globalThis.__pinPreviewMock;' }
      if (url === 'pin-mock:signer') return { format: 'module', shortCircuit: true, source: 'export const {sign}=globalThis.__pinPreviewMock;' }
      return next(url, context)
    }
  })
  try {
    const { previewEnvironmentAppReleases } = await import('../server/utils/environmentAppReleasePreview.ts')
    const first = await previewEnvironmentAppReleases('T', { environment: 'prod', expectedRevision: 1, pins: [{ appCode: 'finance', releaseId: 1 }] })
    assert.deepEqual(first.candidate.manifestResources, resources(1))
    assert.ok(!JSON.stringify(first.candidate).includes('future-apf'))
    assert.ok(!JSON.stringify(first.result).includes('BASELINE_TEST_SECRET'))
    const second = await previewEnvironmentAppReleases('T', { environment: 'prod', expectedRevision: 1, pins: [{ appCode: 'finance', releaseId: 1 }] })
    assert.equal(first.result.reviewHash, second.result.reviewHash, 'clock does not stale the review')
    assert.ok(reads > 20)
    assert.equal(writes, 0)
    assert.equal(signs, 0)
    await assert.rejects(previewEnvironmentAppReleases('T', { environment: 'prod', expectedRevision: 0 }), { statusCode: 409 })
    await assert.rejects(previewEnvironmentAppReleases('T', { environment: 'prod', expectedRevision: 1, pins: [{ appCode: 'console', releaseId: 3 }] }), /版本选择不能扩张产品资格/)
    // Exercise the actual sign path with an ephemeral test-only key and captured SQL.
    allowSigning = true
    const { generatePolicyBundle } = await import('../server/utils/policyBundle.ts')
    const signed = await generatePolicyBundle({ tenantCode: 'T', environment: 'prod' })
    assert.equal(signs, 1)
    assert.ok(verify(null, Buffer.from(signedText), pair.publicKey, Buffer.from(signed.signature, 'base64')))
    assert.deepEqual(signed.payload.manifestResources, resources(1))
    assert.ok(!signedText.includes('future-apf'))
    assert.equal(signed.policyRevision, 40)
    assert.ok(mutations.some(m => m.sql.includes('INSERT INTO policy_bundles') && m.params[1] === 'prod'))
    assert.ok(mutations.every(m => !/tenant_role|platform_app_role/.test(m.sql)), 'signing managed prod does not materialize global roles')
  } finally {
    hooks.deregister()
    delete globals.__pinPreviewMock
    delete globals.createError
  }
})

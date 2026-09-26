import assert from 'node:assert/strict'
import { generateKeyPairSync, createHash, createHmac, verify } from 'node:crypto'
import { resolve } from 'node:path'
import { registerHooks } from 'node:module'
import { statSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
import { registerEnterpriseNuxtTestHost } from './support/enterprise-nuxt-test-host.mjs'
const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async context => {
  const pool = mysql.createPool({ ...context.connection('console'), multipleStatements: true })
  const hooks = registerEnterpriseNuxtTestHost(rootDir)
  const directoryHook = registerHooks({ resolve(specifier, context, nextResolve) { const result = nextResolve(specifier, context); if (result.url.startsWith('file:')) { const path = fileURLToPath(result.url); if (statSync(path).isDirectory()) { const entry = ['index.ts', 'index.js'].map(name => resolve(path, name)).find(existsSync); if (entry) return { ...result, url: pathToFileURL(entry).href } } } return result } })
  const original = { config: globalThis.useRuntimeConfig, fetch: globalThis.fetch, key: process.env.CUTOVER_TEST_KEY, drain: process.env.HZY_DRAIN_CONTROL_TOKEN }
  const key = generateKeyPairSync('ed25519')
  process.env.CUTOVER_TEST_KEY = key.privateKey.export({ type: 'pkcs8', format: 'pem' })
  process.env.HZY_DRAIN_CONTROL_TOKEN = 'isolated-drain-token'
  globalThis.useRuntimeConfig = () => ({ db: { ...context.connection('console'), name: context.connection('console').database } })
  let appPool
  try {
    await pool.query("CREATE TABLE tenant_runtime_instances(id INT,tenant_code VARCHAR(64),environment VARCHAR(32),runtime_code VARCHAR(128),status VARCHAR(32),runtime_endpoint VARCHAR(255),control_token_hash CHAR(64)); INSERT INTO tenant_runtime_instances VALUES(1,'C000001','test','runtime-1','ready','https://runtime.fixture.invalid',SHA2('isolated-control',256)); CREATE TABLE deployments(tenant_code VARCHAR(64),environment VARCHAR(32),app_code VARCHAR(32),deployment_code VARCHAR(128),status VARCHAR(32),runtime_endpoint VARCHAR(255)); INSERT INTO deployments VALUES('C000001','test','aims','C000001-test-aims','active','https://runtime.fixture.invalid'),('C000001','test','assets','C000001-test-assets','active','https://runtime.fixture.invalid'); CREATE TABLE tenant_scheduler_ownership(tenant_code VARCHAR(64),environment VARCHAR(32),source_app VARCHAR(32),storage_mode VARCHAR(32),runtime_code VARCHAR(128),worker_deployment VARCHAR(128),generation BIGINT); INSERT INTO tenant_scheduler_ownership VALUES('C000001','test','aims','unified','runtime-1','C000001-test-aims',7); CREATE TABLE platform_signing_keys(id BIGINT PRIMARY KEY,kid VARCHAR(128),alg VARCHAR(32),public_key TEXT,private_key_ref VARCHAR(255),status VARCHAR(32),activated_at DATETIME,rotated_at DATETIME NULL,revoked_at DATETIME NULL)")
    await pool.execute("INSERT INTO platform_signing_keys VALUES(1,'cutover-fixture','Ed25519',?,'env:CUTOVER_TEST_KEY','active',UTC_TIMESTAMP(),NULL,NULL)", [key.publicKey.export({ type: 'spki', format: 'pem' })])
    await pool.query("CREATE TABLE enterprise_external_drain_approvals(tenant_code VARCHAR(64),environment VARCHAR(32),cutover_key VARCHAR(191),seal_revision BIGINT,seal_payload_sha256 CHAR(64),payload_sha256 CHAR(64),actor_uid VARCHAR(128))")
    const actors = ['aims', 'assets'].map(app => ({ app, deployment: `C000001-test-${app}`, artifactSha256: 'a'.repeat(64) }))
    const payload = JSON.stringify({ schemaVersion: 'enterprise-external-drain.v1', tenant: 'C000001', environment: 'test', revision: 4, mode: 'sealed', ingressDrained: true, seal: { cutoverKey: 'cutover-1', targetGeneration: '7' }, contract: { actors } })
    const seal = { payload, signature: createHmac('sha256', process.env.HZY_DRAIN_CONTROL_TOKEN).update(payload).digest('hex'), alg: 'HS256' }
    const input = { tenantCode: 'C000001', environment: 'test', runtimeCode: 'runtime-1', cutoverKey: 'cutover-1', seal }
    await pool.execute("INSERT INTO enterprise_external_drain_approvals VALUES('C000001','test','cutover-1',4,?,REPEAT('d',64),'fixture-reviewer')",[createHash('sha256').update(seal.payload).digest('hex')])
    // Only the transport boundary is a fixture here. Actual Runtime receipt SQL
    // runs independently in TestSourceFenceMySQL; this does not claim full E2E.
    let callbackCount = 0
    let drift = false
    globalThis.fetch = async (url, options) => {
      callbackCount++
      assert.equal(String(url), 'https://runtime.fixture.invalid/runtime/enterprise/cutover-activation')
      assert.equal(options.redirect, 'error')
      assert.equal(options.headers.authorization, 'Bearer isolated-control')
      if (drift) await pool.query("UPDATE deployments SET runtime_endpoint='https://drift.invalid' WHERE app_code='assets'")
      return Response.json({ type: 'enterprise-cutover-observation.v1', tenantCode: 'C000001', environment: 'test', runtimeCode: 'runtime-1', cutoverKey: 'cutover-1', generation: '7', reviewHash: 'b'.repeat(64), evidenceHash: createHash('sha256').update(payload).digest('hex') })
    }
    const { useDbPool } = await import('../server/utils/db.ts'); appPool = useDbPool()
    const { signCommittedCutoverActivation } = await import('../server/utils/enterpriseCutoverActivation.ts')
    await assert.rejects(() => signCommittedCutoverActivation(input, 'business-token'), /authentication_failed/)
    assert.equal(callbackCount, 0)
    await assert.rejects(() => signCommittedCutoverActivation({ ...input, seal: { ...seal, signature: 'f'.repeat(64) } }, 'isolated-control'), /seal_invalid/)
    assert.equal(callbackCount, 0)
    drift = true
    await assert.rejects(() => signCommittedCutoverActivation(input, 'isolated-control'), /route_not_active/)
    drift = false
    await pool.query("UPDATE deployments SET runtime_endpoint='https://runtime.fixture.invalid'")
    const signed = await signCommittedCutoverActivation(input, 'isolated-control')
    assert.equal(verify(null, Buffer.from(signed.payload), key.publicKey, Buffer.from(signed.signature, 'base64url')), true)
    assert.deepEqual(JSON.parse(signed.payload).actors, actors)
    assert.equal(JSON.parse(signed.payload).sealRevision, 4)
    await pool.query("UPDATE tenant_scheduler_ownership SET generation=8")
    await assert.rejects(() => signCommittedCutoverActivation(input, 'isolated-control'), /route_not_active/)
    console.log('Real MySQL Platform control authentication, signed seal binding, callback identity, route drift, generation and actual Ed25519 signing passed (Runtime transport fixture)')
  } finally {
    if (appPool) await appPool.end()
    await pool.end(); directoryHook.deregister(); hooks.deregister()
    globalThis.useRuntimeConfig = original.config; globalThis.fetch = original.fetch
    for (const [name, value] of [['CUTOVER_TEST_KEY', original.key], ['HZY_DRAIN_CONTROL_TOKEN', original.drain]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  }
}, { execute: true, confirm: plan.confirmationSha256 })

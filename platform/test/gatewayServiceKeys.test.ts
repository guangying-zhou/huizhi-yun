import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gatewayPublicKey, parseGatewayKeyCommand, mutateGatewayKey, exportGatewayWorkerIdentity, signedGatewayKeyset, GATEWAY_KEYSET_SCHEMA } from '../server/utils/gatewayServiceKeys.ts'
import { resolveOpsPermission } from '../server/utils/platformOpsPermissionRoutes.ts'
import type { TransactionExecutor } from '../server/utils/db.ts'

const staff = { uid: 'staff-test', accountId: 1 }
const raw = (n: number) => Buffer.alloc(32, n).toString('base64url')
function fixture() {
  const deployment = { id: 1, site_code: 'test-gateway', tenant_code: 'T-TEST', environment: 'test', status: 'active', public_url: 'https://tenant.test' }
  const runtime = { runtime_code: 'test-runtime', tenant_code: 'T-TEST', environment: 'test', status: 'ready', control_token_hash: createHash('sha256').update('hzy_ctl_fixture').digest('hex') }
  let registry: null | Record<string, unknown> = null
  const keys: Record<string, unknown>[] = []
  const audits: unknown[][] = []
  let auditFail = false
  const queries: string[] = []
  const tx = {
    queryRow: async (sql: string) => {
      queries.push(sql)
      return sql.includes('tenant_runtime_instances') ? runtime : sql.includes('FROM deployment_sites') ? deployment : registry
    },
    queryRows: async (sql: string) => {
      queries.push(sql)
      return keys.toSorted((a, b) => String(a.kid).localeCompare(String(b.kid)))
    },
    execute: async (sql: string, p: unknown[]) => {
      if (sql.startsWith('INSERT INTO platform_gateway_keysets')) registry = { site_id: 1, gateway_site_code: p[1], tenant_code: p[2], environment: p[3], revision: 1 }
      else if (sql.startsWith('INSERT INTO platform_gateway_service_keys')) keys.push({ kid: p[1], public_key: p[2], status: 'next', rotation_slot: p[3], not_before: p[4], not_after: p[5] })
      else if (sql.startsWith('UPDATE platform_gateway_service_keys')) keys.find(k => k.kid === p[2])!.status = p[0]
      else if (sql.startsWith('UPDATE platform_gateway_keysets')) registry!.revision = p[0]
      else if (sql.includes('platform_audit_logs')) {
        if (auditFail) throw new Error('audit unavailable')
        audits.push(p)
      }
      return { affectedRows: 1 }
    }
  } as unknown as TransactionExecutor
  return { tx, deployment, runtime, keys, audits, queries,
    get registry() {
      return registry
    },
    set auditFail(v: boolean) {
      auditFail = v
    }
  }
}
const command = (n: number, rev: number) => parseGatewayKeyCommand({ action: 'register', expectedRevision: rev, publicKey: raw(n), notBefore: 1000, notAfter: 2000 }, 1000)
const action = (kind: 'activate' | 'revoke', kid: string, expectedRevision: number) => parseGatewayKeyCommand({ action: kind, kid, expectedRevision }, 1000)

test('staff rotation is bounded; revisions optimistic; revoked keys never return', async () => {
  const f = fixture()
  const first = await mutateGatewayKey(f.tx, 'test-gateway', command(1, 0), staff, 1000)
  assert.equal(first.revision, 1)
  await mutateGatewayKey(f.tx, 'test-gateway', action('activate', first.kid, 1), staff, 1000)
  await assert.rejects(mutateGatewayKey(f.tx, 'test-gateway', command(2, 1), staff, 1000), /revision_conflict/)
  await mutateGatewayKey(f.tx, 'test-gateway', command(2, 2), staff, 1000)
  await assert.rejects(mutateGatewayKey(f.tx, 'test-gateway', command(3, 3), staff, 1000), /slots_full/)
  await mutateGatewayKey(f.tx, 'test-gateway', action('revoke', first.kid, 3), staff, 1000)
  await assert.rejects(mutateGatewayKey(f.tx, 'test-gateway', command(1, 4), staff, 1000), /key_revoked/)
  await mutateGatewayKey(f.tx, 'test-gateway', command(3, 4), staff, 1000)
  assert.equal(f.audits.length, 5)
  assert.equal(f.registry!.revision, 5)
})
test('all commands recheck frozen binding; input cannot choose tenant or extend lifetime', async () => {
  const f = fixture()
  const key = await mutateGatewayKey(f.tx, 'test-gateway', command(1, 0), staff, 1000)
  f.deployment.environment = 'dev'
  for (const cmd of [command(2, 1), action('activate', key.kid, 1), action('revoke', key.kid, 1)]) await assert.rejects(mutateGatewayKey(f.tx, 'test-gateway', cmd, staff, 1000), /binding_changed/)
  assert.throws(() => parseGatewayKeyCommand({ action: 'register', expectedRevision: 0, publicKey: raw(1), tenant: 'other', notBefore: 1000, notAfter: 2000 }, 1000), /command_invalid/)
  assert.throws(() => parseGatewayKeyCommand({ action: 'register', expectedRevision: 0, publicKey: raw(1), notBefore: 1000, notAfter: 1000 + 90 * 86400000 + 1 }, 1000), /validity_invalid/)
  assert.throws(() => gatewayPublicKey(raw(1) + '='), /public_key_invalid/)
  await assert.rejects(mutateGatewayKey(f.tx, 'test-gateway', command(1, 0), { uid: '', accountId: 1 }, 1000), /staff_required/)
})
test('audit failure propagates to transaction owner; precise sensitive deploy permission and session required', async () => {
  const f = fixture()
  f.auditFail = true
  await assert.rejects(mutateGatewayKey(f.tx, 'test-gateway', command(1, 0), staff, 1000), /audit unavailable/)
  assert.deepEqual(resolveOpsPermission('/api/platform/ops/deployment-sites/test-gateway/gateway-keys', 'POST'), { resourceCode: 'ops.deployments', requiredAction: 'deploy' })
  const source = readFileSync(new URL('../server/api/platform/ops/deployment-sites/[siteCode]/gateway-keys.post.ts', import.meta.url), 'utf8')
  assert.match(source, /scope: 'platform_admin'/)
  assert.match(source, /withTransaction/)
  assert.match(source, /hasOpsPermission/)
})
test('signed keyset control auth and binding; no public root in response; revoked keys produce empty signed list', async () => {
  const f = fixture()
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const signer = async (data: string) => ({ kid: 'test-platform-root', alg: 'Ed25519', signature: sign(null, Buffer.from(data), privateKey).toString('base64url') })
  const key = await mutateGatewayKey(f.tx, 'test-gateway', command(1, 0), staff, 1000)
  const envelope = await signedGatewayKeyset(f.tx, 'test-runtime', 'test-gateway', 'hzy_ctl_fixture', 1000, signer)
  assert.ok(verify(null, Buffer.from(`${GATEWAY_KEYSET_SCHEMA}\n${envelope.body}`), publicKey, Buffer.from(envelope.signature, 'base64url')))
  assert.equal('publicKey' in envelope, false)
  assert.equal(JSON.parse(envelope.body).expiresAt, 301000)
  await assert.rejects(signedGatewayKeyset(f.tx, 'test-runtime', 'test-gateway', 'hzy_rt_wrong', 1000, signer), /control_invalid/)
  f.runtime.tenant_code = 'other'
  await assert.rejects(signedGatewayKeyset(f.tx, 'test-runtime', 'test-gateway', 'hzy_ctl_fixture', 1000, signer), /binding_mismatch/)
  f.runtime.tenant_code = 'T-TEST'
  await mutateGatewayKey(f.tx, 'test-gateway', action('revoke', key.kid, 1), staff, 1000)
  const empty = await signedGatewayKeyset(f.tx, 'test-runtime', 'test-gateway', 'hzy_ctl_fixture', 1000, signer)
  assert.deepEqual(JSON.parse(empty.body).keys, [])
  f.deployment.tenant_code = 'changed'
  await assert.rejects(signedGatewayKeyset(f.tx, 'test-runtime', 'test-gateway', 'hzy_ctl_fixture', 1000, signer), /binding_changed/)
})

test('Runtime cross-language fixture uses the shared canonical serializer and signature domain', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../../data-runtime/internal/gatewaykeys/testdata/platform-keyset.json', import.meta.url), 'utf8'))
  const { stableStringifyPolicyPayload } = await import('../server/utils/policyEnvelopeDelivery.ts')
  assert.equal(fixture.envelope.body, stableStringifyPolicyPayload(JSON.parse(fixture.envelope.body)))
  assert.ok(verify(null, Buffer.from(`${GATEWAY_KEYSET_SCHEMA}\n${fixture.envelope.body}`), fixture.rootPublicKey, Buffer.from(fixture.envelope.signature, 'base64url')))
})

test('keyset poll uses only consistent reads and requires a ready Runtime', async () => {
  const f = fixture()
  await mutateGatewayKey(f.tx, 'test-gateway', command(1, 0), staff, 1000)
  const signer = async () => ({ kid: 'fixture-root', alg: 'Ed25519', signature: 'fixture' })
  f.queries.length = 0
  const result = await signedGatewayKeyset(f.tx, 'test-runtime', 'test-gateway', 'hzy_ctl_fixture', 1000, signer)
  assert.equal(JSON.parse(result.body).runtimeCode, 'test-runtime')
  assert.equal(f.queries.length, 4)
  assert.ok(f.queries.every(sql => !/FOR UPDATE|FOR SHARE|LOCK IN SHARE MODE/.test(sql)))
  for (const status of ['enrolled', 'unhealthy', 'unknown', 'pending', 'active']) {
    f.runtime.status = status
    await assert.rejects(signedGatewayKeyset(f.tx, 'test-runtime', 'test-gateway', 'hzy_ctl_fixture', 1000, signer), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'gateway_keyset_runtime_not_ready' && 'statusCode' in error && error.statusCode === 503)
  }
})

test('site identity export checks active frozen site and exact public host', async () => {
  const f = fixture()
  await mutateGatewayKey(f.tx, 'test-gateway', command(1, 0), staff, 1000)
  assert.deepEqual(await exportGatewayWorkerIdentity(f.tx, 'test-gateway', 'tenant.test'), {
    deploymentCode: 'test-gateway', tenantCode: 'T-TEST', environment: 'test', publicHost: 'tenant.test'
  })
  for (const host of ['other.test', 'tenant.test.evil', 'tenant.test:443', '']) await assert.rejects(exportGatewayWorkerIdentity(f.tx, 'test-gateway', host), /host_mismatch/)
  for (const url of ['http://tenant.test', 'https://user@tenant.test', 'https://tenant.test:8443', 'invalid']) {
    f.deployment.public_url = url
    await assert.rejects(exportGatewayWorkerIdentity(f.tx, 'test-gateway', 'tenant.test'), /host_mismatch|public_url_invalid/)
  }
  f.deployment.public_url = 'https://tenant.test'
  f.deployment.status = 'inactive'
  await assert.rejects(mutateGatewayKey(f.tx, 'test-gateway', command(2, 1), staff, 1000), /unavailable/)
  await assert.rejects(exportGatewayWorkerIdentity(f.tx, 'test-gateway', 'tenant.test'), /unavailable/)
  await assert.rejects(signedGatewayKeyset(f.tx, 'test-runtime', 'test-gateway', 'hzy_ctl_fixture', 1000, async () => ({ kid: 'fixture', alg: 'Ed25519', signature: 'fixture' })), /unavailable/)
  f.deployment.status = 'active'
  f.deployment.site_code = 'changed'
  await assert.rejects(exportGatewayWorkerIdentity(f.tx, 'changed', 'tenant.test'), /binding_changed/)
})

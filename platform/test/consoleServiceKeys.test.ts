import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import {
  CONSOLE_SERVICE_KEY_LIFETIME_MS, ConsoleServiceKeyRefusal, activeConsoleServiceKeys, registerConsoleServiceKey
} from '../server/utils/consoleServiceKeys.ts'
import { deliverCurrentPolicyEnvelope } from '../server/utils/policyEnvelopeDelivery.ts'
import { policyPayloadHash, policyServiceKeyId, verifyPolicyEnvelope } from '../packages/authz-core/src/policy-envelope.ts'

const binding = { tenant: 'tenant-1', environment: 'test', deployment: 'console-test' }
const rawKey = (seed: number) => Buffer.alloc(32, seed).toString('base64url')

// In-memory stand-in for the console_service_keys rows of one deployment.
function memory() {
  const rows: { kid: string, public_key: string, status: string, not_after: number, registered: number }[] = []
  let clock = 0
  return {
    rows,
    queryRows: async (sql: string) => {
      const active = sql.includes('status = \'active\'')
      return [...rows].filter(row => !active || row.status === 'active').sort((a, b) => b.registered - a.registered) as never
    },
    execute: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('INSERT')) rows.push({ kid: String(params[3]), public_key: String(params[4]), status: 'active', not_after: Number(params[5]), registered: ++clock })
      else if (sql.includes('status = \'revoked\'')) rows.find(row => row.kid === params[3])!.status = 'revoked'
      else {
        const row = rows.find(r => r.kid === params[4])!
        row.not_after = Math.max(row.not_after, Number(params[0]))
      }
      return {} as never
    }
  }
}

test('registration derives the kid, renews in place and keeps at most two active keys', async () => {
  const db = memory()
  const first = await registerConsoleServiceKey(db, binding, rawKey(1), 1000)
  assert.equal(first.kid, policyServiceKeyId(rawKey(1)))
  assert.equal(first.notAfter, 1000 + CONSOLE_SERVICE_KEY_LIFETIME_MS)
  const renewed = await registerConsoleServiceKey(db, binding, rawKey(1), 5000)
  assert.equal(renewed.notAfter, 5000 + CONSOLE_SERVICE_KEY_LIFETIME_MS)
  assert.equal(db.rows.length, 1)
  await registerConsoleServiceKey(db, binding, rawKey(2), 6000)
  await registerConsoleServiceKey(db, binding, rawKey(3), 7000)
  assert.deepEqual(db.rows.map(row => row.status), ['revoked', 'active', 'active'], 'oldest key is revoked on overflow')
  await assert.rejects(registerConsoleServiceKey(db, binding, rawKey(1), 8000),
    (error: unknown) => error instanceof ConsoleServiceKeyRefusal && error.code === 'console_service_key_revoked')
  for (const bad of ['', rawKey(4).slice(1), `${rawKey(4)}=`, 42, null]) {
    await assert.rejects(registerConsoleServiceKey(db, binding, bad, 9000),
      (error: unknown) => error instanceof ConsoleServiceKeyRefusal && error.code === 'console_service_key_invalid')
  }
})

test('active keys ignore rows whose kid does not match the key and survive a missing table', async () => {
  const good = { kid: policyServiceKeyId(rawKey(1)), public_key: rawKey(1), status: 'active', not_after: 9_000_000 }
  const forged = { kid: policyServiceKeyId(rawKey(2)), public_key: rawKey(3), status: 'active', not_after: 9_000_000 }
  const keys = await activeConsoleServiceKeys(async () => [good, forged] as never, binding, 1000)
  assert.deepEqual(keys, [{ deployment: 'console-test', kid: good.kid, publicKey: rawKey(1), notAfter: 9_000_000 }])
  const missing = Object.assign(Error('missing'), { code: 'ER_NO_SUCH_TABLE' })
  const failing = (error: Error) => async () => {
    throw error
  }
  assert.deepEqual(await activeConsoleServiceKeys(failing(missing), binding, 1000), [])
  await assert.rejects(activeConsoleServiceKeys(failing(Error('down')), binding, 1000))
})

test('the envelope carries only the requesting deployment\'s unexpired keys, and omits the field otherwise', async () => {
  const keys = generateKeyPairSync('ed25519')
  const key = { kid: 'test', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
  const context = { issuer: 'https://platform.example', ...binding, now: 1_000_000 }
  const payload = JSON.stringify({ tenant: { tenantCode: 'tenant-1' }, environment: 'test', policyRevision: 12,
    deployments: ['console-test', 'enterprise-test'].map(deploymentCode => ({ deploymentCode, environment: 'test', status: 'active' })) })
  const row = { ...context, bundleVersion: 'bundle-12', policyRevision: 12, status: 'active', payload, payloadHash: policyPayloadHash(payload),
    policyExpiresAt: null, tenantStatus: 'active', deploymentStatus: 'active' }
  const signer = async (input: string) => ({ kid: key.kid, alg: 'Ed25519', signature: sign(null, Buffer.from(input), keys.privateKey).toString('base64url') })
  const own = { deployment: 'console-test', kid: policyServiceKeyId(rawKey(1)), publicKey: rawKey(1), notAfter: 2_000_000 }
  const stale = { ...own, kid: policyServiceKeyId(rawKey(2)), publicKey: rawKey(2), notAfter: 1_000_000 }
  const other = { ...own, deployment: 'enterprise-test', kid: policyServiceKeyId(rawKey(3)), publicKey: rawKey(3) }
  const body = verifyPolicyEnvelope(await deliverCurrentPolicyEnvelope(context, {
    current: async () => row, sign: signer, serviceKeys: async () => [own, stale, other]
  }), key, context)
  assert.deepEqual(body.serviceKeys, [own])
  const none = verifyPolicyEnvelope(await deliverCurrentPolicyEnvelope(context, {
    current: async () => row, sign: signer, serviceKeys: async () => [stale]
  }), key, context)
  assert.equal(Object.hasOwn(none, 'serviceKeys'), false)
})

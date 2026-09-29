#!/usr/bin/env node
// Produces a reviewable sequence of existing Platform operations. Never sends
// a request or creates a signing key, license, enrollment or runtime token.
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function buildG9OfficialTrustPlan(input) {
  assert.deepEqual(Object.keys(input).sort(), ['runtimeEndpoint', 'signingKid'].sort())
  assert.match(input.runtimeEndpoint, /^https:\/\/[a-z0-9.-]+\.wiztek\.cn\/?$/)
  assert.match(input.signingKid, /^[A-Za-z0-9_-]{8,64}$/)
  return {
    version: 'g9.official-trust.v1', tenant: 'C000001', environment: 'prod', platformOrigin: 'https://platform.wiztek.cn',
    hostOrigin: 'https://aidcp.wiztek.cn', issuer: 'https://aidcp.wiztek.cn/console',
    runtimeCode: 'c000001-prod-tenant-runtime', runtimeEndpoint: input.runtimeEndpoint,
    stages: [
      { id: 'T1', actor: 'protected Platform host', action: 'generate a NEW Ed25519 key with platform signing:key',
        output: '0600 private PEM under /etc/hzy/platform-signing plus public kid/fingerprint only',
        gate: 'old platform_signing_keys all revoked; internal old kid GET returns 404; no private bytes in SQL/logs' },
      { id: 'T2', actor: 'Platform signer', action: 'activate new signing kid using existing ensurePlatformSigningKey on first controlled start',
        output: `active kid ${input.signingKid}`, gate: 'exactly one active kid; public endpoint gives new kid; old kid 404' },
      { id: 'T3', actor: 'tenant administrator', method: 'POST', path: '/api/platform/tenant-admin/licenses',
        action: 'issue replacement Console license from active subscription and customer-held Vault marker',
        output: 'protected license artifact; vault field absent', gate: 'expires 2027-12-31; new kid; no re-created vault master key' },
      { id: 'T4', actor: 'tenant administrator', method: 'POST', path: '/api/platform/tenant-admin/runtime-token',
        action: 'issue new tenant runtime token through audited Platform flow', output: 'protected runtime token artifact',
        gate: 'old tenant_runtime_credentials inactive and new token scoped to C000001' },
      { id: 'T5', actor: 'tenant administrator', method: 'POST', path: '/api/platform/tenant-admin/deployment-settings/install-command',
        action: 'issue single-use Runtime enrollment command for prod and the canonical endpoint',
        output: 'protected one-use install command', gate: `runtimeCode=c000001-prod-tenant-runtime; endpoint=${input.runtimeEndpoint}` },
      { id: 'T6', actor: 'new Runtime host', action: 'run hzy-data-runtime enroll using T5 command and platform.wiztek.cn trust',
        output: 'new hzy_ctl_ control token and platform-signing-key.json in protected Runtime config',
        gate: 'ready heartbeat and schema_ready app bindings; old control token hashes absent' },
      { id: 'T7', actor: 'Platform ops', method: 'POST', path: '/api/platform/ops/deployments/scheduler-ownership',
        action: 'register Aims owner only after Runtime ready with reviewed generation and signed evidence',
        output: 'revisioned receipt', gate: 'C000001/prod/aims → C000001-aims, aims.runtime and matching registry generation' },
      { id: 'T8', actor: 'Platform ops', action: 'release approved Enterprise manifest; run 74-pair zero-row gate first',
        output: 'released manifest and policy revision', gate: 'new C000001-prod-enterprise deployed at /enterprise/' },
      { id: 'T9', actor: 'config review', action: 'compare exact trust values before restarting any consumer',
        expected: {
          console: ['NUXT_PLATFORM_BASE_URL=https://platform.wiztek.cn', 'NUXT_PLATFORM_SIGNING_KID=<T2 kid>', 'NUXT_PLATFORM_SIGNING_PUBKEY=<T2 public PEM>', 'OIDC issuer=https://aidcp.wiztek.cn/console'],
          enterprise: ['HZY_ENTERPRISE_POLICY_ISSUER=https://platform.wiztek.cn', 'NUXT_VERIFIED_POLICY_ISSUER=https://platform.wiztek.cn', 'HZY_ENTERPRISE_POLICY_KEY_ID=<T2 kid>', 'HZY_ENTERPRISE_POLICY_PUBLIC_KEY=<T2 public PEM>'],
          runtime: ['control.platformUrl=https://platform.wiztek.cn', 'auth.jwt.issuer=https://aidcp.wiztek.cn/console', `runtime endpoint=${input.runtimeEndpoint}`],
          gateway: ['platform.origin=https://platform.wiztek.cn', 'environment=prod', 'enterprise deployment=C000001-prod-enterprise']
        }, gate: 'all consumers use only new Platform public trust and new OIDC issuer; private bytes remain protected' }
    ]
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const stat = statSync(process.argv[2])
    assert.equal(stat.mode & 0o077, 0, 'G9_CONFIG_MUST_BE_0600')
    console.log(JSON.stringify(buildG9OfficialTrustPlan(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2))
  } catch (error) {
    console.error(`G9_STOPPED:${String(error.message).slice(0, 200)}`)
    process.exitCode = 1
  }
}

#!/usr/bin/env node
// Produces a reviewable sequence of existing Platform operations. Never sends
// a request or creates a signing key, license, enrollment or runtime token.
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SHARED_PLATFORM_ORIGIN = 'https://hzy.wiztek.cn'

// Platform plan §8c (2026-09-29): production uses the shared hzy.wiztek.cn control plane and its
// EXISTING active signing key. This plan therefore never generates a key, never issues or rotates
// a tenant Runtime credential (the tenant credential row is shared with the test Runtime), and
// never clones or sanitizes the shared Platform database.
export function buildG9OfficialTrustPlan(input) {
  assert.deepEqual(Object.keys(input).sort(), ['runtimeEndpoint', 'signingKid'].sort())
  assert.match(input.runtimeEndpoint, /^https:\/\/[a-z0-9.-]+\.wiztek\.cn\/?$/)
  assert.match(input.signingKid, /^[A-Za-z0-9_-]{8,64}$/)
  return {
    version: 'g9.official-trust.v2', tenant: 'C000001', environment: 'prod', platformOrigin: SHARED_PLATFORM_ORIGIN,
    hostOrigin: 'https://aidcp.wiztek.cn', issuer: 'https://aidcp.wiztek.cn/console',
    runtimeCode: 'c000001-prod-tenant-runtime', runtimeEndpoint: input.runtimeEndpoint,
    stages: [
      { id: 'T1', actor: 'Platform ops (read-only)', action: 'confirm the shared Platform active signing kid and public-key fingerprint match the pinned values',
        output: `active kid ${input.signingKid}; public fingerprint recorded`, gate: 'exactly one active kid; encrypted offline backup of the private key exists; no key is generated' },
      { id: 'T2', actor: 'Platform ops', method: 'POST', path: '/api/platform/ops/deployments',
        action: 'create the prod Console deployment (C000001-console) and move existing prod deployments to the prod site; then insert the customer-held Vault marker for the new Console deployment id (reviewed SQL)',
        output: 'prod Console deployment + migrated marker', gate: 'all writes environment=prod; test rows unchanged; a later Console license carries no vault field' },
      { id: 'T3', actor: 'Platform ops', method: 'POST', path: '/api/platform/ops/onboarding/start',
        action: 'run enterprise-full onboarding for prod with generateBundle=false (never the runtime_token step, never rotateRuntimeToken)',
        output: 'C000001-prod-enterprise deployment and Console license without a vault field', gate: 'tenant_runtime_credentials row and hash unchanged; no new policy bundle' },
      { id: 'T4', actor: 'Platform ops', method: 'PATCH', path: '/api/platform/ops/deployments/{id}',
        action: 'activate the business deployments (aims, workflow, codocs, assets); cold-archive apps stay inactive',
        output: 'active prod deployment set', gate: 'exactly one active aims deployment; test environment snapshots unchanged' },
      { id: 'T5', actor: 'tenant administrator', method: 'POST', path: '/api/platform/tenant-admin/deployment-settings/install-command',
        action: 'issue a single-use Runtime enrollment command for prod and the canonical endpoint (instance-level tokens only)',
        output: 'protected one-use install command', gate: `runtimeCode=c000001-prod-tenant-runtime; endpoint=${input.runtimeEndpoint}; tenant credential row untouched` },
      { id: 'T6', actor: 'new Runtime host', action: `run hzy-data-runtime enroll using the T5 command against ${SHARED_PLATFORM_ORIGIN}; auto-update stays disabled`,
        output: 'new hzy_ctl_ control token and platform-signing-key.json in protected Runtime config',
        gate: 'ready heartbeat and schema_ready app bindings; test Runtime instance row unchanged' },
      { id: 'T7', actor: 'Platform ops', method: 'POST', path: '/api/platform/ops/deployments/scheduler-ownership',
        action: 'register the Aims owner only after Runtime ready, with the reviewed generation',
        output: 'revisioned receipt', gate: 'C000001/prod/aims → C000001-aims, aims.runtime and matching registry generation; the test row is unchanged' },
      { id: 'T8', actor: 'Platform ops', method: 'POST', path: '/api/platform/ops/tenants/C000001/bundles',
        action: 'generate the prod policy bundle after the 74-pair zero-row gate', output: 'prod policy revision',
        gate: 'active kid signs it; targets are only active prod deployments; test bundles unchanged' },
      { id: 'T9', actor: 'config review', action: 'compare exact trust values before restarting any consumer',
        expected: {
          console: [`NUXT_PLATFORM_BASE_URL=${SHARED_PLATFORM_ORIGIN}`, `NUXT_PLATFORM_SIGNING_KID=${input.signingKid}`, 'NUXT_PLATFORM_SIGNING_PUBKEY=<active public PEM>', 'OIDC issuer=https://aidcp.wiztek.cn/console'],
          enterprise: [`HZY_ENTERPRISE_POLICY_ISSUER=${SHARED_PLATFORM_ORIGIN}`, `NUXT_VERIFIED_POLICY_ISSUER=${SHARED_PLATFORM_ORIGIN}`, `HZY_ENTERPRISE_POLICY_KEY_ID=${input.signingKid}`, 'HZY_ENTERPRISE_POLICY_PUBLIC_KEY=<active public PEM>'],
          runtime: [`control.platformUrl=${SHARED_PLATFORM_ORIGIN}`, 'auth.jwt.issuer=https://aidcp.wiztek.cn/console', `runtime endpoint=${input.runtimeEndpoint}`],
          gateway: [`platform.origin=${SHARED_PLATFORM_ORIGIN}`, 'environment=prod', 'enterprise deployment=C000001-prod-enterprise']
        }, gate: 'all consumers use only the shared Platform public trust and the new OIDC issuer; private bytes remain protected' }
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

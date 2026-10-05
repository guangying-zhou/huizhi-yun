#!/usr/bin/env node
// N2/N3/N4/N7/N8 probe. Only HTTP status and scope reach stdout. JWTs and
// service credentials stay in process memory and are never persisted.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { readProfile } from './local-enterprise/config.mjs'
import { readLocalAimsClientSecret, readLocalWorkflowClientSecret } from './local-enterprise/workflow-credentials.mjs'

const domains = ['aims', 'assets', 'codocs', 'altoc', 'console']
const audiences = ['data-runtime', 'tenant-runtime']
export const rolloutProbeMatrix = Object.freeze([
  ...domains.map(domain => ({ client: 'enterprise.runtime', app: 'enterprise', audience: 'data-runtime', scope: `${domain}:enterprise-host:execute` })),
  ...audiences.map(audience => ({ client: 'workflow.runtime', app: 'workflow', audience, scope: 'workflow:integration_operation:execute' })),
  ...audiences.flatMap(audience => ['aims:integration_operation:execute', 'aims:milestone-rollover:execute']
    .map(scope => ({ client: 'aims.runtime', app: 'aims', audience, scope }))),
  // D4 (2026-09-28): due reminders stay off on 10/8, so this scope must be refused.
  ...audiences.map(audience => ({ client: 'aims.runtime', app: 'aims', audience, scope: 'aims:notifications-due:execute', expectStatus: 403 }))
])

// reportOnly logs every status without stopping; used for the before-change baseline.
export async function runRolloutProbe(request, log = console.log, { reportOnly = false } = {}) {
  for (const item of rolloutProbeMatrix) {
    let status = 0
    try {
      const response = await request(item)
      status = response.status
      if (status === 200) {
        const body = await response.json()
        const token = String(body?.access_token || '')
        const parts = token.split('.')
        assert.equal(parts.length, 3)
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
        assert.equal(claims.aud, item.audience)
        assert.equal(claims.scope, item.scope)
        assert.equal(claims.source_app, item.app)
        assert.equal(claims.tenant, 'C000001')
        assert.equal(claims.deployment, item.client === 'enterprise.runtime' ? 'C000001-test-enterprise'
          : item.client === 'workflow.runtime' ? 'C000001-test-workflow-local' : 'C000001-test-aims')
      }
    } catch { log(JSON.stringify({ scope: item.scope, audience: item.audience, status })); throw Error('ROLLOUT_TOKEN_PROBE_FAILED') }
    const expected = item.expectStatus ?? 200
    log(JSON.stringify({ scope: item.scope, audience: item.audience, status, expected }))
    if (status !== expected && !reportOnly) throw Error('ROLLOUT_TOKEN_PROBE_UNEXPECTED')
  }
}

function ownerOnlyJson(path) {
  const stat = statSync(path)
  assert.equal(stat.uid, process.getuid())
  assert.equal(stat.mode & 0o077, 0)
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function main() {
  const reportOnly = process.argv[2] === '--report-all'
  if ((process.argv[2] !== '--issue-all' && !reportOnly) || process.argv.length !== 4) throw Error('USE_ISSUE_ALL_OR_REPORT_ALL_AND_PROFILE')
  const profilePath = resolve(process.argv[3])
  const { value: profile } = await readProfile(profilePath)
  assert.equal(profile.runtime.expectedTenant, 'C000001')
  assert.equal(profile.runtime.transportMode, 'loopback')
  assert.equal(profile.features?.workflowLocal, true)
  const root = resolve(import.meta.dirname, '../..')
  const runtime = ownerOnlyJson(resolve(process.env.HOME, 'Library/Application Support/HuizhiYun/test-runtime/config.json'))
  assert.equal(runtime.apps?.console?.db?.database, 'hzy_console_test_local_20260910')
  const processes = spawnSync('pm2', ['jlist'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PM2_HOME: profile.processManagement.pm2Home } })
  assert.equal(processes.status, 0)
  const gateway = JSON.parse(processes.stdout).find(row => row.name === 'hzy0-gateway')
  const gatewayToken = gateway?.pm2_env?.HZY0_GATEWAY_INTERNAL_TOKEN
  assert.ok(gatewayToken)
  const secrets = {
    'workflow.runtime': readLocalWorkflowClientSecret(profilePath),
    'aims.runtime': readLocalAimsClientSecret(process.env.HZY0_SECRET_SOURCE_ROOT || root)
  }
  await runRolloutProbe(async item => {
    const enterprise = item.client === 'enterprise.runtime'
    const body = { grant_type: 'client_credentials', client_id: item.client, app_code: item.app,
      audience: item.audience, scope: item.scope, source_binding: 'service-client-policy' }
    // Same lane as the running workers: their public issuer URL returns to the
    // local console-egress (23121), which injects the trusted Gateway context.
    // Calling Console on 23100 directly has no tenant-runtime binding (503).
    const credentials = enterprise ? { 'x-hzy0-egress-token': gatewayToken }
      : { 'x-hzy0-egress-token': gatewayToken,
          authorization: `Basic ${Buffer.from(`${item.client}:${secrets[item.client]}`).toString('base64')}` }
    return await fetch('http://127.0.0.1:23121/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/json', ...credentials },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30_000)
    })
  }, console.log, { reportOnly })
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) main().catch(() => {
  console.error('ROLLOUT_TOKEN_PROBE_FAILED')
  process.exitCode = 1
})

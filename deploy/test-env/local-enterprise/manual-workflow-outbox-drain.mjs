#!/usr/bin/env node
// One-shot hzy0 Workflow outbox drain. Loopback only, app fixed to Workflow,
// fixed path, no tenant or path arguments. Uses the Gateway scheduler signing
// implementation; prints only the drain counts.
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { schedulerRequestHeaders } from '../../cloudflare/tenant-gateway/src/index.js'
import { readProfile, validateProfile } from './config.mjs'
import { ownedProcesses } from './process-ownership.mjs'

export const WORKFLOW_DRAIN_PATH = '/api/internal/integration-operations/drain'

// Only counts leave this process; bodies, effects and diagnostics details do not.
export function drainSummary(status, body) {
  const data = body && typeof body === 'object' ? body.data : null
  return {
    status,
    callbacks: { processed: data?.processed ?? null, delivered: data?.delivered ?? null, failed: data?.failed ?? null },
    notifications: data?.notifications ? { ...data.notifications } : null,
    actionable: data?.actionable ? { ...data.actionable } : null,
    checkpointTokenDenied: data?.checkpointTokenDenied ? { ...data.checkpointTokenDenied } : null
  }
}

function privateFile(path) {
  let fd
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = fstatSync(fd)
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0 || info.size > 65_536) throw Error('unsafe')
    return readFileSync(fd, 'utf8')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

async function main() {
  const { values } = parseArgs({ options: { profile: { type: 'string' } }, strict: true })
  const { value: profile, profilePath } = await readProfile(values.profile || '')
  if (validateProfile(profile).length || profile.features?.workflowLocal !== true || profile.runtime.transportMode !== 'loopback') {
    throw Error('The approved hzy0 Workflow profile is required')
  }
  const root = resolve(import.meta.dirname, '../../..')
  // gateway/ may be a symlinked directory in a candidate worktree; the file itself must be owner-only.
  const gateway = JSON.parse(privateFile(resolve(root, 'deploy/test-env/.cloudflare-workers/gateway/secrets.json')))
  const inventory = spawnSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PM2_HOME: profile.processManagement.pm2Home } })
  if (inventory.status !== 0) throw Error('Owned Gateway credential unavailable')
  const processes = JSON.parse(inventory.stdout)
  ownedProcesses(processes, { root, profilePath, mode: profile.mode })
  const localSecret = String(processes.find(row => row.name === 'hzy0-gateway')?.pm2_env?.HZY0_GATEWAY_INTERNAL_TOKEN || '')
  const workflowSecret = String(processes.find(row => row.name === 'hzy0-workflow')?.pm2_env?.HZY0_GATEWAY_INTERNAL_TOKEN || '')
  const registry = JSON.parse(gateway.HZY_TENANT_GATEWAY_REGISTRY_JSON || '{}')
  const tenant = registry.domains?.['hzy-test.huizhi.yun']
  const runtime = JSON.parse(privateFile(resolve(homedir(), 'Library/Application Support/HuizhiYun/test-runtime/config.json')))
  const workflowDeployment = 'C000001-test-workflow-local'
  if (!localSecret || localSecret !== workflowSecret || tenant?.tenantCode !== 'C000001' || tenant.environment !== 'test'
    || tenant.apps?.aims?.deploymentCode !== 'C000001-test-aims' || runtime.deploymentBindings?.aims !== 'C000001-test-aims'
    || runtime.tenant !== 'C000001' || runtime.deploymentBindings?.workflow !== workflowDeployment
    || tenant.dataRuntime?.endpoint !== profile.runtime.canonicalEndpoint) throw Error('Local Workflow binding mismatch')

  // Callbacks are delivered to Aims, so the trusted context must carry the Aims
  // deployment as well; the wake itself still targets Workflow only.
  const localTenant = { ...tenant, apps: { console: tenant.apps.console, aims: tenant.apps.aims, workflow: { deploymentCode: workflowDeployment, basePath: '/workflow' } } }
  const requestId = `hzy0-workflow-outbox-${crypto.randomUUID()}`
  const headers = await schedulerRequestHeaders({
    HZY_TENANT_GATEWAY_INTERNAL_TOKEN: localSecret,
    HZY_WORKFLOW_ORIGIN: `http://127.0.0.1:${profile.listeners.workflow.port}`
  }, localTenant, 'hzy0.isme.dev', 'workflow', requestId, String(Date.now()), '', WORKFLOW_DRAIN_PATH)
  headers['x-hzy-local-runtime-dial-url'] = 'http://127.0.0.1:18084'
  const response = await fetch(`http://127.0.0.1:${profile.listeners.workflow.port}/workflow${WORKFLOW_DRAIN_PATH}`, {
    method: 'POST', headers, body: '{}', redirect: 'error', signal: AbortSignal.timeout(60000)
  })
  const body = await response.json().catch(() => ({}))
  console.log(JSON.stringify({ requestId, ...drainSummary(response.status, body) }))
  if (!response.ok) process.exitCode = 1
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) main().catch(() => {
  console.error('WORKFLOW_OUTBOX_DRAIN_FAILED')
  process.exitCode = 1
})

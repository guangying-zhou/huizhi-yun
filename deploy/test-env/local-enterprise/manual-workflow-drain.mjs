#!/usr/bin/env node
// One-shot hzy0 Aims wake. The URL and Workflow route are pinned to loopback;
// no public Gateway route or recurring schedule is created.
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import mysql from 'mysql2/promise'
import { schedulerRequestHeaders } from '../../cloudflare/tenant-gateway/src/index.js'
import { readProfile, validateProfile } from './config.mjs'
import { ownedProcesses } from './process-ownership.mjs'

const { values } = parseArgs({ options: { profile: { type: 'string' }, operation: { type: 'string' }, 'empty-probe': { type: 'boolean' } } })
const operationId = String(values.operation || '')
const emptyProbe = values['empty-probe'] === true
if (emptyProbe === Boolean(operationId) || (!emptyProbe && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId))) {
  throw Error('Use exactly one of --empty-probe or --operation with the preflighted operation UUID')
}
const { value: profile, profilePath } = await readProfile(values.profile || '')
if (validateProfile(profile).length || profile.features?.workflowLocal !== true || profile.runtime.transportMode !== 'loopback') throw Error('The approved hzy0 Workflow profile is required')
const utc = new Date()
const minute = utc.getUTCHours() * 60 + utc.getUTCMinutes()
if (minute >= 15 * 60 + 45 && minute < 16 * 60 + 15) throw Error('The 15:45–16:15 UTC drain window is excluded')

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

const root = resolve(import.meta.dirname, '../../..')
const gateway = JSON.parse(privateFile(resolve(root, 'deploy/test-env/.cloudflare-workers/gateway/secrets.json')))
const inventory = spawnSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024,
  env: { ...process.env, PM2_HOME: profile.processManagement.pm2Home } })
if (inventory.status !== 0) throw Error('Owned Gateway credential unavailable')
const processes = JSON.parse(inventory.stdout)
ownedProcesses(processes, { root, profilePath, mode: profile.mode })
const localSecret = String(processes.find(row => row.name === 'hzy0-gateway')?.pm2_env?.HZY0_GATEWAY_INTERNAL_TOKEN || '')
const aimsSecret = String(processes.find(row => row.name === 'hzy0-aims')?.pm2_env?.HZY0_GATEWAY_INTERNAL_TOKEN || '')
const registry = JSON.parse(gateway.HZY_TENANT_GATEWAY_REGISTRY_JSON || '{}')
const tenant = registry.domains?.['hzy-test.huizhi.yun']
const runtime = JSON.parse(privateFile(resolve(homedir(), 'Library/Application Support/HuizhiYun/test-runtime/config.json')))
const workflowDeployment = 'C000001-test-workflow-local'
if (!localSecret || localSecret !== aimsSecret || tenant?.tenantCode !== 'C000001' || tenant.environment !== 'test'
  || tenant.apps?.aims?.deploymentCode !== 'C000001-test-aims'
  || runtime.tenant !== 'C000001' || runtime.deploymentBindings?.aims !== 'C000001-test-aims'
  || runtime.deploymentBindings?.workflow !== workflowDeployment
  || tenant.dataRuntime?.endpoint !== profile.runtime.canonicalEndpoint) throw Error('Local Aims/Workflow binding mismatch')

const table = runtime.enterprise?.domains?.aims?.tables?.integration_operation
if (!/^aims_[a-z0-9_]+$/.test(table || '')) throw Error('Unified Aims outbox mapping is invalid')
const db = await mysql.createConnection(runtime.enterprise.db)
let queue
try {
  const [rows] = await db.query(`SELECT operation_id,status,target_app,operation_code FROM \`${table}\` WHERE tenant_code=? AND deployment_code=? AND status IN ('pending','processing','retry_wait','partial_unknown')`, ['C000001', 'C000001-test-aims'])
  queue = rows
} finally { await db.end() }
if (emptyProbe ? queue.length !== 0 : (queue.length !== 1 || queue[0].operation_id !== operationId || queue[0].status !== 'pending'
  || queue[0].target_app !== 'workflow' || queue[0].operation_code !== 'aims.work-item.completion.workflow-submit.v1')) throw Error('Aims queue is not the approved pending completion state')

const localTenant = {
  ...tenant,
  apps: {
    console: tenant.apps.console,
    aims: { ...tenant.apps.aims, enterpriseScheduler: { storage: 'unified', generation: String(runtime.enterprise.generation) } },
    workflow: { deploymentCode: workflowDeployment, basePath: '/workflow' }
  }
}
const path = '/api/internal/integration-operations/drain'
const requestId = `hzy0-workflow-${crypto.randomUUID()}`
const headers = await schedulerRequestHeaders({
  HZY_TENANT_GATEWAY_INTERNAL_TOKEN: localSecret,
  HZY_AIMS_ORIGIN: `http://127.0.0.1:${profile.listeners.aims.port}`,
  HZY_WORKFLOW_ORIGIN: `http://127.0.0.1:${profile.listeners.workflow.port}`
}, localTenant, 'hzy0.isme.dev', 'aims', requestId, String(Date.now()), '', path)
headers['x-hzy-local-runtime-dial-url'] = 'http://127.0.0.1:18084'
const response = await fetch(`http://127.0.0.1:${profile.listeners.aims.port}/aims${path}`, {
  method: 'POST', headers, body: '{}', redirect: 'error', signal: AbortSignal.timeout(30000)
})
const body = await response.json().catch(() => ({}))
const data = body && typeof body === 'object' ? body.data : null
console.log(JSON.stringify({ requestId, status: response.status,
  claimed: data?.claimed ?? null, succeeded: data?.succeeded ?? null,
  checkpointedFailures: data?.checkpointedFailures ?? null }))
if (!response.ok || data?.claimed !== (emptyProbe ? 0 : 1) || data?.succeeded !== (emptyProbe ? 0 : 1)) process.exitCode = 1

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { createHash } from 'node:crypto'
import {
  G3_PROCESS_ORDER,
  G3_REQUIRED_ENVIRONMENT,
  buildG3RealHttpContract
} from '../g3-real-http-harness.mjs'
import { buildLocalProcessGroupPlan } from './support/local-process-group-supervisor.mjs'

const execFileAsync = promisify(execFile)
const rootDir = resolve(import.meta.dirname, '../..')

function manifest() {
  return {
    schemaVersion: 1,
    kind: 'hzy-g3-real-http',
    tenant: 'tenant-a',
    deployments: {
      console: 'tenant-a-console', aimsApp: 'tenant-a-aims-app', altocApp: 'tenant-a-altoc-app',
      aimsRuntime: 'tenant-a-aims-runtime', altocRuntime: 'tenant-a-altoc-runtime'
    },
    ports: { aimsRuntime: 41081, altocRuntime: 41082, console: 41000, aims: 41002, altoc: 41003, gateway: 41443 },
    artifacts: {
      dataRuntimeBinary: 'bin/runtime', caCertificate: 'tls/ca.pem', gatewayCertificate: 'tls/server.pem',
      gatewayPrivateKey: 'tls/server-key.pem', explicitDotenv: 'fixtures/explicit-empty.env', runtimeCwd: 'runtime-cwd'
    }
  }
}

function completeEnvironment(binaryDigest) {
  return Object.fromEntries(G3_REQUIRED_ENVIRONMENT.map((name) => {
    if (name.endsWith('_SHA256')) return [name, binaryDigest]
    if (name.endsWith('_PORT')) return [name, '3306']
    if (name.endsWith('_HOST')) return [name, '127.0.0.1']
    if (name.endsWith('_NAME')) return [name, `hzy_${name.toLowerCase().split('_')[2]}`]
    return [name, `fixture-${name.toLowerCase()}`]
  }))
}

async function fixtureWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'hzy-g3-contract-'))
  for (const directory of ['bin', 'tls', 'fixtures', 'runtime-cwd', 'console', 'aims', 'altoc']) await mkdir(join(root, directory), { recursive: true })
  const binary = Buffer.from('#!/bin/sh\nexit 0\n')
  await writeFile(join(root, 'bin/runtime'), binary, { mode: 0o700 })
  await chmod(join(root, 'bin/runtime'), 0o700)
  for (const file of ['ca.pem', 'server.pem']) await writeFile(join(root, 'tls', file), 'fixture\n')
  await writeFile(join(root, 'tls/server-key.pem'), 'fixture\n', { mode: 0o600 })
  await writeFile(join(root, 'fixtures/explicit-empty.env'), '# explicit empty\n')
  return { root, digest: createHash('sha256').update(binary).digest('hex') }
}

test('tracked manifest is a six-process blocked preview with no secret literal', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(join(rootDir, 'scripts/fixtures/g3-real-http/manifest.example.json'), 'utf8'))
  for (const marker of ['password', 'secret', 'token']) assert.equal(source.toLowerCase().includes(`change-me-${marker}`), false)
  const contract = await buildG3RealHttpContract(JSON.parse(source), { rootDir, environment: {} })
  assert.equal(contract.ready, false)
  assert.deepEqual(contract.requirements.processOrder, G3_PROCESS_ORDER)
  assert.equal(contract.requirements.readinessScope, 'process-http-only')
  assert(contract.requirements.missing.includes('env:HZY_G3_GATEWAY_INTERNAL_TOKEN'))
  assert(contract.requirements.missing.includes('artifact:caCertificate'))
})

test('complete inputs bind exact order, readiness, CA, tenant and distinct deployments', async (t) => {
  const fixture = await fixtureWorkspace()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const contract = await buildG3RealHttpContract(manifest(), { rootDir: fixture.root, environment: completeEnvironment(fixture.digest) })
  assert.equal(contract.ready, true)
  assert.deepEqual(contract.processes.map(item => item.name), G3_PROCESS_ORDER)
  assert.deepEqual(contract.processes.map(item => new URL(item.readiness.url).protocol), ['http:', 'http:', 'http:', 'http:', 'http:', 'https:'])
  assert.deepEqual(contract.processes.slice(0, 2).map(item => new URL(item.readiness.url).pathname), ['/runtime/healthz', '/runtime/healthz'])
  assert.equal(contract.processes[2].env.CONSOLE_COLLAB_MODE, 'disabled')
  assert.equal(contract.processes[3].env.HZY_TENANT_RUNTIME_DEPLOYMENT, 'tenant-a-aims-runtime')
  assert.equal(contract.processes[4].env.HZY_TENANT_RUNTIME_DEPLOYMENT, 'tenant-a-altoc-runtime')
  assert(contract.processes.slice(2, 5).every(item => item.args.includes(join(fixture.root, 'fixtures/explicit-empty.env'))))
  assert(contract.processes.slice(2, 5).every(item => !item.args.some(arg => arg.includes('.env.dev'))))
  const registry = JSON.parse(contract.processes[5].env.HZY_TENANT_GATEWAY_REGISTRY_JSON)
  assert.equal(registry.domains['127.0.0.1'].apps.aims.dataRuntime.endpoint, 'http://127.0.0.1:41081')
  assert.equal(registry.domains['127.0.0.1'].apps.altoc.dataRuntime.endpoint, 'http://127.0.0.1:41082')

  const allowedEnvironment = [...new Set(contract.processes.flatMap(item => Object.keys(item.env)))]
  const plan = await buildLocalProcessGroupPlan({ rootDir: fixture.root, allowedEnvironment, caFile: contract.caFile, processes: contract.processes })
  assert.equal(plan.processes.length, 6)
  assert.match(plan.confirmationSha256, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(plan).includes('fixture-hzy_g3_gateway_internal_token'), false)
})

test('contract rejects port/deployment aliasing and binary digest mismatch', async (t) => {
  const fixture = await fixtureWorkspace()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const duplicatePort = manifest()
  duplicatePort.ports.altoc = duplicatePort.ports.aims
  await assert.rejects(() => buildG3RealHttpContract(duplicatePort, { rootDir: fixture.root, environment: {} }), /ports must be distinct/)
  const duplicateDeployment = manifest()
  duplicateDeployment.deployments.altocApp = duplicateDeployment.deployments.aimsApp
  await assert.rejects(() => buildG3RealHttpContract(duplicateDeployment, { rootDir: fixture.root, environment: {} }), /deployment codes must be distinct/)
  const env = completeEnvironment('0'.repeat(64))
  await assert.rejects(() => buildG3RealHttpContract(manifest(), { rootDir: fixture.root, environment: env }), /binary digest does not match/)
})

test('CLI default preview lists blockers and never starts a process', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, ['scripts/g3-real-http-harness.mjs', '--manifest', 'scripts/fixtures/g3-real-http/manifest.example.json'], {
    cwd: rootDir,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }
  })
  assert.equal(stderr, '')
  assert.match(stdout, /mode=preview/)
  assert.match(stdout, /blocked=/)
  assert.match(stdout, /no confirmation digest and no process start/)
  assert.doesNotMatch(stdout, /fixture-|DB_PASSWORD=/)
})

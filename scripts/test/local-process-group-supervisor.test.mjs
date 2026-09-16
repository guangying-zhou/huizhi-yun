import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  buildLocalProcessGroupPlan,
  redactCapturedProcessOutput,
  withLocalProcessGroup
} from './support/local-process-group-supervisor.mjs'
import { resolveManifestProcessEnvironment } from '../local-process-group-harness.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const CLI = resolve(ROOT, 'scripts/local-process-group-harness.mjs')
const PREVIEW_MANIFEST = resolve(ROOT, 'scripts/fixtures/local-process-group/preview.json')

async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolveListen)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise(resolveClose => server.close(resolveClose))
  return port
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hzy-process-supervisor-test-'))
  const temporaryParent = join(directory, 'homes')
  const trace = join(directory, 'trace.jsonl')
  const caFile = join(directory, 'temporary-ca.pem')
  const service = join(directory, 'fake-http-service.mjs')
  writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nTEST-ONLY\n-----END CERTIFICATE-----\n')
  writeFileSync(service, `#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'

const args = Object.fromEntries(process.argv.slice(2).map(item => {
  const index = item.indexOf('=')
  return [item.slice(2, index), item.slice(index + 1)]
}))
const append = value => appendFileSync(args.trace, JSON.stringify({ at: Date.now(), ...value }) + '\\n')
append({
  event: 'start',
  name: args.name,
  pid: process.pid,
  nodeOptions: process.env.NODE_OPTIONS || '',
  caFile: process.env.NODE_EXTRA_CA_CERTS || '',
  marker: process.env.TEST_MARKER || '',
  leaked: Boolean(process.env.PRODUCTION_TOKEN || process.env.HZY_CONSOLE_DB_PASSWORD)
})
console.log('Authorization: Bearer eyJaaaaaaaa.eyJbbbbbbbb.cccccccc')
console.log('Authorization: Basic dXNlcjpwYXNzd29yZA==')
console.log('Cookie: session=primary-cookie; csrf=secondary-cookie')
console.log('password=' + (process.env.DB_PASSWORD || ''))
console.log('api_key=dynamic-api-key access_token=dynamic-access-token client_secret=dynamic-client-secret')
console.log(process.env.DB_PASSWORD || '')
console.log(process.env.RESEND_API_KEY || '')
console.log('x'.repeat(8192))

if (args.mode === 'exit') {
  setTimeout(() => process.exit(27), 50)
} else {
  if (args.mode === 'child') {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' })
    append({ event: 'grandchild', name: args.name, pid: child.pid })
  }
  const server = (args.mode === 'https'
    ? https.createServer({ key: readFileSync(args.key || process.env.TLS_KEY_FILE), cert: readFileSync(args.cert || process.env.TLS_CERTIFICATE_FILE) }, handler)
    : http.createServer(handler))
  function handler(request, response) {
    append({ event: 'request', name: args.name, path: request.url })
    response.writeHead(args.mode === 'timeout' ? 503 : 204)
    response.end()
  }
  const listen = () => server.listen(Number(args.port), '127.0.0.1', () => {
    append({ event: 'listening', name: args.name, pid: process.pid })
    if (args.mode === 'exit-after-ready') setTimeout(() => process.exit(28), 150)
  })
  if (args.mode === 'slow') setTimeout(listen, 400)
  else listen()
  process.on('SIGTERM', () => {
    append({ event: 'term', name: args.name, pid: process.pid })
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 100).unref()
  })
}
`)
  chmodSync(service, 0o755)
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return { directory, temporaryParent, trace, caFile, service }
}

function tlsMaterial(directory, name) {
  const key = join(directory, `${name}.key`)
  const certificate = join(directory, `${name}.pem`)
  const result = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key,
    '-out', certificate,
    '-days', '1',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1'
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  chmodSync(key, 0o600)
  return { key, certificate }
}

function records(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function alive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function eventuallyNotAlive(pid) {
  for (let index = 0; index < 20 && alive(pid); index += 1) {
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
  return !alive(pid)
}

function noHomes(parent) {
  assert.deepEqual(existsSync(parent) ? readdirSync(parent) : [], [])
}

function processSpec(files, name, port, mode = 'ready', env = {}) {
  return {
    name,
    command: process.execPath,
    args: [files.service, `--name=${name}`, `--port=${port}`, `--mode=${mode}`, `--trace=${files.trace}`],
    cwd: ROOT,
    env,
    readiness: { url: `http://127.0.0.1:${port}/ready`, status: 204 }
  }
}

async function buildPlan(files, processes, overrides = {}) {
  return await buildLocalProcessGroupPlan({
    rootDir: ROOT,
    allowedWorkingRoots: [ROOT],
    allowedFileRoots: [ROOT, files.directory],
    allowedEnvironment: ['DB_PASSWORD', 'RESEND_API_KEY', 'TEST_MARKER'],
    caFile: files.caFile,
    totalTimeoutMs: overrides.totalTimeoutMs || 2_000,
    pollMs: 25,
    processes
  })
}

test('preview and wrong confirmation start nothing and expose no environment value', async (t) => {
  const files = fixture(t)
  const port = await reservePort()
  const plan = await buildPlan(files, [processSpec(files, 'preview', port, 'ready', {
    DB_PASSWORD: 'preview-db-password',
    TEST_MARKER: 'preview-marker'
  })])
  assert.equal(JSON.stringify(plan).includes('preview-db-password'), false)
  assert.equal(JSON.stringify(plan).includes('preview-marker'), false)
  const changedPlan = await buildPlan(files, [processSpec(files, 'preview', port, 'ready', {
    DB_PASSWORD: 'different-preview-db-password',
    TEST_MARKER: 'preview-marker'
  })])
  assert.notEqual(changedPlan.confirmationSha256, plan.confirmationSha256)
  assert.equal((await withLocalProcessGroup(plan, async () => undefined)).mode, 'preview')
  await assert.rejects(() => withLocalProcessGroup(plan, async () => undefined, {
    execute: true,
    confirm: '0'.repeat(64),
    temporaryParent: files.temporaryParent
  }), /confirm must exactly match/)
  assert.deepEqual(records(files.trace), [])
  noHomes(files.temporaryParent)
})

test('confirmation binds the PATH-resolved executable and inherited dynamic library environment without exposing values', async (t) => {
  const files = fixture(t)
  const port = await reservePort()
  const firstBin = join(files.directory, 'first-bin')
  const secondBin = join(files.directory, 'second-bin')
  const tool = 'local-supervisor-tool'
  for (const [directory, marker] of [[firstBin, 'first'], [secondBin, 'second']]) {
    mkdirSync(directory)
    const path = join(directory, tool)
    writeFileSync(path, `#!/bin/sh\n# ${marker}\nexec \"${process.execPath}\" \"$@\"\n`)
    chmodSync(path, 0o755)
  }
  const input = (pathValue, dynamicValue) => ({
    rootDir: ROOT,
    allowedWorkingRoots: [ROOT],
    allowedFileRoots: [ROOT, files.directory],
    allowedEnvironment: ['TEST_MARKER'],
    caFile: files.caFile,
    pathValue,
    inheritedEnvironment: {
      PATH: pathValue,
      DYLD_LIBRARY_PATH: dynamicValue,
      LD_PRELOAD: `${dynamicValue}/preload.dylib`
    },
    totalTimeoutMs: 2_000,
    pollMs: 25,
    processes: [{ ...processSpec(files, 'bound-tool', port), command: tool }]
  })
  const first = await buildLocalProcessGroupPlan(input(firstBin, '/private/first-runtime-libs'))
  const second = await buildLocalProcessGroupPlan(input(secondBin, '/private/first-runtime-libs'))
  const changedLibraries = await buildLocalProcessGroupPlan(input(firstBin, '/private/changed-runtime-libs'))
  assert.equal(first.processes[0].executable.endsWith(`/first-bin/${tool}`), true)
  assert.match(first.processes[0].executableSha256, /^[a-f0-9]{64}$/)
  assert.notEqual(first.confirmationSha256, second.confirmationSha256)
  assert.notEqual(first.confirmationSha256, changedLibraries.confirmationSha256)
  const printable = JSON.stringify(first)
  assert.doesNotMatch(printable, /private\/first-runtime-libs|preload\.dylib/)
  assert.doesNotMatch(printable, /PATH=/)
})

test('execution rejects an executable changed after preview before starting a process', async (t) => {
  const files = fixture(t)
  const port = await reservePort()
  const tool = join(files.directory, 'mutable-tool')
  const writeTool = marker => {
    writeFileSync(tool, `#!/bin/sh\n# ${marker}\nexec \"${process.execPath}\" \"$@\"\n`)
    chmodSync(tool, 0o755)
  }
  writeTool('preview')
  const plan = await buildPlan(files, [{ ...processSpec(files, 'mutable-tool', port), command: tool }])
  writeTool('replaced-after-preview')
  await assert.rejects(() => withLocalProcessGroup(plan, async () => undefined, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent
  }), /executable changed since preview/)
  assert.deepEqual(records(files.trace), [])
  noHomes(files.temporaryParent)
})

test('execution rejects a CA file changed after preview before starting a process', async (t) => {
  const files = fixture(t)
  const port = await reservePort()
  const plan = await buildPlan(files, [processSpec(files, 'mutable-ca', port)])
  writeFileSync(files.caFile, '-----BEGIN CERTIFICATE-----\nREPLACED-TEST-ONLY\n-----END CERTIFICATE-----\n')
  await assert.rejects(() => withLocalProcessGroup(plan, async () => undefined, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent
  }), /CA file changed since preview/)
  assert.deepEqual(records(files.trace), [])
  noHomes(files.temporaryParent)
})

test('versioned CLI defaults to preview and does not print arguments or environment values', () => {
  const sourceSecret = 'cli-env-from-db-password'
  const result = spawnSync(process.execPath, [CLI, '--manifest', PREVIEW_MANIFEST], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PRODUCTION_TOKEN: 'must-not-be-read',
      HZY_G3_PREVIEW_DB_PASSWORD: sourceSecret
    }
  })
  const output = `${result.stdout}${result.stderr}`
  assert.equal(result.status, 0, output)
  assert.match(output, /mode=preview/)
  assert.match(output, /no process or temporary HOME was created/)
  assert.doesNotMatch(output, new RegExp(`must-not-appear-in-preview|must-not-be-read|${sourceSecret}|--version`))
})

test('CLI manifest rejects sensitive literals and resolves only explicit HZY_G3 envFrom sources', () => {
  const base = {
    allowedSourceEnvironment: ['HZY_G3_DB_PASSWORD'],
    processes: [{ name: 'console', env: {}, envFrom: { DB_PASSWORD: 'HZY_G3_DB_PASSWORD' } }]
  }
  assert.deepEqual(resolveManifestProcessEnvironment(base, { HZY_G3_DB_PASSWORD: 'temporary-password' })[0].env, {
    DB_PASSWORD: 'temporary-password'
  })
  assert.throws(() => resolveManifestProcessEnvironment({
    ...base,
    processes: [{ name: 'console', env: { DB_PASSWORD: 'tracked-secret' } }]
  }, {}), /must use envFrom/)
  assert.throws(() => resolveManifestProcessEnvironment({
    ...base,
    processes: [{ name: 'console', env: { RESEND_API_KEY: 'tracked-api-key' } }]
  }, {}), /must use envFrom/)
  assert.throws(() => resolveManifestProcessEnvironment({
    ...base,
    allowedSourceEnvironment: [],
    processes: [{ name: 'console', envFrom: { DB_PASSWORD: 'HZY_G3_DB_PASSWORD' } }]
  }, { HZY_G3_DB_PASSWORD: 'temporary-password' }), /not explicitly allowlisted/)
  assert.throws(() => resolveManifestProcessEnvironment(base, {}), /source is missing/)
})

test('rejects non-allowlisted env, external readiness, escaping cwd, and credential arguments', async (t) => {
  const files = fixture(t)
  const port = await reservePort()
  const base = processSpec(files, 'invalid', port)
  await assert.rejects(() => buildPlan(files, [{ ...base, env: { NOT_ALLOWED: 'value' } }]), /not allowlisted/)
  await assert.rejects(() => buildPlan(files, [{ ...base, readiness: { url: 'https://example.com/ready', status: 200 } }]), /loopback/)
  await assert.rejects(() => buildPlan(files, [{ ...base, readiness: { url: `http://127.0.0.1:${port}/ready?token=forbidden`, status: 204 } }]), /query or fragment/)
  await assert.rejects(() => buildPlan(files, [{ ...base, readiness: { url: `http://127.0.0.1:${port}/ready#secret`, status: 204 } }]), /query or fragment/)
  await assert.rejects(() => buildPlan(files, [{ ...base, cwd: files.directory }]), /outside the allowed roots/)
  for (const argument of ['--token=forbidden', '--api-key=forbidden', '--access-token=forbidden', '--client-secret=forbidden']) {
    await assert.rejects(() => buildPlan(files, [{ ...base, args: [...base.args, argument] }]), /must not contain credentials/)
  }
})

test('captured-output redaction is idempotent', () => {
  const raw = [
    'Authorization: Bearer eyJaaaaaaaa.eyJbbbbbbbb.cccccccc',
    'Authorization: Basic dXNlcjpwYXNzd29yZA==',
    'Cookie: session=primary-cookie; csrf=secondary-cookie',
    'api_key=dynamic-api-key access_token=dynamic-access-token client_secret=dynamic-client-secret RESEND_API_KEY=provider-api-key',
    'password=plain-secret plain-secret'
  ].join('\n')
  const once = redactCapturedProcessOutput(raw, ['plain-secret'])
  assert.equal(redactCapturedProcessOutput(once, ['plain-secret']), once)
  assert.doesNotMatch(once, /eyJaaaaaaaa|dXNlcj|primary-cookie|secondary-cookie|dynamic-api-key|dynamic-access-token|dynamic-client-secret|provider-api-key|plain-secret/)
  assert.match(once, /Authorization=\[redacted\]/)
  assert.match(once, /Cookie=\[redacted\]/)
  assert.match(once, /api_key=\[redacted\]/)
  assert.match(once, /access_token=\[redacted\]/)
  assert.match(once, /client_secret=\[redacted\]/)
  assert.match(once, /RESEND_API_KEY=\[redacted\]/)
})

test('starts sequentially, waits for readiness, redacts bounded logs, and stops in reverse order', async (t) => {
  const files = fixture(t)
  const [firstPort, secondPort] = await Promise.all([reservePort(), reservePort()])
  const plan = await buildPlan(files, [
    processSpec(files, 'first', firstPort, 'ready', { TEST_MARKER: 'one', DB_PASSWORD: 'db-password-one', RESEND_API_KEY: 'provider-key-one' }),
    processSpec(files, 'second', secondPort, 'ready', { TEST_MARKER: 'two', DB_PASSWORD: 'db-password-two' })
  ])
  process.env.PRODUCTION_TOKEN = 'must-not-leak'
  process.env.HZY_CONSOLE_DB_PASSWORD = 'must-not-leak'
  try {
    await withLocalProcessGroup(plan, async (context) => {
      assert.deepEqual(context.processes.map(item => item.name), ['first', 'second'])
      const output = context.logs('first').stdout
      assert.match(output, /Authorization=\[redacted\]/)
      assert.match(output, /password=\[redacted\]/)
      assert.doesNotMatch(output, /db-password-one|provider-key-one|eyJaaaaaaaa|dXNlcj|primary-cookie|secondary-cookie|dynamic-api-key|dynamic-access-token|dynamic-client-secret/)
      assert.ok(output.length <= 2_048)
    }, {
      execute: true,
      confirm: plan.confirmationSha256,
      temporaryParent: files.temporaryParent,
      captureBytes: 1_024,
      terminationGraceMs: 100
    })
  } finally {
    delete process.env.PRODUCTION_TOKEN
    delete process.env.HZY_CONSOLE_DB_PASSWORD
  }

  const trace = records(files.trace)
  const starts = trace.filter(item => item.event === 'start')
  assert.deepEqual(starts.map(item => item.name), ['first', 'second'])
  assert.ok(trace.findIndex(item => item.event === 'request' && item.name === 'first') < trace.findIndex(item => item.event === 'start' && item.name === 'second'))
  assert.equal(starts.every(item => item.nodeOptions === '--dns-result-order=ipv4first'), true)
  assert.equal(starts.every(item => item.caFile === files.caFile), true)
  assert.equal(starts.every(item => item.leaked === false), true)
  assert.deepEqual(trace.filter(item => item.event === 'term').map(item => item.name), ['second', 'first'])
  assert.equal(starts.every(item => !alive(item.pid)), true)
  noHomes(files.temporaryParent)
})

test('later startup failure cleans already-ready processes without orphans', async (t) => {
  const files = fixture(t)
  const [firstPort, failurePort] = await Promise.all([reservePort(), reservePort()])
  const plan = await buildPlan(files, [
    processSpec(files, 'ready-first', firstPort),
    processSpec(files, 'fails-second', failurePort, 'exit')
  ])
  await assert.rejects(() => withLocalProcessGroup(plan, async () => undefined, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent,
    terminationGraceMs: 100
  }), /exited before readiness/)
  const starts = records(files.trace).filter(item => item.event === 'start')
  assert.equal(starts.length, 2)
  assert.equal(starts.every(item => !alive(item.pid)), true)
  noHomes(files.temporaryParent)
})

test('readiness timeout cleans the timed-out process group', async (t) => {
  const files = fixture(t)
  const port = await reservePort()
  const plan = await buildPlan(files, [processSpec(files, 'timeout', port, 'timeout')], { totalTimeoutMs: 500 })
  await assert.rejects(() => withLocalProcessGroup(plan, async () => undefined, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent,
    terminationGraceMs: 100
  }), /readiness timed out/)
  const start = records(files.trace).find(item => item.event === 'start')
  assert.ok(start?.pid)
  assert.equal(alive(start.pid), false)
  noHomes(files.temporaryParent)
})

test('callback exception still cleans every process in reverse order', async (t) => {
  const files = fixture(t)
  const [firstPort, secondPort] = await Promise.all([reservePort(), reservePort()])
  const plan = await buildPlan(files, [
    processSpec(files, 'callback-first', firstPort),
    processSpec(files, 'callback-second', secondPort)
  ])
  await assert.rejects(() => withLocalProcessGroup(plan, async () => {
    throw new Error('callback failed intentionally')
  }, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent,
    terminationGraceMs: 100
  }), /callback failed intentionally/)
  const trace = records(files.trace)
  assert.deepEqual(trace.filter(item => item.event === 'term').map(item => item.name), ['callback-second', 'callback-first'])
  assert.equal(trace.filter(item => item.event === 'start').every(item => !alive(item.pid)), true)
  noHomes(files.temporaryParent)
})

test('a process that exits after readiness fails the group while a later process is starting', async (t) => {
  const files = fixture(t)
  const [firstPort, slowPort] = await Promise.all([reservePort(), reservePort()])
  const plan = await buildPlan(files, [
    processSpec(files, 'ready-then-exits', firstPort, 'exit-after-ready'),
    processSpec(files, 'slow-second', slowPort, 'slow')
  ])
  await assert.rejects(() => withLocalProcessGroup(plan, async () => undefined, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent,
    terminationGraceMs: 100
  }), /ready-then-exits exited unexpectedly after readiness/)
  const trace = records(files.trace)
  assert.equal(trace.some(item => item.event === 'start' && item.name === 'slow-second'), true)
  assert.equal(trace.filter(item => item.event === 'start').every(item => !alive(item.pid)), true)
  noHomes(files.temporaryParent)
})

test('a ready process exit races and fails an active callback', async (t) => {
  const files = fixture(t)
  const port = await reservePort()
  const plan = await buildPlan(files, [processSpec(files, 'callback-health', port, 'exit-after-ready')])
  await assert.rejects(() => withLocalProcessGroup(plan, async ({ signal }) => {
    await new Promise(resolveWait => signal.addEventListener('abort', resolveWait, { once: true }))
  }, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent,
    terminationGraceMs: 100
  }), /callback-health exited unexpectedly after readiness/)
  const start = records(files.trace).find(item => item.event === 'start')
  assert.equal(alive(start.pid), false)
  noHomes(files.temporaryParent)
})

test('total timeout aborts callback and cleans the process group', async (t) => {
  const files = fixture(t)
  const port = await reservePort()
  const plan = await buildPlan(files, [processSpec(files, 'callback-timeout', port)], { totalTimeoutMs: 500 })
  await assert.rejects(() => withLocalProcessGroup(plan, async ({ signal }) => {
    await new Promise(resolveWait => signal.addEventListener('abort', resolveWait, { once: true }))
  }, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent,
    terminationGraceMs: 100
  }), /total timeout expired during callback/)
  const start = records(files.trace).find(item => item.event === 'start')
  assert.equal(alive(start.pid), false)
  noHomes(files.temporaryParent)
})

test('an external abort signal cancels callback execution and cleans the process group', async (t) => {
  const files = fixture(t)
  const port = await reservePort()
  const plan = await buildPlan(files, [processSpec(files, 'external-cancel', port)])
  const cancellation = new AbortController()
  await assert.rejects(() => withLocalProcessGroup(plan, async ({ signal }) => {
    setTimeout(() => cancellation.abort(), 25).unref()
    await new Promise(resolveWait => signal.addEventListener('abort', resolveWait, { once: true }))
  }, {
    execute: true,
    confirm: plan.confirmationSha256,
    signal: cancellation.signal,
    temporaryParent: files.temporaryParent,
    terminationGraceMs: 100
  }), /process group cancelled/)
  const start = records(files.trace).find(item => item.event === 'start')
  assert.ok(start?.pid)
  assert.equal(await eventuallyNotAlive(start.pid), true)
  noHomes(files.temporaryParent)
})

test('an already-aborted signal starts no process', async (t) => {
  const files = fixture(t)
  const port = await reservePort()
  const plan = await buildPlan(files, [processSpec(files, 'pre-cancelled', port)])
  const cancellation = new AbortController()
  cancellation.abort()
  await assert.rejects(() => withLocalProcessGroup(plan, async () => undefined, {
    execute: true,
    confirm: plan.confirmationSha256,
    signal: cancellation.signal,
    temporaryParent: files.temporaryParent
  }), /process group cancelled/)
  assert.deepEqual(records(files.trace), [])
  noHomes(files.temporaryParent)
})

test('loopback HTTPS readiness accepts only the confirmation-bound CA', async (t) => {
  const files = fixture(t)
  const port = await reservePort()
  const correct = tlsMaterial(files.directory, 'correct-ca')
  const incorrect = tlsMaterial(files.directory, 'incorrect-ca')
  const process = {
    ...processSpec(files, 'tls-ready', port, 'https'),
    env: { TLS_KEY_FILE: correct.key, TLS_CERTIFICATE_FILE: correct.certificate },
    readiness: { url: `https://127.0.0.1:${port}/ready`, status: 204 }
  }
  const plan = await buildLocalProcessGroupPlan({
    rootDir: ROOT,
    allowedWorkingRoots: [ROOT],
    allowedFileRoots: [ROOT, files.directory],
    allowedEnvironment: ['TEST_MARKER', 'TLS_KEY_FILE', 'TLS_CERTIFICATE_FILE'],
    caFile: correct.certificate,
    totalTimeoutMs: 2_000,
    pollMs: 25,
    processes: [process]
  })
  await withLocalProcessGroup(plan, async () => undefined, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent,
    terminationGraceMs: 100
  })
  const wrongCaPlan = await buildLocalProcessGroupPlan({
    rootDir: ROOT,
    allowedWorkingRoots: [ROOT],
    allowedFileRoots: [ROOT, files.directory],
    allowedEnvironment: ['TEST_MARKER', 'TLS_KEY_FILE', 'TLS_CERTIFICATE_FILE'],
    caFile: incorrect.certificate,
    totalTimeoutMs: 500,
    pollMs: 25,
    processes: [process]
  })
  await assert.rejects(() => withLocalProcessGroup(wrongCaPlan, async () => undefined, {
    execute: true,
    confirm: wrongCaPlan.confirmationSha256,
    temporaryParent: files.temporaryParent,
    terminationGraceMs: 100
  }), /readiness timed out/)
  const starts = records(files.trace).filter(item => item.event === 'start')
  assert.equal(starts.length, 2)
  assert.equal(starts.every(item => !alive(item.pid)), true)
  noHomes(files.temporaryParent)
})

test('SIGKILL fallback removes a grandchild that ignores TERM', async (t) => {
  const files = fixture(t)
  const port = await reservePort()
  const plan = await buildPlan(files, [processSpec(files, 'with-child', port, 'child')])
  await withLocalProcessGroup(plan, async () => undefined, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent,
    terminationGraceMs: 100
  })
  const trace = records(files.trace)
  const parent = trace.find(item => item.event === 'start')
  const grandchild = trace.find(item => item.event === 'grandchild')
  assert.ok(parent?.pid && grandchild?.pid)
  assert.equal(await eventuallyNotAlive(parent.pid), true)
  assert.equal(await eventuallyNotAlive(grandchild.pid), true)
  noHomes(files.temporaryParent)
})

test('release gate includes only the fake local process-group safety suite', () => {
  const source = readFileSync(resolve(ROOT, 'scripts/run-release-check.mjs'), 'utf8')
  assert.match(source, /Local process-group supervisor safety behavior/)
  assert.match(source, /'test:process-group-harness'/)
  assert.doesNotMatch(source, /'harness:process-group'/)
})

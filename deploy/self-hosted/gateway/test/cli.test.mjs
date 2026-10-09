import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { rawConfig, rawRequest } from './fixtures.mjs'

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url))

async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

async function writeConfig(t, mode) {
  const dir = await mkdtemp(join(tmpdir(), 'hzy-gateway-cli-'))
  await chmod(dir, 0o700)
  t.after(() => rm(dir, { recursive: true, force: true }))
  const raw = rawConfig()
  raw.listeners = { ingress: { host: '127.0.0.1', port: await freePort() }, health: { host: '127.0.0.1', port: await freePort() } }
  // No timers fire in this test: nothing may try to reach the fixture Platform.
  raw.scheduler = { drain: { enabled: false }, policySync: { enabled: false } }
  const path = join(dir, 'gateway.json')
  await writeFile(path, JSON.stringify(raw), { mode })
  await chmod(path, mode)
  return { path, raw }
}

function run(args) {
  const child = spawn(process.execPath, [serverPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  const output = { stdout: '', stderr: '' }
  child.stdout.on('data', chunk => { output.stdout += chunk })
  child.stderr.on('data', chunk => { output.stderr += chunk })
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)))
  return { child, output, exited }
}

test('refuses to start with a group-readable config (exit 78) without printing secrets', async (t) => {
  const { path, raw } = await writeConfig(t, 0o644)
  const { output, exited } = run(['--config', path])
  assert.equal(await exited, 78)
  assert.match(output.stderr, /owner-only/)
  for (const value of Object.values(raw.secrets)) assert.equal((output.stdout + output.stderr).includes(value), false)
})

test('starts on loopback, serves local health, and stops cleanly on SIGTERM', async (t) => {
  const { path, raw } = await writeConfig(t, 0o600)
  const { child, output, exited } = run(['--config', path])
  t.after(() => child.kill('SIGKILL'))
  const deadline = Date.now() + 15_000
  while (!output.stdout.includes('gateway-started') && Date.now() < deadline) {
    if (child.exitCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.match(output.stdout, /gateway-started/)
  const health = await rawRequest(raw.listeners.health.port, '/healthz', { headers: new Headers({ host: '127.0.0.1' }) })
  assert.equal(health.status, 200)
  assert.equal(JSON.parse(health.body).site.publicHost, raw.site.publicHost)
  const wrongHost = await rawRequest(raw.listeners.ingress.port, '/', { headers: new Headers({ host: 'wiztek.huizhi.yun' }) })
  assert.equal(wrongHost.status, 421)
  child.kill('SIGTERM')
  assert.equal(await exited, 0)
  for (const value of Object.values(raw.secrets)) assert.equal((output.stdout + output.stderr).includes(value), false)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { readFileSync as readSource } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { writeLocalCodocsEditorEnvFile } from '../codocs-editor-env.mjs'

const source = readSource('deploy/test-env/local-enterprise/run-process.mjs', 'utf8')
const start = source.slice(source.indexOf('function startCodocsEditor('), source.indexOf('function startCollab('))
const token = 'fixture-gateway-secret-for-codocs-0123456789'
const serviceSecret = 'fixture-codocs-service-secret-abcdefghijklmnop'
function fixtureRoot(parent, content = JSON.stringify({ HZY_CODOCS_SERVICE_CLIENT_SECRET: serviceSecret }), mode = 0o600) {
  const root = join(parent, 'root')
  const dir = join(root, 'deploy/test-env/.cloudflare-workers/codocs')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'secrets.json')
  writeFileSync(file, content, { mode })
  chmodSync(file, mode)
  return root
}
const profile = {
  features: { workflowLocal: true, companySummaryCodocsDelivery: true },
  runtime: { transportMode: 'loopback', expectedTenant: 'C000001' },
  identity: { codocsDeployment: 'C000001-test-codocs' },
  listeners: { codocsEditor: { host: '127.0.0.1', port: 23130 }, gatewayInternal: { port: 23121 } }
}

test('Codocs editor gets a private local-only env file, never a credential in argv or child env', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hzy-codocs-runner-'))
  const profilePath = join(directory, 'profile.json')
  writeFileSync(profilePath, '{}', { mode: 0o600 })
  let args, options, child
  const startEditor = runInNewContext(`${start}\nstartCodocsEditor`, {
    root: fixtureRoot(directory), values: { profile: profilePath }, writeLocalCodocsEditorEnvFile, process: { env: { HZY0_GATEWAY_INTERNAL_TOKEN: token }, getuid: process.getuid.bind(process) },
    dirname, join, resolve, statSync, mkdtempSync, writeFileSync, rmSync,
    record: value => value,
    spawn: (_command, suppliedArgs, suppliedOptions) => {
      args = suppliedArgs; options = suppliedOptions; child = new EventEmitter(); return child
    }
  })
  try {
    const result = startEditor(profile)
    assert.equal(result, child)
    const file = args[args.indexOf('--env-file') + 1]
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.equal(statSync(dirname(file)).mode & 0o777, 0o700)
    const contents = readFileSync(file, 'utf8')
    assert.match(contents, /^HZY0_CODOCS_LOCAL_ONLY=true$/m)
    assert.match(contents, /^HZY0_LOCAL_ENTERPRISE=true$/m)
    assert.match(contents, /^HZY0_CONSOLE_EGRESS_URL=http:\/\/127\.0\.0\.1:23121$/m)
    assert.ok(contents.includes(`HZY0_GATEWAY_INTERNAL_TOKEN=${token}`))
    assert.match(contents, new RegExp(`^HZY_CODOCS_SERVICE_CLIENT_SECRET=${serviceSecret}$`, 'm'))
    assert.match(contents, /^HZY_CODOCS_OSS_TIMEOUT_MS=30000$/m)
    assert.doesNotMatch(JSON.stringify(args), new RegExp(`${token}|${serviceSecret}`))
    assert.doesNotMatch(JSON.stringify(options.env), new RegExp(`${token}|${serviceSecret}`))
    child.emit('exit', 0)
    assert.throws(() => statSync(file), { code: 'ENOENT' })
    const closed = { ...profile, features: { ...profile.features, codocsLegacyAimsServiceEnabled: false } }
    startEditor(closed)
    const closedFile = args[args.indexOf('--env-file') + 1]
    assert.match(readFileSync(closedFile, 'utf8'), /^HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED=false$/m)
    child.emit('exit', 0)
    startEditor({ ...closed, features: { ...closed.features, companySummaryCodocsDelivery: false } })
    const legacyOnlyFile = args[args.indexOf('--env-file') + 1]
    assert.match(readFileSync(legacyOnlyFile, 'utf8'), /^HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED=false$/m)
    child.emit('exit', 0)
    profile.features.companySummaryCodocsDelivery = false
    startEditor(profile)
    assert.equal(args.includes('--env-file'), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Codocs editor env file fails closed without a safe, well-formed service credential', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hzy-codocs-runner-'))
  const profilePath = join(directory, 'profile.json')
  writeFileSync(profilePath, '{}', { mode: 0o600 })
  const attempt = root => writeLocalCodocsEditorEnvFile({ profile, profilePath, root, gatewaySecret: token })
  try {
    assert.throws(() => attempt(join(directory, 'missing')), /service credential is unavailable/)
    for (const [name, content, mode] of [
      ['absent key', '{}', 0o600],
      ['short value', JSON.stringify({ HZY_CODOCS_SERVICE_CLIENT_SECRET: 'short' }), 0o600],
      ['bad characters', JSON.stringify({ HZY_CODOCS_SERVICE_CLIENT_SECRET: `${serviceSecret}!` }), 0o600],
      ['group readable', JSON.stringify({ HZY_CODOCS_SERVICE_CLIENT_SECRET: serviceSecret }), 0o640],
      ['not json', 'not json', 0o600]
    ]) {
      const parent = mkdtempSync(join(directory, 'case-'))
      assert.throws(() => attempt(fixtureRoot(parent, content, mode)), /service credential (is unavailable|file is unsafe)|unavailable/, name)
    }
    assert.throws(() => writeLocalCodocsEditorEnvFile({ profile, profilePath, root: fixtureRoot(mkdtempSync(join(directory, 'ok-'))), gatewaySecret: '' }), /Gateway credential is unavailable/)
    const ok = attempt(fixtureRoot(mkdtempSync(join(directory, 'good-'))))
    assert.equal(statSync(ok.path).mode & 0o777, 0o600)
    assert.equal(statSync(ok.directory).mode & 0o777, 0o700)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

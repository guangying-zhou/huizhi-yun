import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_SCRIPT = join(ROOT, 'scripts/package-release.sh')
const UPLOAD_SCRIPT = join(ROOT, 'scripts/upload-r2.sh')
const VERSION = '9.9.9-test'

let fixtureRoot
let packageDir
let versionDir
let remoteRoot
let fakeGo
let fakeWrangler
let wranglerLog
let signingKey

function executable(path, content) {
  writeFileSync(path, content, 'utf8')
  chmodSync(path, 0o755)
}

function run(command, args = [], env = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  })
}

function output(result) {
  return `${result.stdout || ''}${result.stderr || ''}`
}

function confirmation(result) {
  const match = output(result).match(/confirmationSha256=([a-f0-9]{64})/)
  assert.ok(match, `missing confirmation digest:\n${output(result)}`)
  return match[1]
}

function packageEnv(extra = {}) {
  return {
    HZY_CONNECTOR_RUNTIME_PACKAGE_DIR: packageDir,
    GO_BIN: fakeGo,
    HZY_CONNECTOR_RUNTIME_COMMIT: 'testcommit',
    HZY_CONNECTOR_RUNTIME_BUILT_AT: '2026-07-14T00:00:00Z',
    HZY_CONNECTOR_RUNTIME_RELEASE_SIGNING_KEY_FILE: signingKey,
    ...extra
  }
}

function uploadEnv(extra = {}) {
  return {
    HZY_CONNECTOR_RUNTIME_PACKAGE_DIR: packageDir,
    WRANGLER_BIN: fakeWrangler,
    FAKE_R2_ROOT: remoteRoot,
    FAKE_WRANGLER_LOG: wranglerLog,
    ...extra
  }
}

function remotePath(key) {
  return join(remoteRoot, 'huizhiyun', key)
}

before(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'hzy-connector-runtime-release-test-'))
  packageDir = join(fixtureRoot, 'packages')
  versionDir = join(packageDir, VERSION)
  remoteRoot = join(fixtureRoot, 'r2')
  wranglerLog = join(fixtureRoot, 'wrangler.log')
  fakeGo = join(fixtureRoot, 'fake-go')
  fakeWrangler = join(fixtureRoot, 'fake-wrangler')
  signingKey = join(fixtureRoot, 'release-signing-private.pem')

  mkdirSync(packageDir, { recursive: true })
  mkdirSync(remoteRoot, { recursive: true })
  const keyResult = spawnSync('openssl', ['genpkey', '-algorithm', 'ED25519', '-out', signingKey], { encoding: 'utf8' })
  assert.equal(keyResult.status, 0, output(keyResult))

  executable(fakeGo, `#!/usr/bin/env bash
set -euo pipefail
output=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "-o" ]; then output="$argument"; fi
  previous="$argument"
done
[ -n "$output" ]
mkdir -p "$(dirname "$output")"
printf 'fake-go arch=%s payload=%s\\n' "\${GOARCH:-unknown}" "\${FAKE_GO_PAYLOAD:-stable}" > "$output"
chmod 755 "$output"
`)

  executable(fakeWrangler, `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (process.env.FAKE_WRANGLER_LOG) fs.appendFileSync(process.env.FAKE_WRANGLER_LOG, args.join(' ') + '\\n')
if (args[0] !== 'r2' || args[1] !== 'object') process.exit(9)
const operation = args[2]
const objectName = args[3]
const fileIndex = args.indexOf('--file')
const file = fileIndex >= 0 ? args[fileIndex + 1] : ''
const target = path.join(process.env.FAKE_R2_ROOT, objectName)
if (operation === 'get') {
  if (!fs.existsSync(target)) {
    process.stderr.write('The specified key does not exist\\n')
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.copyFileSync(target, file)
  process.exit(0)
}
if (operation === 'put') {
  const failMatch = process.env.FAKE_WRANGLER_FAIL_PUT_MATCH || ''
  if (failMatch && objectName.includes(failMatch)) process.exit(7)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(file, target)
  process.exit(0)
}
process.exit(9)
`)
})

after(() => rmSync(fixtureRoot, { recursive: true, force: true }))

describe('immutable Connector Runtime packaging', () => {
  test('requires an independent release signing key', () => {
    const result = run(PACKAGE_SCRIPT, [], packageEnv({ VERSION: '9.9.8-unsigned', HZY_CONNECTOR_RUNTIME_RELEASE_SIGNING_KEY_FILE: '' }))
    assert.notEqual(result.status, 0)
    assert.match(output(result), /RELEASE_SIGNING_KEY_FILE is required/)
  })

  test('creates a complete immutable version inventory', () => {
    const result = run(PACKAGE_SCRIPT, [], packageEnv({ VERSION }))
    assert.equal(result.status, 0, output(result))
    for (const file of [
      'install.sh', 'install.sh.sig', 'manifest.json', 'manifest.json.sig',
      'release.sha256', 'version.txt',
      `hzy-connector-runtime_${VERSION}_linux_amd64.tar.gz`,
      `hzy-connector-runtime_${VERSION}_linux_arm64.tar.gz`
    ]) assert.ok(existsSync(join(versionDir, file)), file)
    const manifest = JSON.parse(readFileSync(join(versionDir, 'manifest.json'), 'utf8'))
    assert.equal(manifest.version, VERSION)
    assert.equal(manifest.signature.algorithm, 'Ed25519')
    assert.match(manifest.signature.keyId, /^[a-f0-9]{64}$/)
    const archive = join(versionDir, `hzy-connector-runtime_${VERSION}_linux_amd64.tar.gz`)
    const inventory = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    assert.equal(inventory.status, 0, output(inventory))
    assert.match(inventory.stdout, /^\.\/verify-slo-window\.sh$/m)
  })

  test('refuses to overwrite an immutable version', () => {
    const before = readFileSync(join(versionDir, 'release.sha256'), 'utf8')
    const result = run(PACKAGE_SCRIPT, [], packageEnv({ VERSION, FAKE_GO_PAYLOAD: 'changed' }))
    assert.notEqual(result.status, 0)
    assert.match(output(result), /refusing to overwrite immutable version/)
    assert.equal(readFileSync(join(versionDir, 'release.sha256'), 'utf8'), before)
  })
})

describe('staged and confirmed Connector Runtime R2 publication', () => {
  let stageDigest
  let promoteDigest

  test('preview is deterministic and offline', () => {
    rmSync(wranglerLog, { force: true })
    const first = run(UPLOAD_SCRIPT, [VERSION, '--stage'], uploadEnv())
    const second = run(UPLOAD_SCRIPT, [VERSION, '--stage'], uploadEnv())
    assert.equal(first.status, 0, output(first))
    assert.equal(second.status, 0, output(second))
    stageDigest = confirmation(first)
    assert.equal(confirmation(second), stageDigest)
    assert.match(output(first), /PREVIEW ONLY/)
    assert.equal(existsSync(wranglerLog), false)
  })

  test('stage uploads only the immutable version', () => {
    const result = run(UPLOAD_SCRIPT, [VERSION, '--stage', '--execute', '--confirm', stageDigest], uploadEnv())
    assert.equal(result.status, 0, output(result))
    assert.ok(existsSync(remotePath(`packages/hzy-connector-runtime/${VERSION}/release.sha256`)))
    assert.equal(existsSync(remotePath('packages/hzy-connector-runtime/latest/version.txt')), false)
  })

  test('changed immutable remote object is rejected before any put', () => {
    const remoteManifest = remotePath(`packages/hzy-connector-runtime/${VERSION}/manifest.json`)
    const localManifest = join(versionDir, 'manifest.json')
    writeFileSync(remoteManifest, 'tampered\n')
    writeFileSync(wranglerLog, '')
    const result = run(UPLOAD_SCRIPT, [VERSION, '--stage', '--execute', '--confirm', stageDigest], uploadEnv())
    assert.notEqual(result.status, 0)
    assert.match(output(result), /refusing to overwrite immutable remote object/)
    assert.doesNotMatch(readFileSync(wranglerLog, 'utf8'), /^r2 object put /m)
    writeFileSync(remoteManifest, readFileSync(localManifest))
  })

  test('failed promotion never changes the activation pointer', () => {
    const pointer = remotePath('packages/hzy-connector-runtime/latest/version.txt')
    mkdirSync(dirname(pointer), { recursive: true })
    writeFileSync(pointer, '0.3.0\n')
    const preview = run(UPLOAD_SCRIPT, [VERSION, '--promote'], uploadEnv())
    assert.equal(preview.status, 0, output(preview))
    promoteDigest = confirmation(preview)
    writeFileSync(wranglerLog, '')
    const result = run(UPLOAD_SCRIPT, [VERSION, '--promote', '--execute', '--confirm', promoteDigest], uploadEnv({ FAKE_WRANGLER_FAIL_PUT_MATCH: 'latest/manifest.json' }))
    assert.notEqual(result.status, 0)
    assert.equal(readFileSync(pointer, 'utf8'), '0.3.0\n')
    assert.doesNotMatch(readFileSync(wranglerLog, 'utf8'), /r2 object put .*latest\/version\.txt/)
  })

  test('successful promotion writes latest/version.txt last', () => {
    writeFileSync(wranglerLog, '')
    const result = run(UPLOAD_SCRIPT, [VERSION, '--promote', '--execute', '--confirm', promoteDigest], uploadEnv())
    assert.equal(result.status, 0, output(result))
    assert.equal(readFileSync(remotePath('packages/hzy-connector-runtime/latest/version.txt'), 'utf8'), `${VERSION}\n`)
    const puts = readFileSync(wranglerLog, 'utf8').split('\n').filter(line => line.startsWith('r2 object put '))
    assert.match(puts.at(-1), /packages\/hzy-connector-runtime\/latest\/version\.txt/)
  })
})

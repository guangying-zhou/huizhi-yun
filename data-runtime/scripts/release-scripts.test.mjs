import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const DATA_RUNTIME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_SCRIPT = join(DATA_RUNTIME_ROOT, 'scripts/package-release.sh')
const UPLOAD_SCRIPT = join(DATA_RUNTIME_ROOT, 'scripts/upload-r2.sh')
const INSTALL_SCRIPT = join(DATA_RUNTIME_ROOT, 'deploy/install.sh')
const VERSION = '9.9.9-test'

let fixtureRoot
let packageDir
let versionDir
let remoteRoot
let fakeGo
let fakeWrangler
let wranglerLog
let signingKey
let signingPublicKey

function executable(path, content) {
  writeFileSync(path, content, 'utf8')
  chmodSync(path, 0o755)
}

function run(command, args = [], env = {}) {
  return spawnSync(command, args, {
    cwd: DATA_RUNTIME_ROOT,
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
    HZY_DATA_RUNTIME_PACKAGE_DIR: packageDir,
    GO_BIN: fakeGo,
    HZY_DATA_RUNTIME_COMMIT: 'testcommit',
    HZY_DATA_RUNTIME_BUILT_AT: '2026-07-10T00:00:00Z',
    HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE: signingKey,
    ...extra
  }
}

function uploadEnv(extra = {}) {
  return {
    HZY_DATA_RUNTIME_PACKAGE_DIR: packageDir,
    WRANGLER_BIN: fakeWrangler,
    FAKE_R2_ROOT: remoteRoot,
    FAKE_WRANGLER_LOG: wranglerLog,
    ...extra
  }
}

function remotePath(key) {
  return join(remoteRoot, 'huizhiyun', key)
}

test('installer persists and restores the Directory Connector enable state', () => {
  const installer = readFileSync(INSTALL_SCRIPT, 'utf8')

  assert.match(installer, /DIRECTORY_CONNECTOR_ENABLED="\$\{HZY_DIRECTORY_CONNECTOR_ENABLED:-\}"/)
  assert.match(installer, /read_env_value HZY_DIRECTORY_CONNECTOR_ENABLED/)
  assert.match(installer, /\[ -f "\$CONFIG_DIR\/directory\.env" \]/)
  assert.match(installer, /HZY_DIRECTORY_CONNECTOR_ENABLED="\$DIRECTORY_CONNECTOR_ENABLED"/)
  assert.match(installer, /write_env_kv HZY_DIRECTORY_CONNECTOR_ENABLED "\$DIRECTORY_CONNECTOR_ENABLED"/)
  assert.match(installer, /resolve_directory_connector_enabled[\s\S]*?ensure_user_group/)
})

test('installer activates Runtime trust before redeeming a Directory Connector token', () => {
  const installer = readFileSync(INSTALL_SCRIPT, 'utf8')
  const mainFlow = installer.slice(installer.indexOf('echo "Downloading hzy-data-runtime package:"'))
  const retireOverlayIndex = mainFlow.indexOf('retire_stale_control_overlays_after_enrollment')
  const runtimeRestartIndex = mainFlow.indexOf('systemctl restart "$SERVICE_NAME"')
  const connectorEnrollmentIndex = mainFlow.indexOf('write_directory_connector_env', runtimeRestartIndex)
  const connectorRestartIndex = mainFlow.indexOf('systemctl restart "${SERVICE_NAME}-directory"')

  assert.ok(retireOverlayIndex >= 0, 'installer must retire enrollment-stale protected overlays')
  assert.ok(runtimeRestartIndex > retireOverlayIndex, 'Runtime must restart after stale overlays are retired')
  assert.ok(connectorEnrollmentIndex > runtimeRestartIndex, 'connector enrollment must run after Runtime restart')
  assert.ok(connectorRestartIndex > connectorEnrollmentIndex, 'connector service must restart after enrollment')
  assert.match(installer, /--no-start cannot redeem a Directory Connector enrollment token/)
})

before(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'hzy-data-runtime-release-test-'))
  packageDir = join(fixtureRoot, 'packages')
  versionDir = join(packageDir, VERSION)
  remoteRoot = join(fixtureRoot, 'r2')
  wranglerLog = join(fixtureRoot, 'wrangler.log')
  fakeGo = join(fixtureRoot, 'fake-go')
  fakeWrangler = join(fixtureRoot, 'fake-wrangler')
  signingKey = join(fixtureRoot, 'release-signing-private.pem')
  signingPublicKey = join(fixtureRoot, 'release-signing-public.pem')

  mkdirSync(packageDir, { recursive: true })
  mkdirSync(remoteRoot, { recursive: true })

  const keyResult = spawnSync('openssl', ['genpkey', '-algorithm', 'ED25519', '-out', signingKey], { encoding: 'utf8' })
  assert.equal(keyResult.status, 0, output(keyResult))
  const publicResult = spawnSync('openssl', ['pkey', '-in', signingKey, '-pubout', '-out', signingPublicKey], { encoding: 'utf8' })
  assert.equal(publicResult.status, 0, output(publicResult))

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
const log = process.env.FAKE_WRANGLER_LOG
if (log) fs.appendFileSync(log, args.join(' ') + '\\n')
if (args[0] === '--version') process.exit(0)
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
  if (failMatch && objectName.includes(failMatch)) {
    process.stderr.write('injected put failure\\n')
    process.exit(7)
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(file, target)
  process.exit(0)
}
process.exit(9)
`)
})

after(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

describe('immutable data-runtime release packaging', () => {
  test('refuses to package a release without an independent signing key', () => {
    const result = run(PACKAGE_SCRIPT, ['9.9.8-unsigned'], packageEnv({ HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE: '' }))
    assert.notEqual(result.status, 0)
    assert.match(output(result), /RELEASE_SIGNING_KEY_FILE is required/)
    assert.equal(existsSync(join(packageDir, '9.9.8-unsigned')), false)
  })

  test('publishes a complete version directory atomically and keeps installer versioned', () => {
    const result = run(PACKAGE_SCRIPT, [VERSION], packageEnv())
    assert.equal(result.status, 0, output(result))
    assert.ok(existsSync(join(versionDir, 'install.sh')))
    assert.ok(existsSync(join(versionDir, 'release.sha256')))
    assert.ok(existsSync(join(versionDir, 'manifest.json.sig')))
    assert.ok(existsSync(join(versionDir, 'install.sh.sig')))
    assert.ok(existsSync(join(versionDir, `hzy-data-runtime_${VERSION}_linux_amd64.tar.gz`)))
    assert.ok(existsSync(join(versionDir, `hzy-data-runtime_${VERSION}_linux_arm64.tar.gz`)))
    const manifest = JSON.parse(readFileSync(join(versionDir, 'manifest.json'), 'utf8'))
    assert.deepEqual(manifest.platforms, [
      { os: 'linux', arch: 'amd64' },
      { os: 'linux', arch: 'arm64' }
    ])
    assert.equal(manifest.installer.path, 'install.sh')
    assert.equal(manifest.signature.algorithm, 'Ed25519')
    assert.match(manifest.signature.keyId, /^[a-f0-9]{64}$/)
    assert.equal(manifest.artifacts.length, 2)
    assert.equal(manifest.artifacts.every(item => existsSync(join(versionDir, item.signaturePath))), true)
    assert.equal(existsSync(join(packageDir, 'latest')), false)
  })

  test('refuses to overwrite the same version when candidate hashes differ', () => {
    const inventoryBefore = readFileSync(join(versionDir, 'release.sha256'), 'utf8')
    const result = run(PACKAGE_SCRIPT, [VERSION], packageEnv({ FAKE_GO_PAYLOAD: 'tampered' }))
    assert.notEqual(result.status, 0)
    assert.match(output(result), /refusing to overwrite immutable version/)
    assert.equal(readFileSync(join(versionDir, 'release.sha256'), 'utf8'), inventoryBefore)
  })

  test('installer requires an independent public key and verifies the archive signature', () => {
    const source = readFileSync(INSTALL_SCRIPT, 'utf8')
    assert.match(source, /--release-public-key/)
    assert.match(source, /HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_FILE/)
    assert.match(source, /pkeyutl -verify -rawin -pubin/)
    assert.match(source, /package\.tar\.gz\.sig/)
    assert.match(source, /\[ -n "\$enrollment_code" \] \|\| return 0/)
  })

  test('installer lets the isolated Directory Connector traverse its protected config path', () => {
    const source = readFileSync(INSTALL_SCRIPT, 'utf8')
    assert.match(source, /config_dir_group="\$DIRECTORY_RUN_GROUP"/)
    assert.match(source, /install -d -m 750 -o "\$RUN_USER" -g "\$config_dir_group" "\$CONFIG_DIR"/)
    assert.match(source, /chown "\$DIRECTORY_RUN_USER:\$DIRECTORY_RUN_GROUP" "\$private_key"/)
    assert.match(source, /chmod 600 "\$private_key"/)
  })
})

describe('staged and confirmed R2 publication', () => {
  let stageConfirmation
  let promoteConfirmation

  test('stage preview is deterministic and makes no Wrangler call', () => {
    rmSync(wranglerLog, { force: true })
    const first = run(UPLOAD_SCRIPT, [VERSION, '--stage'], uploadEnv())
    const second = run(UPLOAD_SCRIPT, [VERSION, '--stage'], uploadEnv())
    assert.equal(first.status, 0, output(first))
    assert.equal(second.status, 0, output(second))
    stageConfirmation = confirmation(first)
    assert.equal(confirmation(second), stageConfirmation)
    assert.match(output(first), /PREVIEW ONLY/)
    assert.equal(existsSync(wranglerLog), false)
  })

  test('stage uploads only the pinned version after exact confirmation', () => {
    const result = run(
      UPLOAD_SCRIPT,
      [VERSION, '--stage', '--execute', '--confirm', stageConfirmation],
      uploadEnv()
    )
    assert.equal(result.status, 0, output(result))
    assert.ok(existsSync(remotePath(`packages/hzy-data-runtime/${VERSION}/release.sha256`)))
    assert.equal(existsSync(remotePath('packages/hzy-data-runtime/latest/version.txt')), false)
  })

  test('execute rejects the wrong confirmation before invoking Wrangler', () => {
    writeFileSync(wranglerLog, '')
    const result = run(
      UPLOAD_SCRIPT,
      [VERSION, '--stage', '--execute', '--confirm', '0'.repeat(64)],
      uploadEnv()
    )
    assert.notEqual(result.status, 0)
    assert.match(output(result), /confirmation digest mismatch/)
    assert.equal(readFileSync(wranglerLog, 'utf8'), '')
  })

  test('stage preflight rejects a changed immutable remote object before any put', () => {
    const remoteManifest = remotePath(`packages/hzy-data-runtime/${VERSION}/manifest.json`)
    const localManifest = join(versionDir, 'manifest.json')
    writeFileSync(remoteManifest, 'tampered remote manifest\n')
    writeFileSync(wranglerLog, '')

    const result = run(
      UPLOAD_SCRIPT,
      [VERSION, '--stage', '--execute', '--confirm', stageConfirmation],
      uploadEnv()
    )
    assert.notEqual(result.status, 0)
    assert.match(output(result), /refusing to overwrite immutable remote version/)
    assert.doesNotMatch(readFileSync(wranglerLog, 'utf8'), /^r2 object put /m)

    writeFileSync(remoteManifest, readFileSync(localManifest))
  })

  test('promote stops on failure without changing latest version pointer', () => {
    const oldPointer = remotePath('packages/hzy-data-runtime/latest/version.txt')
    mkdirSync(dirname(oldPointer), { recursive: true })
    writeFileSync(oldPointer, '8.8.8-old\n')

    const preview = run(UPLOAD_SCRIPT, [VERSION, '--promote'], uploadEnv())
    assert.equal(preview.status, 0, output(preview))
    promoteConfirmation = confirmation(preview)
    writeFileSync(wranglerLog, '')

    const result = run(
      UPLOAD_SCRIPT,
      [VERSION, '--promote', '--execute', '--confirm', promoteConfirmation],
      uploadEnv({ FAKE_WRANGLER_FAIL_PUT_MATCH: 'latest/manifest.json' })
    )
    assert.notEqual(result.status, 0)
    assert.equal(readFileSync(oldPointer, 'utf8'), '8.8.8-old\n')
    assert.doesNotMatch(readFileSync(wranglerLog, 'utf8'), /r2 object put .*latest\/version\.txt/)
  })

  test('successful promotion writes latest version pointer last', () => {
    writeFileSync(wranglerLog, '')
    const result = run(
      UPLOAD_SCRIPT,
      [VERSION, '--promote', '--execute', '--confirm', promoteConfirmation],
      uploadEnv()
    )
    assert.equal(result.status, 0, output(result))
    assert.equal(
      readFileSync(remotePath('packages/hzy-data-runtime/latest/version.txt'), 'utf8'),
      `${VERSION}\n`
    )
    assert.ok(existsSync(remotePath('packages/hzy-data-runtime/install.sh.sig')))

    const puts = readFileSync(wranglerLog, 'utf8')
      .split('\n')
      .filter(line => line.startsWith('r2 object put '))
    assert.ok(puts.length > 0)
    assert.match(puts.at(-1), /packages\/hzy-data-runtime\/latest\/version\.txt/)
  })

  test('packages, stages and promotes amd64 only when arm64 is disabled', () => {
    const amd64Version = '9.9.7-amd64-only'
    const amd64VersionDir = join(packageDir, amd64Version)
    const prefix = 'packages/hzy-data-runtime-amd64-only'
    const scopedUploadEnv = uploadEnv({ HZY_R2_PREFIX: prefix })

    const packageResult = run(
      PACKAGE_SCRIPT,
      [amd64Version],
      packageEnv({ HZY_DATA_RUNTIME_BUILD_LINUX_ARM64: 'false' })
    )
    assert.equal(packageResult.status, 0, output(packageResult))
    assert.ok(existsSync(join(amd64VersionDir, `hzy-data-runtime_${amd64Version}_linux_amd64.tar.gz`)))
    assert.equal(existsSync(join(amd64VersionDir, `hzy-data-runtime_${amd64Version}_linux_arm64.tar.gz`)), false)

    const manifest = JSON.parse(readFileSync(join(amd64VersionDir, 'manifest.json'), 'utf8'))
    assert.deepEqual(manifest.platforms, [{ os: 'linux', arch: 'amd64' }])
    assert.deepEqual(manifest.artifacts.map(item => item.arch), ['amd64'])

    const stagePreview = run(UPLOAD_SCRIPT, [amd64Version, '--stage'], scopedUploadEnv)
    assert.equal(stagePreview.status, 0, output(stagePreview))
    const stageResult = run(
      UPLOAD_SCRIPT,
      [amd64Version, '--stage', '--execute', '--confirm', confirmation(stagePreview)],
      scopedUploadEnv
    )
    assert.equal(stageResult.status, 0, output(stageResult))

    const promotePreview = run(UPLOAD_SCRIPT, [amd64Version, '--promote'], scopedUploadEnv)
    assert.equal(promotePreview.status, 0, output(promotePreview))
    const promoteResult = run(
      UPLOAD_SCRIPT,
      [amd64Version, '--promote', '--execute', '--confirm', confirmation(promotePreview)],
      scopedUploadEnv
    )
    assert.equal(promoteResult.status, 0, output(promoteResult))
    assert.ok(existsSync(join(remoteRoot, 'huizhiyun', prefix, 'latest/hzy-data-runtime_linux_amd64.tar.gz')))
    assert.equal(existsSync(join(remoteRoot, 'huizhiyun', prefix, 'latest/hzy-data-runtime_linux_arm64.tar.gz')), false)
  })

  test('default Wrangler is pinned unless an executable is explicitly injected', () => {
    const source = readFileSync(UPLOAD_SCRIPT, 'utf8')
    assert.match(source, /WRANGLER_VERSION="4\.110\.0"/)
    assert.match(source, /WRANGLER_BIN/)
    assert.doesNotMatch(source, /command -v wrangler/)
    assert.doesNotMatch(source, /wrangler@4(?:"|\s|$)/)
  })
})

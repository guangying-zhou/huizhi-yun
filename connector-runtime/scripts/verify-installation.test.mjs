import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, before, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VERIFY = join(ROOT, 'deploy/verify-installation.sh')
const VERIFY_SLO = join(ROOT, 'deploy/verify-slo-window.sh')
const INSTALLER = join(ROOT, 'deploy/install.sh')
const PACKAGER = join(ROOT, 'scripts/package-release.sh')

let fixture
let fakeBin
let installDir
let envFile
let privateKey
let releasePublicKey
let binary
let sqlite
let health
let capabilities
let probe

function executable(path, content) {
  writeFileSync(path, content, 'utf8')
  chmodSync(path, 0o755)
}

function writeRuntimeEnv(dataRuntimeUrl = 'https://wiztek-data-runtime.huizhi.yun') {
  writeFileSync(envFile, [
    'HZY_CONNECTOR_RUNTIME_PORT="18082"',
    `HZY_CONNECTOR_RUNTIME_SQLITE_PATH=${JSON.stringify(sqlite)}`,
    `HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL=${JSON.stringify(dataRuntimeUrl)}`,
    'HZY_CONNECTOR_RUNTIME_CLIENT_SECRET="must-never-appear"'
  ].join('\n') + '\n', { mode: 0o600 })
  chmodSync(envFile, 0o600)
}

function writeCapabilities(overrides = {}) {
  const data = {
    schemaVersion: 'hzy.connector-capabilities.v1',
    runtimeProduct: 'hzy-connector-runtime',
    arbitraryHttpProxy: false,
    channels: ['wecom', 'dingtalk'],
    scopes: [
      'connector-runtime:notifications:send',
      'connector-runtime:deliveries:read',
      'connector-runtime:deliveries:reconcile',
      'connector-runtime:identity:exchange',
      'connector-runtime:identity:dingtalk:exchange',
      'connector-runtime:people:sync',
      'connector-runtime:jobs:view',
      'connector-runtime:jobs:cancel',
      'connector-runtime:diagnostics:view',
      'connector-runtime:directory:sync'
    ],
    providers: [
      { code: 'wecom', allowedOrigins: ['https://qyapi.weixin.qq.com'], dynamicTargetAllowed: false, credentialSource: 'console-vault' },
      { code: 'dingtalk', allowedOrigins: ['https://api.dingtalk.com', 'https://oapi.dingtalk.com'], dynamicTargetAllowed: false, credentialSource: 'console-vault' }
    ],
    capabilities: [
      {
        code: 'identity.wecom.browser-login', version: 'v1', method: 'POST',
        path: '/v1/identity/wecom/authorizations', requiredScope: 'connector-runtime:identity:exchange'
      }
    ],
    ...overrides
  }
  writeFileSync(capabilities, JSON.stringify({ code: 0, data }))
}

function run(extra = {}) {
  return spawnSync('bash', [VERIFY], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      HZY_CONNECTOR_RUNTIME_SERVICE_NAME: 'hzy-connector-runtime',
      HZY_CONNECTOR_RUNTIME_INSTALL_DIR: installDir,
      HZY_CONNECTOR_RUNTIME_ENV_FILE: envFile,
      HZY_CONNECTOR_RUNTIME_BINARY: binary,
      HZY_CONNECTOR_RUNTIME_PRIVATE_KEY_FILE: privateKey,
      HZY_CONNECTOR_RUNTIME_RELEASE_PUBLIC_KEY_FILE: releasePublicKey,
      HZY_CONNECTOR_RUNTIME_EXPECTED_VERSION: '0.4.3',
      HZY_CONNECTOR_RUNTIME_EXPECTED_TENANT: 'C000001',
      HZY_CONNECTOR_RUNTIME_EXPECTED_DEPLOYMENT: 'C000001-console',
      HZY_CONNECTOR_RUNTIME_EXPECTED_DATA_RUNTIME_URL: 'https://wiztek-data-runtime.huizhi.yun',
      FIXTURE_HEALTH: health,
      FIXTURE_CAPABILITIES: capabilities,
      FIXTURE_PROBE: probe,
      ...extra
    },
    encoding: 'utf8'
  })
}

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'hzy-connector-runtime-verify-'))
  fakeBin = join(fixture, 'bin')
  installDir = join(fixture, 'install')
  envFile = join(installDir, '.env')
  privateKey = join(fixture, 'connector-private.pem')
  releasePublicKey = join(fixture, 'release-signing-public.pem')
  binary = join(fakeBin, 'hzy-connector-runtime')
  sqlite = join(installDir, 'data/operations.db')
  health = join(fixture, 'health.json')
  capabilities = join(fixture, 'capabilities.json')
  probe = join(fixture, 'probe.json')
  mkdirSync(fakeBin, { recursive: true })
  mkdirSync(dirname(sqlite), { recursive: true })

  const releasePrivateKey = join(fixture, 'release-private.pem')
  assert.equal(spawnSync('openssl', ['genpkey', '-algorithm', 'ED25519', '-out', releasePrivateKey]).status, 0)
  assert.equal(spawnSync('openssl', ['pkey', '-in', releasePrivateKey, '-pubout', '-out', releasePublicKey]).status, 0)
  chmodSync(releasePublicKey, 0o644)
  writeFileSync(privateKey, 'fixture-private-key\n', { mode: 0o600 })
  writeFileSync(sqlite, 'fixture-sqlite\n', { mode: 0o600 })
  executable(binary, '#!/usr/bin/env bash\n[[ "${1:-}" == "-version" ]] && echo 0.4.3\n')
  executable(join(fakeBin, 'systemctl'), `#!/usr/bin/env bash
case "$1" in
  is-active|is-enabled) exit 0 ;;
  show)
    case "$*" in
      *ActiveState*) echo active ;;
      *SubState*) echo running ;;
      *ExecMainStatus*) echo 0 ;;
      *) exit 1 ;;
    esac
    ;;
  *) exit 1 ;;
esac
`)
  executable(join(fakeBin, 'curl'), `#!/usr/bin/env bash
output=""
write_status=0
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -w) write_status=1; shift 2 ;;
    --data|-H|-X) shift 2 ;;
    -*) shift ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  */runtime/health) cp "$FIXTURE_HEALTH" "$output"; status=200 ;;
  */runtime/capabilities) cp "$FIXTURE_CAPABILITIES" "$output"; status=200 ;;
  */runtime/internal/connector-runtime/people-sync-batches)
    cp "$FIXTURE_PROBE" "$output"
    status="\${FAKE_PROBE_STATUS:-401}"
    ;;
  *) exit 22 ;;
esac
if [[ "$write_status" -eq 1 ]]; then printf '%s' "$status"; fi
exit 0
`)
})

beforeEach(() => {
  writeRuntimeEnv()
  writeFileSync(health, JSON.stringify({ code: 0, data: {
    status: 'ok', version: '0.4.3', runtimeProduct: 'hzy-connector-runtime', tenant: 'C000001',
    deployment: 'C000001-console', authMode: 'jwt', providers: ['wecom', 'dingtalk'],
    deliveryStore: 'ready', deliveryStoreType: 'sqlite'
  } }))
  writeCapabilities()
  writeFileSync(probe, JSON.stringify({ error: { code: 'connector_runtime_signature_missing' } }))
})

after(() => rmSync(fixture, { recursive: true, force: true }))

test('verifies a split-server installation without printing credentials', () => {
  const result = run()
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const output = `${result.stdout}${result.stderr}`
  assert.match(output, /OK version=0\.4\.3 service=hzy-connector-runtime/)
  assert.match(output, /data-runtime HTTPS reachability and signature fail-closed boundary/)
  assert.doesNotMatch(output, /must-never-appear|CLIENT_SECRET/)
})

test('rejects remote plaintext HTTP and an origin mismatch', () => {
  writeRuntimeEnv('http://wiztek-data-runtime.huizhi.yun')
  let result = run()
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /not a secure origin/)

  writeRuntimeEnv('https://other-runtime.example.com')
  result = run()
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /does not match the expected origin/)
})

test('rejects a generic proxy capability or incomplete scope set', () => {
  writeCapabilities({ arbitraryHttpProxy: true })
  let result = run()
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /arbitrary HTTP proxy must be disabled/)

  writeCapabilities({ scopes: ['connector-runtime:notifications:send'] })
  result = run()
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /scope set mismatch/)
})

test('requires the remote data-runtime signature boundary to be reachable', () => {
  const result = run({ FAKE_PROBE_STATUS: '404' })
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /signature boundary probe returned HTTP 404/)
})

test('packaging and installation wire the verifier and fail closed', () => {
  const installer = readFileSync(INSTALLER, 'utf8')
  const packager = readFileSync(PACKAGER, 'utf8')
  assert.match(packager, /deploy\/verify-installation\.sh/)
  assert.match(packager, /deploy\/verify-slo-window\.sh/)
  assert.match(installer, /install -m 0755 "\$tmp_dir\/verify-installation\.sh"/)
  assert.match(installer, /install -m 0755 "\$tmp_dir\/verify-slo-window\.sh"/)
  assert.match(installer, /package is missing verify-slo-window\.sh/)
  assert.match(installer, /HZY_CONNECTOR_RUNTIME_EXPECTED_DATA_RUNTIME_URL/)
  assert.match(installer, /HZY_CONNECTOR_RUNTIME_EXPECTED_RELEASE_KEY_ID/)
  assert.match(installer, /installation verification failed; service and update timer were stopped/)
})

test('SLO window verifier is executable and redaction-aware', () => {
  const verifier = readFileSync(VERIFY_SLO, 'utf8')
  assert.match(verifier, /connector_runtime_slo_window_verified/)
  assert.match(verifier, /forbidden_key_fragments/)
  assert.match(verifier, /service restart count/)
})

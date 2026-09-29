import assert from 'node:assert/strict'
import { chmod, link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildWorkerEnv, ConfigError, expectedBinding, loadConfig, readConfigFile, validateConfig } from '../config.mjs'
import { disabledBinding } from '../egress.mjs'
import { rawConfig } from './fixtures.mjs'

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hzy-gateway-config-'))
  await chmod(dir, 0o700)
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function writeConfig(dir, value, mode = 0o600, name = 'gateway.json') {
  const path = join(dir, name)
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value), { mode })
  await chmod(path, mode)
  return path
}

async function rejects(promise, pattern) {
  await assert.rejects(promise, error => error instanceof ConfigError && error.issues.some(issue => pattern.test(issue)))
}

test('owner-only regular file is accepted and secrets stay non-enumerable', async (t) => {
  const dir = await tempDir(t)
  const raw = rawConfig()
  const config = await loadConfig(await writeConfig(dir, raw))
  assert.equal(config.site.publicHost, raw.site.publicHost)
  assert.equal(config.secrets.gatewayInternalToken, raw.secrets.gatewayInternalToken)
  const serialized = JSON.stringify(config)
  assert.equal(serialized.includes(raw.secrets.gatewayInternalToken), false)
  assert.equal(serialized.includes(raw.secrets.platformRegistryToken), false)
})

test('group/other-readable config file is refused', async (t) => {
  const dir = await tempDir(t)
  for (const mode of [0o644, 0o640, 0o604, 0o700]) {
    await rejects(readConfigFile(await writeConfig(dir, rawConfig(), mode, `mode-${mode.toString(8)}.json`)), /owner-only/)
  }
})

test('symlinked config file is refused even when the target is 0600', async (t) => {
  const dir = await tempDir(t)
  const target = await writeConfig(dir, rawConfig(), 0o600, 'real.json')
  const linkPath = join(dir, 'gateway.json')
  await symlink(target, linkPath)
  await rejects(readConfigFile(linkPath), /symlink/)
})

test('hard-linked, foreign-owned, oversized, relative or group-writable-directory configs are refused', async (t) => {
  const dir = await tempDir(t)
  const path = await writeConfig(dir, rawConfig())
  await link(path, join(dir, 'alias.json'))
  await rejects(readConfigFile(path), /hard links/)

  const other = await writeConfig(dir, rawConfig(), 0o600, 'other.json')
  await rejects(readConfigFile(other, { expectedUid: (process.getuid?.() ?? 0) + 1 }), /owned by the gateway user/)

  const big = await writeConfig(dir, `{"pad":"${'x'.repeat(70 * 1024)}"}`, 0o600, 'big.json')
  await rejects(readConfigFile(big), /at most/)

  await rejects(readConfigFile('gateway.json'), /absolute/)

  const open = await mkdtemp(join(tmpdir(), 'hzy-gateway-open-'))
  t.after(() => rm(open, { recursive: true, force: true }))
  await chmod(open, 0o777)
  await rejects(readConfigFile(await writeConfig(open, rawConfig())), /directory/)
})

test('example config ships placeholders only and is rejected as-is', async () => {
  const example = JSON.parse(await readFile(new URL('../gateway.config.example.json', import.meta.url), 'utf8'))
  assert.throws(() => validateConfig(example), (error) => {
    assert.ok(error instanceof ConfigError)
    for (const field of ['site.publicHost', 'site.tenantCode', 'platform.origin', 'runtime.endpoint',
      'secrets.gatewayInternalToken', 'secrets.platformRegistryToken', 'apps.console.deploymentCode']) {
      assert.ok(error.issues.some(issue => issue.startsWith(field)), field)
    }
    // Issue texts never echo configured values.
    assert.equal(error.message.includes('REPLACE_WITH'), false)
    return true
  })
})

test('validation refuses non-HTTPS Platform, non-loopback listeners/apps and weak or shared secrets', () => {
  const cases = [
    [raw => { raw.platform.origin = 'http://platform.selfhosted-fixture.test' }, /platform.origin must use HTTPS/],
    [raw => { raw.platform.origin = 'https://user:pw@platform.selfhosted-fixture.test' }, /platform.origin/],
    [raw => { raw.runtime.endpoint = 'https://127.0.0.1:18084' }, /runtime.endpoint/],
    [raw => { raw.listeners.ingress.host = '0.0.0.0' }, /listeners.ingress.host/],
    [raw => { raw.listeners.health.host = '192.168.1.10' }, /listeners.health.host/],
    [raw => { raw.listeners.health.port = raw.listeners.ingress.port }, /unique/],
    [raw => { raw.apps.console.origin = 'http://10.0.0.5:3000' }, /apps.console.origin/],
    [raw => { raw.apps.console.origin = 'http://localhost:3000' }, /apps.console.origin/],
    [raw => { raw.apps.console.origin = 'https://console.huizhi.yun' }, /apps.console.origin/],
    [raw => { raw.secrets.gatewayInternalToken = 'short' }, /gatewayInternalToken/],
    [raw => { raw.secrets.platformRegistryToken = raw.secrets.gatewayInternalToken }, /must differ/],
    [raw => { raw.scheduler.drain.apps = ['workflow'] }, /local deployments only/],
    [raw => { raw.scheduler.drain.apps = ['enterprise'] }, /not a scheduler app/],
    [raw => { raw.enterprise = { pilot: true } }, /require apps.enterprise/],
    [raw => { raw.site.publicHost = '203.0.113.7' }, /site.publicHost/],
    [raw => { raw.unknown = true }, /config.unknown is not allowed/]
  ]
  for (const [mutate, pattern] of cases) {
    const raw = rawConfig()
    mutate(raw)
    assert.throws(() => validateConfig(raw), error => error instanceof ConfigError && error.issues.some(issue => pattern.test(issue)), String(pattern))
  }
})

test('Worker env is built only from configuration: no cloud defaults, no Platform binding, no Cloudflare token alias', () => {
  const raw = rawConfig({
    publicHost: 'new-site.selfhosted-fixture.test',
    apps: {
      console: { origin: 'http://127.0.0.1:3000', deploymentCode: 'T900001-sh-console' },
      enterprise: { origin: 'http://127.0.0.1:3100', deploymentCode: 'T900001-sh-enterprise' },
      workflow: { origin: 'http://127.0.0.1:3020', deploymentCode: 'T900001-sh-workflow' }
    }
  })
  raw.enterprise = { pilot: true }
  raw.platform.origin = 'https://platform.selfhosted-fixture.test'
  const config = validateConfig(raw)
  const created = []
  const env = buildWorkerEnv(config, { createBinding: origin => { created.push(origin); return { origin, fetch() {} } }, disabledBinding })

  assert.equal(env.HZY_TENANT_GATEWAY_REGISTRY_URL, 'https://platform.selfhosted-fixture.test/api/platform/internal/tenant-gateway/resolve')
  assert.equal(env.HZY_PLATFORM_SERVICE, undefined)
  assert.equal(env.HZY_CLOUDFLARE_INTERNAL_TOKEN, undefined)
  assert.equal(env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN, config.secrets.gatewayInternalToken)
  assert.equal(env.HZY_PLATFORM_INTERNAL_TOKEN, config.secrets.platformRegistryToken)
  assert.equal(env.HZY_ALLOWED_TENANTS, 'T900001')
  assert.equal(env.HZY_DEFAULT_TENANT, 'T900001')
  assert.equal(env.HZY_POLICY_SYNC_HOSTS, 'new-site.selfhosted-fixture.test')
  assert.deepEqual(JSON.parse(env.HZY_ENTERPRISE_HOST_ALLOWLIST_JSON), [{
    host: 'new-site.selfhosted-fixture.test', tenantCode: 'T900001', environment: 'selfhosted', deploymentCode: 'T900001-sh-enterprise'
  }])
  assert.deepEqual(JSON.parse(env.HZY_TENANT_GATEWAY_EXPECTED_BINDINGS_JSON), {
    'new-site.selfhosted-fixture.test': {
      tenantCode: 'T900001',
      environment: 'selfhosted',
      apps: { console: 'T900001-sh-console', enterprise: 'T900001-sh-enterprise', workflow: 'T900001-sh-workflow' },
      dataRuntime: { endpoint: 'https://runtime.selfhosted-fixture.test', runtimeCode: 't900001-selfhosted-runtime' }
    }
  })
  // Every origin is either a configured loopback origin or the disabled sentinel.
  for (const [name, value] of Object.entries(env)) {
    if (!name.endsWith('_ORIGIN')) continue
    assert.match(value, /^(?:http:\/\/127\.0\.0\.1:\d+|https:\/\/disabled\.invalid)$/, name)
  }
  assert.equal(env.HZY_FINANCE_SERVICE, disabledBinding)
  assert.deepEqual(created.sort(), ['http://127.0.0.1:3000', 'http://127.0.0.1:3020', 'http://127.0.0.1:3100'])
  // Nothing managed-cloud or tenant-specific is hardcoded into the env.
  const text = JSON.stringify(Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === 'string')))
  for (const forbidden of ['wiztek.huizhi.yun', 'C000001', 'workers.dev', 'isme.dev', 'hzy-test', 'console.huizhi.yun']) {
    assert.equal(text.includes(forbidden), false, forbidden)
  }
})

test('example config routes /codocs/ws and /collab/* to a loopback-only standalone Collab', async () => {
  const example = JSON.parse(await readFile(new URL('../gateway.config.example.json', import.meta.url), 'utf8'))
  assert.deepEqual(example.apps.collab, { origin: 'http://127.0.0.1:31007', deploymentCode: 'REPLACE_TENANT_CODE-collab' })
  assert.throws(() => validateConfig(rawConfig({ apps: { console: { origin: example.apps.console.origin, deploymentCode: 'T900001-sh-console' }, collab: example.apps.collab } })), ConfigError)
  // Filled with fixture values the example becomes a valid config; Collab carries its registered deployment code.
  const filled = rawConfig({ apps: {
    console: { origin: example.apps.console.origin, deploymentCode: 'T900001-sh-console' },
    collab: { origin: example.apps.collab.origin, deploymentCode: 'T900001-collab' }
  } })
  const config = validateConfig(filled)
  assert.equal(config.apps.collab.origin, 'http://127.0.0.1:31007')
  assert.equal(config.apps.collab.deploymentCode, 'T900001-collab')
  // The registry pin includes the registered Collab deployment, so a registry answer that drifts fails closed.
  assert.equal(expectedBinding(config).apps.collab, 'T900001-collab')
  for (const drifted of ['T900001-sh-collab', 'T900002-collab', 'T900001-collab2']) {
    const raw = rawConfig({ apps: { console: filled.apps.console, collab: { origin: filled.apps.collab.origin, deploymentCode: drifted } } })
    assert.throws(() => validateConfig(raw), error => error instanceof ConfigError && error.issues.some(issue => /apps\.collab\.deploymentCode/.test(issue)), drifted)
  }
  // Omitting it stays valid (collab not pinned), preserving pre-registration configs.
  assert.equal(validateConfig(rawConfig({ apps: { console: filled.apps.console, collab: { origin: filled.apps.collab.origin } } })).apps.collab.deploymentCode, '')
  // Collab is dialled by origin only: no Service Binding is created for it.
  const created = []
  const env = buildWorkerEnv(config, { createBinding: origin => { created.push(origin); return { origin, fetch() {} } }, disabledBinding })
  assert.equal(env.HZY_COLLAB_ORIGIN, 'http://127.0.0.1:31007')
  assert.ok(!created.includes(config.apps.collab.origin))
  for (const origin of ['http://10.0.0.5:31007', 'http://localhost:31007', 'https://collab.example.test', 'http://127.0.0.1:31007/codocs']) {
    const raw = rawConfig({ apps: { console: filled.apps.console, collab: { origin } } })
    assert.throws(() => validateConfig(raw), error => error instanceof ConfigError && error.issues.some(issue => /apps\.collab\.origin/.test(issue)), origin)
  }
  const duplicate = rawConfig({ apps: { console: filled.apps.console, collab: { origin: filled.apps.console.origin } } })
  assert.throws(() => validateConfig(duplicate), error => error instanceof ConfigError && error.issues.some(issue => /duplicates/.test(issue)))
})

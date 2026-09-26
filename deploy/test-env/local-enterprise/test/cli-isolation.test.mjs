import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, writeFile, mkdtemp, mkdir, chmod, rm, rename, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve('deploy/test-env')
const example = JSON.parse(await readFile(join(root, 'local-enterprise/profile.example.json'), 'utf8'))

function validProfile(dir) {
  const profile = structuredClone(example)
  profile.runtime.expectedTenant = 'C000001'
  profile.runtime.expectedRuntimeCode = 'c000001-test-tenant-runtime'
  profile.runtime.expectedRuntimeDeployment = 'c000001-test-tenant-runtime'
  Object.assign(profile.identity, {
    decisionStatus: 'APPROVED_EXISTING_CANONICAL_CONSOLE',
    canonicalIssuer: 'https://hzy-test.huizhi.yun',
    canonicalJwksUri: 'https://hzy-test.huizhi.yun/.well-known/jwks.json',
    enterpriseDeployment: 'C000001-test-enterprise',
    enterpriseOidcClientId: 'enterprise',
    enterpriseServiceClientId: 'enterprise.runtime',
    consoleDeployment: 'wiztek-test-console',
    credentialProviderRef: 'macos-keychain:hzy0'
  })
  profile.security.outerAccessProtectionVerified = true
  profile.security.gatewayCredentialRef = 'macos-keychain:hzy0-gateway'
  profile.processManagement.pm2Home = join(dir, 'hzy0/pm2')
  return profile
}

test('CLI rejects unsafe profile variants before invoking PM2', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hzy0-cli-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const bin = join(dir, 'bin')
  await mkdir(bin)
  const marker = join(dir, 'pm2-called')
  await writeFile(join(bin, 'pm2'), `#!/bin/sh\ntouch '${marker}'\nexit 0\n`, { mode: 0o700 })
  const cases = [
    ['unknown', p => { p.unrecognized = true }, 'profile.unrecognized is not allowed'],
    ['empty-identity', p => { p.identity.enterpriseServiceClientId = '' }, 'identity.enterpriseServiceClientId is required'],
    ['production', p => { p.environment = 'prod' }, 'environment must be test'],
    ['duplicate-port', p => { p.listeners.gatewayIngress.port = p.listeners.enterprise.port }, 'listener ports must be unique'],
    ['private-port', p => { p.listeners.gatewayInternal.port = 23421 }, 'gatewayInternal.port must be 23121']
  ]
  for (const [name, change, expected] of cases) {
    const profile = validProfile(dir)
    change(profile)
    const path = join(dir, `${name}.json`)
    await writeFile(path, JSON.stringify(profile), { mode: 0o600 })
    for (const command of ['plan', 'doctor', 'up', 'restart', 'down', 'status']) {
      const result = spawnSync(process.execPath, [join(root, 'local-enterprise.mjs'), command, '--profile', path, '--mode', 'dev'], {
        cwd: resolve('.'), encoding: 'utf8', timeout: 10000,
        env: { HOME: dir, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir }
      })
      assert.equal(result.status, command === 'plan' ? 0 : 1, `${name}/${command}`)
      if (['plan', 'doctor'].includes(command)) {
        const parsed = JSON.parse(result.stdout)
        assert.ok((command === 'plan' ? parsed.blockers : parsed.validationIssues).some(issue => issue.includes(expected)), `${name}/${command}`)
      } else {
        assert.match(result.stderr, /Profile is not approved/)
        assert.ok(result.stderr.includes(expected), `${name}/${command}`)
      }
    }
  }
  await assert.rejects(readFile(marker), { code: 'ENOENT' })
})

test('runner excludes inherited DB and master-key variables and pins bypass off', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hzy0-env-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const bin = join(dir, 'bin')
  await mkdir(bin)
  const profilePath = join(dir, 'profile.json')
  await writeFile(profilePath, JSON.stringify(validProfile(dir)), { mode: 0o600 })
  // Synthetic legacy file is deliberately outside the repository.
  await writeFile(join(dir, '.env.dev'), 'DB_HOST=fixture.invalid\nHZY_CONSOLE_VAULT_MASTER_KEY=fixture\nHZY_DEV_RUNTIME_BYPASS=true\n', { mode: 0o600 })
  const probe = `#!/usr/bin/env node
const keys = Object.keys(process.env)
console.log(JSON.stringify({
  dotenvDisabled: process.argv.includes('/dev/null'),
  dbKeys: keys.filter(key => key.startsWith('DB_')),
  masterKeyPresent: keys.includes('HZY_CONSOLE_VAULT_MASTER_KEY'),
  bypassOff: ['HZY_LOCAL_DEV_RUNTIME_BYPASS', 'HZY_DEV_RUNTIME_BYPASS', 'HZY_CONSOLE_DEV_POLICY_BYPASS', 'CONSOLE_DEV_POLICY_BYPASS'].every(key => process.env[key] === 'false')
}))
`
  await writeFile(join(bin, 'pnpm'), probe, { mode: 0o700 })
  await chmod(bin, 0o700)
  const result = spawnSync(process.execPath, [join(root, 'local-enterprise/run-process.mjs'), '--app', 'enterprise', '--profile', profilePath, '--mode', 'dev'], {
    cwd: dir, encoding: 'utf8', timeout: 10000,
    env: { HOME: dir, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir,
      DB_HOST: 'fixture.invalid', DB_PASSWORD: 'fixture', HZY_CONSOLE_VAULT_MASTER_KEY: 'fixture',
      HZY_LOCAL_DEV_RUNTIME_BYPASS: 'true', HZY_DEV_RUNTIME_BYPASS: 'true',
      HZY_CONSOLE_DEV_POLICY_BYPASS: 'true', CONSOLE_DEV_POLICY_BYPASS: 'true' }
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    dotenvDisabled: true, dbKeys: [], masterKeyPresent: false, bypassOff: true
  })
})

test('Collab runner requires an owner-only provider and passes only dedicated service material', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hzy0-collab-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const bin = join(dir, 'bin')
  await mkdir(bin)
  const profile = validProfile(dir)
  profile.identity.consoleFacadeMode = 'local-canonical-facade'
  profile.identity.credentialProviderRef = 'protected-file:test-gateway'
  profile.features = { codocsSnapshotV2: true, codocsCollaborationV2: true }
  profile.listeners.collab = { host: '127.0.0.1', port: 23131 }
  const profilePath = join(dir, 'profile.json')
  await writeFile(profilePath, JSON.stringify(profile), { mode: 0o600 })
  // One owner-only file: the collab.runtime client secret. No storage keys.
  const clientSecretPath = join(dir, 'collab-client-secret.json')
  await writeFile(clientSecretPath, JSON.stringify({ COLLAB_SERVICE_CLIENT_SECRET: 'fixture' }), { mode: 0o644 })
  const stub = `#!/usr/bin/env node
console.log(JSON.stringify({
  client: process.env.COLLAB_SERVICE_CLIENT_ID,
  v2: process.env.COLLAB_V2_ENABLED,
  loopback: process.env.COLLAB_ADDRESS === '127.0.0.1' && process.env.COLLAB_PORT === '23131',
  tokenEndpoint: process.env.COLLAB_CONSOLE_TOKEN_URL,
  dotenvDisabled: process.env.DOTENV_CONFIG_PATH === '/dev/null',
  serviceMaterialPresent: Boolean(process.env.COLLAB_SERVICE_CLIENT_SECRET),
  storageMaterialPresent: Object.keys(process.env).some(key => /^(COLLAB_OSS_|ALIYUN_OSS_)/.test(key)),
  gatewayMaterialPresent: Boolean(process.env.HZY0_GATEWAY_INTERNAL_TOKEN || process.env.HZY_CLOUDFLARE_INTERNAL_TOKEN),
  unrelatedMaterialPresent: Boolean(process.env.DB_HOST || process.env.HZY_CONSOLE_VAULT_MASTER_KEY)
}))
`
  await writeFile(join(bin, 'pnpm'), stub, { mode: 0o700 })
  const plan = spawnSync(process.execPath, [join(root, 'local-enterprise.mjs'), 'plan', '--profile', profilePath], {
    cwd: dir, encoding: 'utf8', timeout: 10000,
    env: { HOME: dir, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir }
  })
  assert.equal(plan.status, 0)
  assert.ok(JSON.parse(plan.stdout).blockers.includes('Collab credential provider is unavailable or unsafe'))
  assert.doesNotMatch(plan.stdout, /fixture/)
  const run = () => spawnSync(process.execPath, [join(root, 'local-enterprise/run-process.mjs'), '--app', 'collab', '--profile', profilePath, '--mode', 'dev'], {
    cwd: dir, encoding: 'utf8', timeout: 10000,
    env: { HOME: dir, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir,
      HZY0_GATEWAY_INTERNAL_TOKEN: 'fixture', DB_HOST: 'fixture', HZY_CONSOLE_VAULT_MASTER_KEY: 'fixture',
      COLLAB_OSS_ACCESS_KEY_SECRET: 'fixture', ALIYUN_OSS_ACCESS_KEY_SECRET: 'fixture' }
  })
  let result = run()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Collab credential provider is unavailable or unsafe/)
  assert.doesNotMatch(result.stderr, /fixture/)
  await chmod(clientSecretPath, 0o600)
  const readyPlan = spawnSync(process.execPath, [join(root, 'local-enterprise.mjs'), 'plan', '--profile', profilePath], {
    cwd: dir, encoding: 'utf8', timeout: 10000, env: { HOME: dir, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir }
  })
  assert.ok(!JSON.parse(readyPlan.stdout).blockers.includes('Collab credential provider is unavailable or unsafe'))
  result = run()
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), {
    client: 'collab.runtime', v2: 'true', loopback: true,
    tokenEndpoint: 'http://127.0.0.1:23120/__hzy0/collab-token',
    dotenvDisabled: true, serviceMaterialPresent: true, storageMaterialPresent: false,
    gatewayMaterialPresent: false, unrelatedMaterialPresent: false
  })
  // Storage keys are not accepted in the file either.
  await writeFile(clientSecretPath, JSON.stringify({ COLLAB_SERVICE_CLIENT_SECRET: 'fixture', COLLAB_OSS_ACCESS_KEY_SECRET: 'fixture' }), { mode: 0o600 })
  assert.match(run().stderr, /Collab credential provider is unavailable or unsafe/)
  await writeFile(clientSecretPath, JSON.stringify({ COLLAB_SERVICE_CLIENT_SECRET: 'fixture' }), { mode: 0o600 })
  await rename(clientSecretPath, join(dir, 'collab-client-secret-real.json'))
  await symlink(join(dir, 'collab-client-secret-real.json'), clientSecretPath)
  assert.match(run().stderr, /Collab credential provider is unavailable or unsafe/)
  const ecosystem = spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(join(root, 'local-enterprise/pm2.config.cjs'))}).apps.map(app => app.name)))`], {
    cwd: dir, encoding: 'utf8', timeout: 10000,
    env: { HOME: dir, PATH: `${bin}:${process.env.PATH}`,
      HZY0_REPO_ROOT: resolve(root, '../..'), HZY0_PROFILE_FILE: profilePath,
      HZY0_NODE_BIN: process.execPath, HZY0_MODE: 'dev' }
  })
  assert.equal(ecosystem.status, 0)
  assert.deepEqual(JSON.parse(ecosystem.stdout), [
    'hzy0-gateway', 'hzy0-enterprise', 'hzy0-codocs-editor', 'hzy0-console', 'hzy0-collab'
  ])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createManifest, publishDirectory, verifyManifest } from '../release-lib.mjs'
import { publishIndex } from '../release.mjs'
import { sha256File } from '../release-lib.mjs'

const base = dirname(dirname(fileURLToPath(import.meta.url)))
const commit = 'a'.repeat(40)
const exec = promisify(execFile)
async function fixture(t, version = 'v1') {
  const root = await mkdtemp(join(tmpdir(), 'hzy-g4-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const staged = join(root, 'stage')
  await mkdir(join(staged, '.output/server'), { recursive: true })
  await writeFile(join(staged, '.output/server/index.mjs'), 'export default 1\n')
  const manifest = await createManifest(staged, { app: 'console', version, commit, nodeVersion: 'v24.18.0' })
  await writeFile(join(staged, 'manifest.json'), JSON.stringify(manifest))
  return { root, staged }
}

test('tampered payload and manifest reject publication before current changes', async t => {
  const { root, staged } = await fixture(t)
  await writeFile(join(staged, '.output/server/index.mjs'), 'tampered')
  await assert.rejects(publishDirectory({ root, app: 'console', version: 'v1', staged, restart: async () => {}, health: async () => {} }), /hash mismatch/)
  await assert.rejects(readlink(join(root, 'console/current')), { code: 'ENOENT' })
})

test('artifact for a different operating system is rejected', async t => {
  const { staged } = await fixture(t)
  const path = join(staged, 'manifest.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  manifest.os = process.platform === 'darwin' ? 'linux' : 'darwin'
  await writeFile(path, JSON.stringify(manifest))
  await assert.rejects(verifyManifest(staged), /OS\/architecture mismatch/)
})

test('switch and failed health restore exact previous symlink', async t => {
  const { root, staged } = await fixture(t)
  let restarts = 0
  await publishDirectory({ root, app: 'console', version: 'v1', staged, restart: async () => { restarts++ }, health: async () => {} })
  assert.equal(await readlink(join(root, 'console/current')), 'releases/v1')
  const staged2 = join(root, 'second')
  await mkdir(join(staged2, '.output/server'), { recursive: true })
  await writeFile(join(staged2, '.output/server/index.mjs'), 'export default 2\n')
  await writeFile(join(staged2, 'manifest.json'), JSON.stringify(await createManifest(staged2, { app: 'console', version: 'v2', commit, nodeVersion: 'v24.18.0' })))
  await assert.rejects(publishDirectory({ root, app: 'console', version: 'v2', staged: staged2, restart: async () => { restarts++ }, health: async () => { throw Error('unhealthy') } }), /unhealthy/)
  assert.equal(await readlink(join(root, 'console/current')), 'releases/v1')
  assert.equal(restarts, 3)
  await verifyManifest(join(root, 'console/current'), { app: 'console', version: 'v1' })
})

test('archive publisher checks hash then switches without a real service', async t => {
  const { root, staged } = await fixture(t)
  const archive = join(root, 'console-v1.tar.gz')
  await exec('tar', ['-czf', archive, '-C', staged, '.'])
  const { size } = await import('node:fs/promises').then(fs => fs.stat(archive))
  const index = { schema: 'hzy-self-hosted-build.v1', version: 'v1', commit, nodeVersion: 'v24.18.0', os: process.platform, arch: process.arch,
    packages: [{ app: 'console', archive: 'console-v1.tar.gz', sha256: await sha256File(archive), bytes: size }] }
  const indexPath = join(root, 'index.json')
  await writeFile(indexPath, JSON.stringify(index))
  const destination = join(root, 'published')
  await publishIndex({ indexPath, root: destination, restart: async () => {}, health: async () => {} })
  assert.equal(await readlink(join(destination, 'console/current')), 'releases/v1')
  index.packages[0].sha256 = '0'.repeat(64)
  await writeFile(indexPath, JSON.stringify(index))
  await assert.rejects(publishIndex({ indexPath, root: join(root, 'bad'), restart: async () => {}, health: async () => {} }), /archive hash mismatch/)
})

test('every process has a constrained env template and matching unit', async () => {
  const common = ['HZY_PLATFORM_ENVIRONMENT', 'HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON', 'HZY_SELF_HOSTED_RUNTIME_ENDPOINT', 'HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN', 'HZY_TENANT_GATEWAY_INTERNAL_TOKEN']
  for (const app of ['console', 'enterprise', 'workflow', 'aims', 'codocs', 'platform']) {
    const env = await readFile(join(base, 'env', `${app}.env.example`), 'utf8')
    const unit = await readFile(join(base, 'systemd', `hzy-${app}.service`), 'utf8')
    assert.match(env, /^HOST=127\.0\.0\.1$/m)
    assert.match(unit, new RegExp(`EnvironmentFile=/etc/hzy/${app}\\.env`))
    assert.match(unit, /User=hzy-/)
    assert.match(unit, /Restart=on-failure/)
    if (app !== 'platform') {
      for (const key of common) assert.match(env, new RegExp(`^${key}=`, 'm'), `${app} missing ${key}`)
      assert.doesNotMatch(env, /^(DB_|VAULT_MASTER|OIDC_SIGNING_PRIVATE)/m)
    }
  }
  const enterprise = await readFile(join(base, 'env/enterprise.env.example'), 'utf8')
  for (const key of ['HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED', 'HZY_ENTERPRISE_WORKFLOW_ORIGIN', 'HZY_ENTERPRISE_VERIFIED_POLICY_ENABLED', 'HZY_ENTERPRISE_OIDC_REDIRECT_URI']) assert.match(enterprise, new RegExp(`^${key}=`, 'm'))
  const aims = await readFile(join(base, 'env/aims.env.example'), 'utf8')
  assert.match(aims, /^HZY_CODOCS_TARGET_DEPLOYMENT=REPLACE_CODOCS_DEPLOYMENT_CODE$/m)
  assert.match(aims, /^HZY_CODOCS_SERVICE_BASE_URL=http:\/\/127\.0\.0\.1:31005\/codocs$/m)
  const codocs = await readFile(join(base, 'env/codocs.env.example'), 'utf8')
  assert.match(codocs, /oss\.default from Console integration-config\/vault/)
  assert.match(codocs, /console to http:\/\/127\.0\.0\.1:31001/)
  assert.doesNotMatch(codocs, /^ALIYUN_OSS_/m)
  const gateway = await readFile(join(base, 'env/gateway.env.example'), 'utf8')
  assert.match(gateway, /^HZY_GATEWAY_CONFIG=\/etc\/hzy-gateway\/gateway\.json$/m)
})

test('self-hosted Codocs introspection uses the fixed Console loopback without a Cloudflare binding', async () => {
  const codocs = await readFile(join(base, 'env/codocs.env.example'), 'utf8')
  const readme = await readFile(join(base, 'README.md'), 'utf8')
  const binding = await readFile(join(base, '../../foundation/server/utils/consoleServiceBinding.ts'), 'utf8')
  assert.match(codocs, /^HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON=/m)
  assert.match(readme, /"console":"http:\/\/127\.0\.0\.1:31001"/)
  assert.match(binding, /return selfHostedServiceBinding\('console'\)/)
  assert.doesNotMatch(codocs, /HZY_CONSOLE_SERVICE=/)
})

test('Runtime config variable matches source and systemd drop-in', async () => {
  const runtime = await readFile(join(base, 'env/runtime.env.example'), 'utf8')
  const unit = await readFile(join(base, 'systemd/hzy-data-runtime.override.conf.example'), 'utf8')
  const source = await readFile(join(base, '../../data-runtime/internal/config/config.go'), 'utf8')
  assert.match(source, /os\.Getenv\("HZY_DATA_RUNTIME_CONFIG"\)/)
  assert.match(runtime, /^HZY_DATA_RUNTIME_CONFIG=\/etc\/hzy-data-runtime\/config\.json$/m)
  assert.doesNotMatch(runtime, /HZY_RUNTIME_CONFIG_FILE/)
  assert.match(unit, /EnvironmentFile=\/etc\/hzy\/runtime\.env/)
  assert.match(unit, /After=mysqld\.service/)
})

test('WeCom egress proxy example is tailnet-only, path-allowlisted, verified and secret-free in logs', async () => {
  const proxy = await readFile(join(base, 'platform-ingress/wecom-egress-proxy.nginx.conf.example'), 'utf8')
  const env = await readFile(join(base, 'env/platform.env.example'), 'utf8')
  const code = proxy.split('\n').filter(line => !line.trim().startsWith('#')).join('\n')
  assert.match(code, /listen 100\.98\.120\.65:8790;/)
  assert.match(code, /allow 100\.64\.72\.59;\s*deny all;/)
  assert.match(code, /location \/ \{ return 404; \}/)
  assert.match(code, /\^\/cgi-bin\/\(gettoken\|auth\/getuserinfo\|user\/get\)\$/)
  assert.match(code, /proxy_pass https:\/\/qyapi\.weixin\.qq\.com;/)
  for (const directive of ['proxy_ssl_server_name on;', 'proxy_ssl_name qyapi.weixin.qq.com;', 'proxy_ssl_verify on;', 'proxy_set_header Host qyapi.weixin.qq.com;']) assert.ok(code.includes(directive), directive)
  const logFormat = /log_format wecom_egress ([^;]+);/.exec(code)?.[1] || ''
  assert.ok(logFormat.includes('$uri'))
  assert.doesNotMatch(logFormat, /\$request\b|\$request_uri|\$args|\$query_string|\$http_/)
  assert.match(code, /error_log \S+ crit;/)
  assert.match(env, /^#NUXT_AUTH_WECOM_API_BASE=http:\/\/100\.98\.120\.65:8790$/m)
  assert.doesNotMatch(env, /^NUXT_AUTH_WECOM_API_BASE=/m)
})

test('Platform runtime-only credentials and isolated Tailscale ingress are fixed', async () => {
  const env = await readFile(join(base, 'env/platform.env.example'), 'utf8')
  const unit = await readFile(join(base, 'systemd/hzy-platform.service'), 'utf8')
  const signing = await readFile(join(base, '../../platform/server/utils/platformSigning.ts'), 'utf8')
  const access = await readFile(join(base, '../../platform/server/middleware/platform-access.ts'), 'utf8')
  const ingress = await readFile(join(base, 'platform-ingress/nginx.conf.example'), 'utf8')
  const readme = await readFile(join(base, 'README.md'), 'utf8')
  for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) assert.match(env, new RegExp(`^NUXT_DB_${key}=`, 'm'))
  assert.doesNotMatch(env, /^DB_[A-Z_]+=/m)
  assert.match(signing, /'HZY_PLATFORM_SIGNING_PRIVATE_KEY'/)
  assert.match(env, /^HZY_PLATFORM_SIGNING_PRIVATE_KEY=\/etc\/hzy\/platform-signing\//m)
  assert.match(access, /'PLATFORM_INTERNAL_SERVICE_TOKENS'/)
  assert.match(env, /^PLATFORM_INTERNAL_SERVICE_TOKENS=/m)
  assert.match(env, /^NUXT_SECURITY_OPS_UIDS=/m)
  assert.doesNotMatch(unit, /Requires=hzy-data-runtime\.service/)
  assert.match(ingress, /listen 100\.64\.72\.59:8782/)
  assert.match(ingress, /allow 100\.98\.120\.65;/)
  assert.match(ingress, /deny all;/)
  assert.match(ingress, /map \$http_x_real_ip \$platform_gitlab_audit_ip \{[\s\S]*?default \$http_x_real_ip;[\s\S]*?"" \$remote_addr;/)
  assert.match(ingress, /map \$remote_addr \$platform_audit_ip \{[\s\S]*?default \$remote_addr;[\s\S]*?100\.98\.120\.65 \$platform_gitlab_audit_ip;/)
  assert.match(ingress, /proxy_set_header X-Real-IP \$platform_audit_ip;/)
  assert.match(ingress, /proxy_set_header X-Forwarded-For \$platform_audit_ip;/)
  assert.doesNotMatch(ingress, /proxy_set_header X-Real-IP \$http_x_real_ip;/)
  assert.match(ingress, /proxy_pass http:\/\/127\.0\.0\.1:31006;/)
  for (const setting of ['lower_case_table_names=1', 'character_set_server=utf8mb4', 'collation_server=utf8mb4_unicode_ci']) assert.ok(readme.includes(setting))
  assert.match(readme, /首次初始化 datadir 前/)
})

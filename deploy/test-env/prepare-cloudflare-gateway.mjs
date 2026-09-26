// Capture test credentials without printing them; generated files are ignored and mode 0600.
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { root } from './worker-config.mjs'
import { stateDir, origin } from './cloudflare-config.mjs'
import { resolveLocalLogin } from './local-login.mjs'
import {
  TEST_INTEGRATION_DRAIN_CRON,
  TEST_POLICY_SYNC_CRON
} from './cloudflare-gateway.mjs'

try {
  const data = JSON.parse(execFileSync('ssh', ['-o', 'BatchMode=yes', 'root@gitlab.wiztek.cn',
    'node /wiztek/hzy-test/local-context.mjs --workers'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  if (data.tenant !== 'C000001' || data.platformUrl !== 'https://hzy.wiztek.cn' || data.issuer !== origin) throw Error('Test identity mismatch')
  const login = resolveLocalLogin(parseEnv(readFileSync(resolve(root, 'console/.env.dev'), 'utf8')))
  const keyFile = resolve(stateDir, 'gateway-key')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' })
  const common = { HZY_TENANT_GATEWAY_INTERNAL_TOKEN: readFileSync(keyFile, 'utf8') }
  const registry = { domains: { [new URL(origin).hostname]: {
    tenantCode: 'C000001', deploymentCode: 'wiztek-test-console', environment: 'test',
    dataRuntime: { endpoint: 'https://hzy-test-runtime.isme.dev', runtimeCode: 'c000001-test-tenant-runtime', audience: 'data-runtime' },
    apps: Object.fromEntries(['console', 'aims', 'assets', 'finance', 'codocs'].map(app => [app,
      { deploymentCode: app === 'console' ? 'wiztek-test-console' : `C000001-test-${app}` }])),
    login: { mode: 'oidc', enabledProviders: ['oidc'], oidc: login },
  } } }
  const secrets = {
    console: { ...common, HZY_CONSOLE_PLATFORM_SERVICE_TOKEN: data.platformToken,
      HZY_PLATFORM_SIGNING_KID: data.signingKid, HZY_PLATFORM_SIGNING_PUBKEY: data.signingPubkey,
      SSO_OIDC_ENABLE: 'true', SSO_OIDC_ISSUER: login.issuer, SSO_OIDC_CLIENT_ID: login.clientId,
      SSO_OIDC_CLIENT_SECRET: login.clientSecret, SSO_OIDC_REDIRECT_URI: `${origin}/api/auth/oidc-callback` },
    aims: common,
    assets: common,
    finance: common,
    codocs: common,
    gateway: { ...common, HZY_PLATFORM_INTERNAL_TOKEN: data.platformToken, HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify(registry) },
  }
  for (const [app, values] of Object.entries(secrets)) {
    mkdirSync(resolve(stateDir, app), { recursive: true, mode: 0o700 })
    writeFileSync(resolve(stateDir, app, 'secrets.json'), JSON.stringify(values), { mode: 0o600 })
  }
  const config = {
    name: 'hzy-test-gateway', main: '../../cloudflare-gateway.mjs',
    compatibility_date: '2026-05-23', compatibility_flags: ['nodejs_compat'], workers_dev: false,
    // Cloudflare cron is UTC: policy sync runs at 00:00 Asia/Shanghai. The
    // independent five-minute trigger only wakes registered integration drains.
    triggers: { crons: [TEST_POLICY_SYNC_CRON, TEST_INTEGRATION_DRAIN_CRON] },
    routes: [{ pattern: new URL(origin).hostname, custom_domain: true },
      { pattern: `${new URL(origin).hostname}/*`, zone_name: 'huizhi.yun' }],
    services: ['console', 'aims', 'assets', 'finance', 'codocs'].map(app => ({ binding: `HZY_${app.toUpperCase()}_SERVICE`, service: `hzy-test-${app}` })),
    vars: { HZY_ALLOWED_TENANTS: 'C000001', HZY_TENANT_DOMAIN_SUFFIX: 'huizhi.yun', HZY_POLICY_SYNC_HOSTS: new URL(origin).hostname,
      HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://hzy.wiztek.cn/api/platform/internal/tenant-gateway/resolve',
      HZY_CONSOLE_ORIGIN: 'https://console.test.invalid', HZY_AIMS_ORIGIN: 'https://aims.test.invalid',
      HZY_ASSETS_ORIGIN: 'https://assets.test.invalid', HZY_FINANCE_ORIGIN: 'https://finance.test.invalid',
      HZY_CODOCS_ORIGIN: 'https://codocs.test.invalid' },
  }
  writeFileSync(resolve(stateDir, 'gateway/wrangler.json'), JSON.stringify(config, null, 2), { mode: 0o600 })
  console.log('Protected test Gateway configuration and secrets prepared; no values logged.')
} catch {
  console.error('Test Gateway preparation failed; credential-bearing diagnostics suppressed.')
  process.exitCode = 1
}

// Captures test-only context over SSH. Never log the captured JSON or secrets.
import { execFile } from 'node:child_process'
import { promisify, parseEnv } from 'node:util'
import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { stateDir, root, localOrigin } from './worker-config.mjs'
import { resolveLocalLogin } from './local-login.mjs'
import { validateHealth } from './local.mjs'

try {
  const health = await fetch('http://127.0.0.1:18080/runtime/health', { signal: AbortSignal.timeout(15000) }).then(r => r.json())
  validateHealth(health)
  const { stdout } = await promisify(execFile)('ssh', ['-o', 'BatchMode=yes', 'root@gitlab.wiztek.cn',
    'node /wiztek/hzy-test/local-context.mjs --workers'], { timeout: 30000, maxBuffer: 65536 })
  const data = JSON.parse(stdout)
  if (data.tenant !== 'C000001' || data.deployment !== 'c000001-test-tenant-runtime'
    || data.platformUrl !== 'https://hzy.wiztek.cn' || !data.platformToken || !data.signingPubkey) throw Error('Test binding')
  const login = resolveLocalLogin(parseEnv(await readFile(resolve(root, 'console/.env.dev'), 'utf8')))
  const gatewayToken = randomBytes(32).toString('base64url')
  const common = { HZY_TENANT_GATEWAY_INTERNAL_TOKEN: gatewayToken }
  const secrets = {
    gateway: { ...common, HZY_PLATFORM_INTERNAL_TOKEN: data.platformToken, HZY_LOCAL_LOGIN_JSON: JSON.stringify(login) },
    console: { ...common, HZY_CONSOLE_PLATFORM_SERVICE_TOKEN: data.platformToken,
      HZY_PLATFORM_SIGNING_KID: data.signingKid, HZY_PLATFORM_SIGNING_PUBKEY: data.signingPubkey,
      SSO_OIDC_ENABLE: 'true', SSO_OIDC_ISSUER: login.issuer, SSO_OIDC_CLIENT_ID: login.clientId,
      SSO_OIDC_CLIENT_SECRET: login.clientSecret, SSO_OIDC_REDIRECT_URI: `${localOrigin}/api/auth/oidc-callback` },
    people: common
  }
  for (const [app, values] of Object.entries(secrets)) {
    const dir = resolve(stateDir, app)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const file = resolve(dir, '.dev.vars')
    const content = Object.entries(values).map(([k, v]) => {
      if (typeof v !== 'string' || v.includes("'")) throw Error('Unsupported secret encoding')
      return `${k}='${v}'`
    }).join('\n') + '\n'
    // dotenv preserves backslash-escaped quotes; use literal quoted values,
    // especially for the JSON login payload, rather than JSON string encoding.
    await writeFile(file, content, { mode: 0o600 })
    await chmod(file, 0o600)
  }
  console.log('Test credentials provisioned in per-Worker protected files; People has no Platform credential.')
  console.log(`Runtime issuer aligned: ${data.issuer === localOrigin}`)
} catch {
  console.error('Local Worker provisioning failed; secret-bearing diagnostics suppressed.')
  process.exitCode = 1
}

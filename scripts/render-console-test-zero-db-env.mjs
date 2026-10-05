#!/usr/bin/env node
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

const FORBIDDEN_KEYS = new Set([
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_CONNECTION_LIMIT',
  'DB_NAME',
  'DB_SSL',
  'DB_SSL_CA',
  'DB_SSL_REJECT_UNAUTHORIZED',
  'HZY_CONSOLE_VAULT_MASTER_KEY',
  'CONSOLE_VAULT_MASTER_KEY',
  'CONSOLE_AUTH_SIGNING_PRIVATE_JWK'
])

const LEGACY_ALLOWLIST = new Set([
  'SSO_OIDC_ENABLE',
  'SSO_OIDC_PROVIDER_CODE',
  'SSO_OIDC_ISSUER',
  'SSO_OIDC_CLIENT_ID',
  'SSO_OIDC_CLIENT_SECRET',
  'SSO_OIDC_REDIRECT_URI',
  'SSO_OIDC_POST_LOGOUT_REDIRECT_URI',
  'SSO_OIDC_SCOPE',
  'CAS_ENABLE',
  'CAS_BASE_URL',
  'CAS_SERVICE_URL',
  'WECOM_CORPID',
  'WECOM_AGENTID',
  'HZY_CONSOLE_DIAGNOSTICS_TOKEN',
  'CONSOLE_AUTH_SIMULATION_SECRET',
  'HZY_SERVICE_CLIENT_AIMS_SECRET',
  'HZY_SERVICE_CLIENT_CODOCS_SECRET',
  'HZY_SERVICE_CLIENT_WORKFLOW_SECRET',
  'HZY_SERVICE_CLIENT_NOTIFICATION_RUNTIME_SECRET',
  'HZY_CONNECTOR_RUNTIME_RELEASE_PUBLIC_KEY_PEM_BASE64'
])

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      args[item.slice(2)] = true
      continue
    }
    args[item.slice(2)] = value
    index += 1
  }
  return args
}

function parseEnv(content) {
  const env = new Map()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const equalsIndex = line.indexOf('=')
    if (equalsIndex <= 0) continue
    const key = line.slice(0, equalsIndex).trim()
    let value = line.slice(equalsIndex + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value)
      } catch {
        throw new Error(`invalid double-quoted env value: ${key}`)
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    env.set(key, value)
  }
  return env
}

function quoteEnv(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const templatePath = resolve(String(args.template || ''))
  const activationPath = resolve(String(args.activation || ''))
  const legacyPath = resolve(String(args.legacy || ''))
  const outputPath = resolve(String(args.output || ''))
  if (!args.template || !args.activation || !args.legacy || !args.output || args.execute !== true) {
    throw new Error('usage: --template <path> --activation <path> --legacy <path> --output <path> --execute')
  }

  const template = parseEnv(await readFile(templatePath, 'utf8'))
  const activation = parseEnv(await readFile(activationPath, 'utf8'))
  const legacy = parseEnv(await readFile(legacyPath, 'utf8'))
  const output = new Map(template)

  for (const key of LEGACY_ALLOWLIST) {
    if (legacy.has(key)) output.set(key, legacy.get(key))
  }
  for (const [key, value] of activation) output.set(key, value)

  output.set('NODE_ENV', 'production')
  output.set('HZY_CONSOLE_PM2_NAME', 'hzy-console-test')
  output.set('HOST', '127.0.0.1')
  output.set('PORT', '3031')
  output.set('HZY_CONSOLE_RUN_MODE', 'test')
  output.set('HZY_CONSOLE_DATA_ACCESS_MODE', 'tenant-runtime')
  output.set('HZY_CONSOLE_TENANT_RUNTIME_URL', 'http://127.0.0.1:18083')
  output.set('HZY_TENANT_RUNTIME_AUDIENCE', 'data-runtime')
  output.set('HZY_PLATFORM_ENVIRONMENT', 'test')
  output.set('NUXT_PUBLIC_SITE_URL', 'https://hzy-test.wiztek.cn')
  output.set('HZY_DEPLOYMENT_PUBLIC_URL', 'https://hzy-test.wiztek.cn')
  output.set('SSO_OIDC_REDIRECT_URI', 'https://hzy-test.wiztek.cn/api/auth/oidc-callback')
  output.set('SSO_OIDC_POST_LOGOUT_REDIRECT_URI', 'https://hzy-test.wiztek.cn/api/auth/oidc-post-logout')
  output.set('NOTIFY_REDIRECT_TO', '')

  for (const key of FORBIDDEN_KEYS) output.delete(key)
  for (const key of output.keys()) {
    if (/^(DB_|DATABASE_URL$)/.test(key)) output.delete(key)
  }

  const lines = [...output.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${quoteEnv(value)}`)
  await writeFile(outputPath, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' })
  await chmod(outputPath, 0o600)

  console.info(`[console-test-env] keys=${output.size}`)
  console.info('[console-test-env] forbiddenKeys=absent')
  console.info('[console-test-env] dataAccessMode=tenant-runtime')
  console.info('[console-test-env] tenantRuntimeUrl=loopback-ssh-tunnel')
  console.info('[console-test-env] mode=0600')
}

main().catch((error) => {
  console.error(`[console-test-env] ${error.message}`)
  process.exitCode = 1
})

#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const DEFAULT_TARGETS = ['console', 'tenant-gateway']
const SECRET_NAME = 'HZY_CLOUDFLARE_INTERNAL_TOKEN'
const BUSINESS_APP_TARGETS = ['aims', 'altoc', 'assets', 'codocs', 'finance', 'workflow', 'webdev']

const TARGETS = {
  console: {
    label: 'Console Worker',
    type: 'wrangler',
    config: 'console/.wrangler.generated.jsonc',
    secrets: [SECRET_NAME],
    legacySecrets: ['HZY_CONSOLE_PLATFORM_SERVICE_TOKEN', 'HZY_TENANT_GATEWAY_INTERNAL_TOKEN']
  },
  'tenant-gateway': {
    label: 'Tenant Gateway Worker',
    type: 'wrangler',
    config: 'deploy/cloudflare/tenant-gateway/wrangler.jsonc',
    secrets: [SECRET_NAME],
    legacySecrets: ['HZY_PLATFORM_INTERNAL_TOKEN', 'HZY_TENANT_GATEWAY_INTERNAL_TOKEN']
  },
  'platform-worker': {
    label: 'Platform Worker',
    type: 'wrangler',
    config: 'platform/wrangler.jsonc',
    secrets: [SECRET_NAME],
    legacySecrets: ['PLATFORM_INTERNAL_SERVICE_TOKENS']
  }
}

for (const appCode of BUSINESS_APP_TARGETS) {
  TARGETS[appCode] = {
    label: `${appCode} Worker`,
    type: 'wrangler',
    config: `${appCode}/.wrangler.generated.jsonc`,
    secrets: [SECRET_NAME],
    legacySecrets: []
  }
}

function usage() {
  return `
Usage:
  pnpm run token:cloudflare-internal
  pnpm run token:cloudflare-internal -- --apply --token-env HZY_CLOUDFLARE_INTERNAL_TOKEN
  pnpm run token:cloudflare-internal -- --apply --write-token-file ~/.huizhi-yun/cloudflare-internal.token --platform-env-file platform/.env.prod
  pnpm run token:cloudflare-internal -- --apply --legacy-aliases --platform-env-file platform/.env.prod

Default mode is dry-run. The script never prints the full token unless --print-token is set.

Token source:
  --token-env <NAME>          Read token from an environment variable. Default name is HZY_CLOUDFLARE_INTERNAL_TOKEN.
  --token-file <PATH>         Read token from a file.
  --token <VALUE>             Read token from argv. Avoid this in shell history.
  no token source             Generate a new random token.

Targets:
  --target <LIST>             Comma-separated targets: console, tenant-gateway, platform-worker,
                              ${BUSINESS_APP_TARGETS.join(', ')}, business-apps, all.
                              Use "none" to skip Worker secrets. Default: ${DEFAULT_TARGETS.join(',')}.
  --platform-env-file <PATH>  Add/update HZY_CLOUDFLARE_INTERNAL_TOKEN in a PM2/Nginx Platform env file.
  --create-env-file           Allow creating --platform-env-file when it does not exist.
  --legacy-aliases            Also write legacy split variable names using the same token.

Execution:
  --apply                     Actually write secrets/files. Without it, only prints a plan.
  --print-token               Print the token after resolving/generating it.
  --write-token-file <PATH>   Save the resolved/generated token to a local file with mode 0600.
  --force                     Overwrite --write-token-file if it already exists.
`
}

function parseArgs(argv) {
  const args = {
    apply: false,
    createEnvFile: false,
    force: false,
    legacyAliases: false,
    printToken: false,
    targets: [...DEFAULT_TARGETS],
    tokenEnv: SECRET_NAME
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (item === '--apply') {
      args.apply = true
      continue
    }
    if (item === '--create-env-file') {
      args.createEnvFile = true
      continue
    }
    if (item === '--force') {
      args.force = true
      continue
    }
    if (item === '--legacy-aliases') {
      args.legacyAliases = true
      continue
    }
    if (item === '--print-token') {
      args.printToken = true
      continue
    }

    const optionWithValue = [
      '--platform-env-file',
      '--target',
      '--token',
      '--token-env',
      '--token-file',
      '--write-token-file'
    ]
    if (optionWithValue.includes(item)) {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        fail(`missing value for ${item}`)
      }
      const key = item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      args[key] = value
      index += 1
      continue
    }

    fail(`unknown option: ${item}`)
  }

  if (typeof args.target === 'string') {
    args.targets = args.target.split(',').map(value => value.trim()).filter(Boolean)
  }
  if (args.targets.length === 1 && args.targets[0] === 'none') {
    args.targets = []
  }
  if (args.targets.includes('all')) {
    args.targets = Object.keys(TARGETS)
  } else if (args.targets.includes('business-apps')) {
    args.targets = [
      ...args.targets.filter(target => target !== 'business-apps'),
      ...BUSINESS_APP_TARGETS
    ]
  }
  args.targets = [...new Set(args.targets)]

  for (const target of args.targets) {
    if (!TARGETS[target]) {
      fail(`unknown target "${target}". Valid targets: ${Object.keys(TARGETS).join(', ')}`)
    }
  }

  return args
}

function fail(message) {
  console.error(`[cloudflare-internal-token] ${message}`)
  process.exit(1)
}

function normalizeToken(value, source) {
  const token = String(value || '').trim()
  if (!token) return ''
  if (/[\r\n]/.test(token)) {
    fail(`${source} contains a newline; expected a single token value`)
  }
  return token
}

function resolveToken(args) {
  if (args.token) {
    return {
      token: normalizeToken(args.token, '--token'),
      source: '--token'
    }
  }

  if (args.tokenFile) {
    const path = resolve(args.tokenFile)
    if (!existsSync(path)) {
      fail(`token file does not exist: ${path}`)
    }
    return {
      token: normalizeToken(readFileSync(path, 'utf8'), `token file ${path}`),
      source: `file:${path}`
    }
  }

  const envValue = normalizeToken(process.env[args.tokenEnv], `env ${args.tokenEnv}`)
  if (envValue) {
    return {
      token: envValue,
      source: `env:${args.tokenEnv}`
    }
  }

  return {
    token: randomBytes(48).toString('base64'),
    source: 'generated'
  }
}

function tokenSummary(token) {
  return `length=${token.length}, last4=${token.slice(-4)}`
}

function wranglerSecretNames(target, args) {
  const config = TARGETS[target]
  return [
    ...config.secrets,
    ...(args.legacyAliases ? config.legacySecrets : [])
  ]
}

function runWranglerSecretPut(secretName, configPath, token, args) {
  const absoluteConfig = resolve(configPath)
  if (!existsSync(absoluteConfig)) {
    fail(`missing wrangler config for ${secretName}: ${absoluteConfig}`)
  }

  const command = [
    'pnpm',
    'dlx',
    'wrangler@4',
    'secret',
    'put',
    secretName,
    '--config',
    configPath
  ]

  if (!args.apply) {
    console.info(`[dry-run] ${command.join(' ')}`)
    return
  }

  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    input: token,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    fail(`wrangler secret put failed for ${secretName} (${configPath}):\n${result.stdout || ''}${result.stderr || ''}`)
  }

  const output = `${result.stdout || ''}${result.stderr || ''}`
    .split(/\r?\n/)
    .filter(line => line.trim())
    .filter(line => !line.includes(token))
    .join('\n')
  console.info(`[applied] ${secretName} -> ${configPath}`)
  if (output) console.info(output)
}

function quoteEnvValue(token) {
  if (/^[A-Za-z0-9+/=_:.-]+$/.test(token)) return token
  return JSON.stringify(token)
}

function upsertEnvLine(content, key, token) {
  const line = `${key}=${quoteEnvValue(token)}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  if (pattern.test(content)) {
    return content.replace(pattern, line)
  }

  const suffix = content.endsWith('\n') || !content ? '' : '\n'
  return `${content}${suffix}${line}\n`
}

function readEnvValue(content, key) {
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'))
  if (!match) return ''
  const value = match[1].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function upsertCsvEnvLine(content, key, token) {
  const current = readEnvValue(content, key)
  const items = current
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  if (!items.includes(token)) {
    items.push(token)
  }
  return upsertEnvLine(content, key, items.join(','))
}

function updatePlatformEnvFile(args, token) {
  if (!args.platformEnvFile) return

  const envPath = resolve(args.platformEnvFile)
  if (!existsSync(envPath) && !args.createEnvFile) {
    fail(`platform env file does not exist: ${envPath}. Use --create-env-file to create it.`)
  }

  const keys = [
    SECRET_NAME,
    ...(args.legacyAliases ? ['PLATFORM_INTERNAL_SERVICE_TOKENS'] : [])
  ]

  if (!args.apply) {
    for (const key of keys) {
      console.info(`[dry-run] upsert ${key}=<redacted> in ${envPath}`)
    }
    return
  }

  let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  content = upsertEnvLine(content, SECRET_NAME, token)
  if (args.legacyAliases) {
    content = upsertCsvEnvLine(content, 'PLATFORM_INTERNAL_SERVICE_TOKENS', token)
  }
  writeFileSync(envPath, content, 'utf8')
  console.info(`[applied] updated ${keys.join(', ')} in ${envPath}`)
}

function writeTokenFile(args, token) {
  if (!args.writeTokenFile) return

  const path = resolve(args.writeTokenFile)
  if (existsSync(path) && !args.force) {
    fail(`token output file already exists: ${path}. Use --force to overwrite.`)
  }

  if (!args.apply) {
    console.info(`[dry-run] write token file ${path} with mode 0600`)
    return
  }

  if (!existsSync(dirname(path))) {
    fail(`token output directory does not exist: ${dirname(path)}`)
  }
  writeFileSync(path, `${token}\n`, { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
  console.info(`[applied] wrote token file ${path} with mode 0600`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage())
    return
  }

  const { token, source } = resolveToken(args)
  if (!token) {
    fail('resolved token is empty')
  }
  if (
    args.apply
    && source === 'generated'
    && !args.writeTokenFile
    && !args.platformEnvFile
    && !args.printToken
  ) {
    fail('generated token would not be saved anywhere. Use --write-token-file, --platform-env-file, --print-token, or provide --token-env/--token-file.')
  }

  console.info(`[cloudflare-internal-token] mode=${args.apply ? 'apply' : 'dry-run'}`)
  console.info(`[cloudflare-internal-token] token source=${source}, ${tokenSummary(token)}`)
  console.info(`[cloudflare-internal-token] targets=${args.targets.join(', ')}`)
  if (args.legacyAliases) {
    console.info('[cloudflare-internal-token] legacy aliases enabled')
  }
  if (args.printToken) {
    console.info(token)
  }

  writeTokenFile(args, token)
  updatePlatformEnvFile(args, token)

  for (const target of args.targets) {
    const targetConfig = TARGETS[target]
    for (const secretName of wranglerSecretNames(target, args)) {
      runWranglerSecretPut(secretName, targetConfig.config, token, args)
    }
  }
}

main()

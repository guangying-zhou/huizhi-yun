#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const DEFAULT_FILES = {
  platformProd: 'platform/.env.prod.example',
  platformDev: 'platform/.env.dev.example'
}

const ARG_TO_FILE = {
  'platform-prod-env': 'platformProd',
  'platform-dev-env': 'platformDev'
}

function usage() {
  return `
Usage:
  pnpm run probe:platform-runtime -- --prod-url http://127.0.0.1:3010 --dev-url http://127.0.0.1:3011
  pnpm run probe:platform-runtime -- --prod-url https://platform.wiztek.cn --token-env PLATFORM_DIAGNOSTICS_TOKEN
  pnpm run probe:platform-runtime -- --prod-url https://platform.wiztek.cn --dev-url https://platform-dev.wiztek.cn \\
    --prod-token-env PLATFORM_PROD_DIAGNOSTICS_TOKEN --dev-token-env PLATFORM_DEV_DIAGNOSTICS_TOKEN

The Platform diagnostics endpoint only returns non-secret runtime fields. Use loopback URLs on the server, or configure HZY_PLATFORM_DIAGNOSTICS_TOKEN and pass per-target --prod-token-env / --dev-token-env. Shared --token/--token-env remains supported as a fallback.
`
}

function parseArgs(argv) {
  const args = {
    files: { ...DEFAULT_FILES },
    urls: {},
    token: '',
    tokens: {}
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') {
      continue
    }
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]

    if (['prod-url', 'dev-url'].includes(name)) {
      if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`)
      args.urls[name.slice(0, -4)] = value
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'token') {
      if (!value || value.startsWith('--')) throw new Error('missing value for --token')
      args.token = value
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'token-env') {
      if (!value || value.startsWith('--')) throw new Error('missing value for --token-env')
      args.token = String(process.env[value] || '').trim()
      if (!args.token) throw new Error(`environment variable is empty: ${value}`)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (['prod-token', 'dev-token'].includes(name)) {
      const target = name.slice(0, -'-token'.length)
      if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`)
      args.tokens[target] = value
      if (equalsIndex < 0) index += 1
      continue
    }

    if (['prod-token-env', 'dev-token-env'].includes(name)) {
      const target = name.slice(0, -'-token-env'.length)
      if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`)
      args.tokens[target] = String(process.env[value] || '').trim()
      if (!args.tokens[target]) throw new Error(`environment variable is empty: ${value}`)
      if (equalsIndex < 0) index += 1
      continue
    }

    const fileKey = ARG_TO_FILE[name]
    if (fileKey) {
      if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`)
      args.files[fileKey] = value
      if (equalsIndex < 0) index += 1
      continue
    }

    throw new Error(`unknown option: --${name}`)
  }

  return args
}

function unquote(value) {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseEnvFile(path) {
  const env = {}
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^export\s+/, '')
    if (!trimmed || trimmed.startsWith('#')) continue
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) continue
    env[trimmed.slice(0, equalsIndex).trim()] = unquote(trimmed.slice(equalsIndex + 1))
  }
  return env
}

function readEnvSet(files) {
  return Object.fromEntries(
    Object.entries(files).map(([key, file]) => {
      const path = resolve(process.cwd(), file)
      if (!existsSync(path)) {
        throw new Error(`env file not found: ${file}`)
      }
      return [key, parseEnvFile(path)]
    })
  )
}

function envValue(env, ...keys) {
  for (const key of keys) {
    const value = String(env[key] || '').trim()
    if (value) return value
  }
  return ''
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function expectedFor(target, envs) {
  const env = target === 'prod' ? envs.platformProd : envs.platformDev
  return {
    pm2Name: envValue(env, 'HZY_PLATFORM_PM2_NAME', 'PM2_NAME'),
    host: envValue(env, 'HOST') || '127.0.0.1',
    port: envValue(env, 'PORT') || (target === 'prod' ? '3010' : '3011'),
    serviceUrl: normalizeUrl(envValue(env, 'PLATFORM_SERVICE_URL')),
    stage: envValue(env, 'NUXT_PUBLIC_PLATFORM_STAGE'),
    deploymentProfile: envValue(env, 'HZY_DEPLOYMENT_PROFILE', 'NUXT_PUBLIC_DEPLOYMENT_PROFILE'),
    databaseName: envValue(env, 'DB_NAME')
  }
}

function diagnosticsUrl(baseUrl) {
  return `${normalizeUrl(baseUrl)}/api/platform/diagnostics`
}

async function fetchDiagnostics(baseUrl, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const response = await fetch(diagnosticsUrl(baseUrl), { headers })
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = { code: 1, message: text.slice(0, 500) }
  }

  if (!response.ok || payload.code !== 0) {
    throw new Error(`diagnostics request failed (${response.status}): ${payload.message || payload.statusMessage || text.slice(0, 200)}`)
  }

  return payload.data
}

function assertEqual(failures, actual, expected, label) {
  if (expected === null || expected === undefined || expected === '') return
  if (String(actual ?? '') !== String(expected)) {
    failures.push(`${label}: expected ${expected}, got ${actual ?? '<null>'}`)
  }
}

function validateDiagnostics(target, data, expected) {
  const failures = []
  assertEqual(failures, data.process?.pm2Name, expected.pm2Name, `${target} process.pm2Name`)
  assertEqual(failures, data.process?.host, expected.host, `${target} process.host`)
  assertEqual(failures, data.process?.port, expected.port, `${target} process.port`)
  assertEqual(failures, normalizeUrl(data.platform?.serviceUrl), expected.serviceUrl, `${target} platform.serviceUrl`)
  assertEqual(failures, data.platform?.stage, expected.stage, `${target} platform.stage`)
  assertEqual(failures, data.platform?.deploymentProfile, expected.deploymentProfile, `${target} platform.deploymentProfile`)
  assertEqual(failures, data.database?.configuredName, expected.databaseName, `${target} database.configuredName`)
  assertEqual(failures, data.database?.databaseName, expected.databaseName, `${target} database.databaseName`)

  if (target === 'prod' && data.database?.databaseName !== 'hzy_platform') {
    failures.push(`prod databaseName must be hzy_platform, got ${data.database?.databaseName || '<null>'}`)
  }
  if (target === 'dev' && !String(data.database?.databaseName || '').endsWith('_dev')) {
    failures.push(`dev databaseName must end with _dev, got ${data.database?.databaseName || '<null>'}`)
  }
  if (data.database?.connected !== true) {
    failures.push(`${target} database is not connected: ${data.database?.error || '<no error>'}`)
  }
  if (data.signing?.activeKeyPresent !== true) {
    failures.push(`${target} active signing key is missing: ${data.signing?.error || '<no error>'}`)
  }
  if (data.signing?.privateKeyUsable !== true) {
    failures.push(`${target} active signing private key is not usable: ${data.signing?.error || '<no error>'}`)
  }

  return failures
}

async function probeTarget(target, baseUrl, token, expected) {
  const data = await fetchDiagnostics(baseUrl, token)
  const failures = validateDiagnostics(target, data, expected)
  console.info(`[platform-runtime] ${target}: url=${normalizeUrl(baseUrl)}, db=${data.database?.databaseName || '<none>'}, service=${data.platform?.serviceUrl || '<none>'}, stage=${data.platform?.stage || '<none>'}, pm2=${data.process?.pm2Name || '<none>'}, signing=${data.signing?.kid || '<none>'}, signingPrivateKey=${data.signing?.privateKeyUsable ? 'usable' : 'unusable'}`)

  if (failures.length) {
    throw new Error(failures.join('\n  - '))
  }

  return data
}

function validatePair(results) {
  const prod = results.prod
  const dev = results.dev
  if (!prod || !dev) return

  const failures = []
  if (prod.database?.databaseName && prod.database.databaseName === dev.database?.databaseName) {
    failures.push(`prod/dev Platform DB must be different, both use ${prod.database.databaseName}`)
  }
  if (prod.process?.pm2Name && prod.process.pm2Name === dev.process?.pm2Name) {
    failures.push(`prod/dev Platform PM2 names must be different, both use ${prod.process.pm2Name}`)
  }
  if (prod.process?.port && String(prod.process.port) === String(dev.process?.port)) {
    failures.push(`prod/dev Platform ports must be different, both use ${prod.process.port}`)
  }
  if (prod.platform?.stage && prod.platform.stage === dev.platform?.stage) {
    failures.push(`prod/dev Platform stages must be different, both use ${prod.platform.stage}`)
  }
  if (prod.platform?.serviceUrl && prod.platform.serviceUrl === dev.platform?.serviceUrl) {
    failures.push(`prod/dev Platform serviceUrl must be different, both use ${prod.platform.serviceUrl}`)
  }
  if (
    prod.signing?.publicKeyFingerprint
    && dev.signing?.publicKeyFingerprint
    && prod.signing.publicKeyFingerprint === dev.signing.publicKeyFingerprint
  ) {
    failures.push('prod/dev Platform signing public key fingerprints must be different')
  }

  if (failures.length) {
    throw new Error(failures.join('\n  - '))
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  const targets = Object.entries(args.urls)
  if (!targets.length) {
    throw new Error('at least one of --prod-url or --dev-url is required')
  }

  const envs = readEnvSet(args.files)
  const results = {}
  for (const [target, url] of targets) {
    results[target] = await probeTarget(target, url, args.tokens[target] || args.token, expectedFor(target, envs))
  }
  validatePair(results)
  console.info('[platform-runtime] passed')
}

main().catch((error) => {
  console.error(`[platform-runtime] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})

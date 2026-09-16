#!/usr/bin/env node

import { chmod, copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import process from 'node:process'

const platformEnvFile = '/wiztek/huizhi-yun/platform-dev/.env.dev'
const activationFile = '/etc/hzy-console-test/activation.env'
const consoleEnvFile = '/wiztek/huizhi-yun/ctr812-console-release/console/.env.test'

function parseEnv(content) {
  const env = new Map()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
        .replaceAll('\\n', '\n')
        .replaceAll('\\"', '"')
        .replaceAll('\\\\', '\\')
    }
    env.set(line.slice(0, separator).trim(), value)
  }
  return env
}

function required(env, name) {
  const value = String(env.get(name) || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function quoteEnv(value) {
  return `"${String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')}"`
}

async function updateEnvFile(path, token, suffix) {
  const source = await readFile(path, 'utf8')
  const key = 'HZY_CONSOLE_PLATFORM_SERVICE_TOKEN'
  const line = `${key}=${quoteEnv(token)}`
  const next = new RegExp(`^${key}=.*$`, 'm').test(source)
    ? source.replace(new RegExp(`^${key}=.*$`, 'm'), line)
    : `${source.replace(/\s*$/, '\n')}${line}\n`
  const backup = `${path}.pre-service-token-${suffix}`
  const temporary = `${path}.tmp-${process.pid}`
  await copyFile(path, backup)
  await chmod(backup, 0o600)
  await writeFile(temporary, next, { mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
  await chmod(path, 0o600)
  return backup
}

if (!process.argv.includes('--execute')) {
  throw new Error('refusing without --execute')
}

const platform = parseEnv(await readFile(platformEnvFile, 'utf8'))
const activation = parseEnv(await readFile(activationFile, 'utf8'))
if (required(platform, 'DB_NAME') !== 'hzy_platform_dev') {
  throw new Error('refusing non-development Platform environment')
}
if (
  required(activation, 'HZY_PLATFORM_TENANT_CODE') !== 'C000001'
  || required(activation, 'HZY_PLATFORM_DEPLOYMENT_CODE') !== 'wiztek-test-console'
) {
  throw new Error('refusing unexpected Console test activation')
}

const token = String(
  platform.get('HZY_CLOUDFLARE_INTERNAL_TOKEN')
  || platform.get('PLATFORM_INTERNAL_SERVICE_TOKENS')
  || platform.get('PLATFORM_INTERNAL_SERVICE_TOKEN')
  || ''
).split(',').map(item => item.trim()).find(Boolean)
if (!token) throw new Error('Platform development internal service token is missing')

const suffix = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
const backups = [
  await updateEnvFile(activationFile, token, suffix),
  await updateEnvFile(consoleEnvFile, token, suffix)
]

console.info(JSON.stringify({
  status: 'verified',
  tenantCode: 'C000001',
  deploymentCode: 'wiztek-test-console',
  updatedFiles: 2,
  backupFiles: backups,
  fileMode: '0600'
}))

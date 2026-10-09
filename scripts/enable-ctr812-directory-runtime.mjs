#!/usr/bin/env node
import { chmod, chown, readFile, rename, stat, writeFile } from 'node:fs/promises'
import process from 'node:process'

const envFile = '/etc/hzy-data-runtime-ctr812/.env'
const expectedDatabase = 'hzy_console_ctr812_20260718'

function quoteEnv(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '')}"`
}

function parseEnvValue(rawValue) {
  const value = rawValue.trim()
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replaceAll('\\"', '"')
      .replaceAll('\\\\', '\\')
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }
  return value
}

function readEnv(content) {
  const values = new Map()
  for (const line of content.split(/\r?\n/)) {
    const equalsIndex = line.indexOf('=')
    if (equalsIndex <= 0) continue
    const key = line.slice(0, equalsIndex).trim()
    if (!key || key.startsWith('#')) continue
    values.set(key, parseEnvValue(line.slice(equalsIndex + 1)))
  }
  return values
}

function requiredValue(values, keys) {
  for (const key of keys) {
    const value = values.get(key)?.trim()
    if (value) return value
  }
  throw new Error(`missing required database setting: ${keys.join(' or ')}`)
}

async function main() {
  if (!process.argv.includes('--execute')) {
    throw new Error('refusing without --execute')
  }
  const metadata = await stat(envFile)
  const content = await readFile(envFile, 'utf8')
  const values = readEnv(content)
  if (values.get('HZY_CONSOLE_DB_NAME') !== expectedDatabase) {
    throw new Error('refusing unexpected CTR-812 Console database binding')
  }

  const updates = new Map([
    ['HZY_DIRECTORY_RUNTIME_ENABLED', 'true'],
    ['HZY_DIRECTORY_DB_HOST', requiredValue(values, ['HZY_CONSOLE_DB_HOST', 'HZY_DATA_RUNTIME_DB_HOST', 'DB_HOST'])],
    ['HZY_DIRECTORY_DB_PORT', requiredValue(values, ['HZY_CONSOLE_DB_PORT', 'HZY_DATA_RUNTIME_DB_PORT', 'DB_PORT'])],
    ['HZY_DIRECTORY_DB_USER', requiredValue(values, ['HZY_CONSOLE_DB_USER', 'HZY_DATA_RUNTIME_DB_USER', 'DB_USER'])],
    ['HZY_DIRECTORY_DB_PASSWORD', requiredValue(values, ['HZY_CONSOLE_DB_PASSWORD', 'HZY_DATA_RUNTIME_DB_PASSWORD', 'DB_PASSWORD'])],
    ['HZY_DIRECTORY_DB_NAME', expectedDatabase],
    ['HZY_DIRECTORY_DB_CONNECTION_LIMIT', requiredValue(values, ['HZY_CONSOLE_DB_CONNECTION_LIMIT', 'HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT', 'DB_CONNECTION_LIMIT'])]
  ])

  const seen = new Set()
  const lines = content.split(/\r?\n/).map((line) => {
    const equalsIndex = line.indexOf('=')
    if (equalsIndex <= 0) return line
    const key = line.slice(0, equalsIndex).trim()
    if (!updates.has(key)) return line
    seen.add(key)
    return `${key}=${quoteEnv(updates.get(key))}`
  })
  for (const [key, value] of updates) {
    if (!seen.has(key)) lines.push(`${key}=${quoteEnv(value)}`)
  }

  const nextFile = `${envFile}.next`
  await writeFile(nextFile, `${lines.join('\n').replace(/\n+$/u, '')}\n`, {
    mode: 0o600,
    flag: 'wx'
  })
  await chown(nextFile, metadata.uid, metadata.gid)
  await chmod(nextFile, 0o600)
  await rename(nextFile, envFile)
  console.info('[ctr812-directory-runtime] enabled=true')
  console.info(`[ctr812-directory-runtime] database=${expectedDatabase}`)
  console.info('[ctr812-directory-runtime] mode=0600')
}

main().catch((error) => {
  console.error(`[ctr812-directory-runtime] ${error.message}`)
  process.exitCode = 1
})

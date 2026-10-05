#!/usr/bin/env node

import { chmod, copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import process from 'node:process'

const envFile = '/etc/hzy-data-runtime-ctr812/.env'
const bindingFile = '/etc/hzy-data-runtime-ctr812/deployment-bindings.json'
const expectedRuntimeDeployment = 'c000001-ctr812-test-runtime'
const consoleDeployment = 'wiztek-test-console'
const configDir = '/etc/hzy-data-runtime-ctr812'

function parseEnv(content) {
  return Object.fromEntries(content.split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) return []
    const separator = line.indexOf('=')
    if (separator <= 0) return []
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    return [[line.slice(0, separator).trim(), value]]
  }))
}

if (!process.argv.includes('--execute')) {
  throw new Error('refusing without --execute')
}

const env = parseEnv(await readFile(envFile, 'utf8'))
if (
  env.HZY_DATA_RUNTIME_TENANT !== 'C000001'
  || env.HZY_DATA_RUNTIME_DEPLOYMENT !== expectedRuntimeDeployment
) {
  throw new Error('refusing unexpected Data Runtime test binding')
}

const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
let previous = {}
try {
  previous = JSON.parse(await readFile(bindingFile, 'utf8'))
  const backup = `${bindingFile}.pre-ctr812-${timestamp}`
  await copyFile(bindingFile, backup)
  await chmod(backup, 0o600)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const next = {
  ...previous,
  console: consoleDeployment
}
const temporary = `${bindingFile}.tmp-${process.pid}`
await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
  mode: 0o600,
  flag: 'wx'
})
await rename(temporary, bindingFile)
await chmod(bindingFile, 0o600)

const envSource = await readFile(envFile, 'utf8')
const envLine = `HZY_DATA_RUNTIME_CONFIG_DIR=${configDir}`
const envNext = /^HZY_DATA_RUNTIME_CONFIG_DIR=.*$/m.test(envSource)
  ? envSource.replace(/^HZY_DATA_RUNTIME_CONFIG_DIR=.*$/m, envLine)
  : `${envSource.replace(/\s*$/, '\n')}${envLine}\n`
const envBackup = `${envFile}.pre-config-dir-${timestamp}`
const envTemporary = `${envFile}.tmp-${process.pid}`
await copyFile(envFile, envBackup)
await chmod(envBackup, 0o600)
await writeFile(envTemporary, envNext, { mode: 0o600, flag: 'wx' })
await rename(envTemporary, envFile)
await chmod(envFile, 0o600)

console.info(JSON.stringify({
  status: 'verified',
  tenantCode: 'C000001',
  runtimeDeployment: expectedRuntimeDeployment,
  consoleDeployment,
  configDir,
  bindingFile,
  fileMode: '0600'
}))

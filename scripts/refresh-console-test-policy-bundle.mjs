#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import process from 'node:process'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for ${item}`)
    }
    args[item.slice(2)] = value
    index += 1
  }
  return args
}

function parseEnv(content) {
  const env = {}
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
    env[line.slice(0, separator).trim()] = value
  }
  return env
}

function required(value, name) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

const args = parseArgs(process.argv.slice(2))
const activationFile = args['activation-file'] || '/etc/hzy-console-test/activation.env'
const activation = parseEnv(await readFile(activationFile, 'utf8'))
const platformUrl = required(activation.HZY_PLATFORM_URL, 'HZY_PLATFORM_URL').replace(/\/+$/, '')
const tenantCode = required(activation.HZY_PLATFORM_TENANT_CODE, 'HZY_PLATFORM_TENANT_CODE')
const deploymentCode = required(activation.HZY_PLATFORM_DEPLOYMENT_CODE, 'HZY_PLATFORM_DEPLOYMENT_CODE')
const runtimeToken = required(activation.HZY_PLATFORM_RUNTIME_TOKEN, 'HZY_PLATFORM_RUNTIME_TOKEN')

if (deploymentCode !== 'wiztek-test-console') {
  throw new Error(`refusing non-test deployment: ${deploymentCode}`)
}

const url = new URL(
  `/api/v1/runtime/deployments/${encodeURIComponent(deploymentCode)}/bundle`,
  `${platformUrl}/`
)
url.searchParams.set('tenantCode', tenantCode)

const response = await fetch(url, {
  headers: {
    authorization: `Bearer ${runtimeToken}`
  }
})
const body = await response.json().catch(() => null)
if (!response.ok || !body || (body.code !== 0 && body.success !== true)) {
  throw new Error(
    String(body?.message || body?.statusMessage || `policy bundle refresh failed: HTTP ${response.status}`)
  )
}

const data = body.data || body
const bundleVersion = required(data.bundleVersion, 'bundleVersion')
const bundleHash = required(data.bundleHash, 'bundleHash')
const resources = Array.isArray(data.bundle?.apps)
  ? data.bundle.apps
    .filter(app => app?.appCode === 'console')
    .flatMap(app => Array.isArray(app.resources) ? app.resources : [])
  : []

console.info(JSON.stringify({
  status: 'verified',
  tenantCode,
  deploymentCode,
  bundleVersion,
  bundleHash,
  policyRevision: Number(data.policyRevision || 0),
  consoleResourceCount: resources.length
}))

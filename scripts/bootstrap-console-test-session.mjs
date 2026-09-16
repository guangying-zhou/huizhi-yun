#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

const activationFile = '/etc/hzy-console-test/activation.env'
const consoleEnvFile = '/wiztek/huizhi-yun/ctr812-console-release/console/.env.test'
const sessionFile = '/etc/hzy-console-test/ctr812-session.json'
const expectedTenant = 'C000001'
const expectedDeployment = 'wiztek-test-console'
const expectedRuntimeDeployment = 'c000001-ctr812-test-runtime'

function unquote(value) {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2
    && (
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    )
  ) {
    return trimmed.slice(1, -1)
      .replaceAll('\\n', '\n')
      .replaceAll('\\"', '"')
      .replaceAll('\\\\', '\\')
  }
  return trimmed
}

function parseEnv(content) {
  const env = new Map()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    env.set(line.slice(0, separator).trim(), unquote(line.slice(separator + 1)))
  }
  return env
}

function required(env, name) {
  const value = env.get(name)?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, options)
  const body = await response.json().catch(() => null)
  if (!response.ok || !body) {
    const code = body?.error?.code || body?.code || `http_${response.status}`
    throw new Error(`request failed: ${code}`)
  }
  return body
}

async function main() {
  if (!process.argv.includes('--execute')) {
    throw new Error('refusing without --execute')
  }

  const env = new Map([
    ...parseEnv(await readFile(activationFile, 'utf8')),
    ...parseEnv(await readFile(consoleEnvFile, 'utf8'))
  ])
  const tenant = required(env, 'HZY_PLATFORM_TENANT_CODE')
  const deployment = required(env, 'HZY_PLATFORM_DEPLOYMENT_CODE')
  const platformURL = required(env, 'HZY_PLATFORM_URL').replace(/\/+$/, '')
  const platformToken = required(env, 'HZY_PLATFORM_RUNTIME_TOKEN')
  const runtimeURL = required(env, 'HZY_CONSOLE_TENANT_RUNTIME_URL').replace(/\/+$/, '')
  const runtimeToken = required(env, 'HZY_CONSOLE_TENANT_RUNTIME_TOKEN')

  if (tenant !== expectedTenant || deployment !== expectedDeployment) {
    throw new Error('refusing unexpected test tenant or deployment')
  }
  if (!runtimeURL.startsWith('http://127.0.0.1:18083')) {
    throw new Error('refusing non-isolated CTR-812 Runtime URL')
  }

  const bundleEnvelope = await requestJSON(
    `${platformURL}/api/v1/runtime/deployments/${encodeURIComponent(deployment)}/bundle?tenantCode=${encodeURIComponent(tenant)}`,
    { headers: { authorization: `Bearer ${platformToken}` } }
  )
  const bundle = bundleEnvelope?.data?.bundle
  if (!bundle || !Array.isArray(bundle.roleAssignments)) {
    throw new Error('policy bundle roleAssignments are unavailable')
  }

  const now = Date.now()
  const adminSubjects = new Set(
    bundle.roleAssignments
      .filter((item) => (
        item?.subjectType === 'user'
        && item?.roleCode === 'system_admin'
        && String(item?.status || 'active').toLowerCase() === 'active'
        && (!item?.startsAt || Date.parse(item.startsAt) <= now)
        && (!item?.expiresAt || Date.parse(item.expiresAt) > now)
      ))
      .map(item => String(item.subjectCode || '').trim())
      .filter(Boolean)
  )
  if (adminSubjects.size === 0) {
    throw new Error('no active system_admin assignment exists in the test policy bundle')
  }

  const runtimeHeaders = {
    authorization: `Bearer ${runtimeToken}`,
    'x-hzy-tenant': tenant,
    'x-hzy-deployment': expectedRuntimeDeployment
  }
  const activeUsers = []
  for (let page = 1; page <= 100; page += 1) {
    const envelope = await requestJSON(
      `${runtimeURL}/v1/console/directory/users?status=active&page=${page}&pageSize=100`,
      { headers: runtimeHeaders }
    )
    const data = envelope?.data
    const items = Array.isArray(data?.items) ? data.items : []
    activeUsers.push(...items)
    if (activeUsers.length >= Number(data?.total || 0) || items.length === 0) break
  }

  const selected = activeUsers.find(item => adminSubjects.has(String(item?.uid || '').trim()))
  if (!selected?.uid) {
    throw new Error('no active Directory user matches a system_admin assignment')
  }

  const rawSessionID = `cs_${randomBytes(32).toString('base64url')}`
  const storedSessionID = `sha256_${sha256(rawSessionID)}`
  const idempotencyKey = `ctr812:auth-session:issue:${randomUUID()}`
  const issued = await requestJSON(`${runtimeURL}/v1/console/auth/sessions`, {
    method: 'POST',
    headers: {
      ...runtimeHeaders,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey
    },
    body: JSON.stringify({
      sessionIdHash: storedSessionID,
      uid: selected.uid,
      authProvider: 'ctr812_test',
      ttlSeconds: 7200,
      deviceSummary: 'CTR-812 isolated zero-DB Console acceptance'
    })
  })

  const session = {
    schemaVersion: 'ctr812-console-test-session.v1',
    tenant,
    consoleDeployment: deployment,
    runtimeDeployment: expectedRuntimeDeployment,
    rawSessionId: rawSessionID,
    storedSessionId: storedSessionID,
    subjectUid: selected.uid,
    issuedAt: new Date().toISOString(),
    expiresAt: issued?.data?.expiresAt || null
  }
  await writeFile(sessionFile, `${JSON.stringify(session, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx'
  })
  await chmod(sessionFile, 0o600)

  console.info(JSON.stringify({
    status: 'ready',
    activeDirectoryUsers: activeUsers.length,
    systemAdminAssignments: adminSubjects.size,
    subjectFingerprint: `sha256:${sha256(selected.uid)}`,
    storedSessionFingerprint: `sha256:${sha256(storedSessionID)}`,
    expiresAt: session.expiresAt,
    sessionFileMode: '0600'
  }))
}

main().catch((error) => {
  console.error(`[ctr812-session] ${error.message}`)
  process.exitCode = 1
})

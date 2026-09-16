#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign
} from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import mysql from 'mysql2/promise'

function usage() {
  return `
Usage:
  node scripts/prepare-console-test-activation.mjs \\
    --env-file /srv/hzy/platform-dev/.env.dev \\
    --deployment-code wiztek-test-console \\
    --public-url https://hzy-test.wiztek.cn \\
    --platform-url http://127.0.0.1:3011 \\
    --tenant-runtime-url https://runtime.example.test/ctr812 \\
    --output /etc/hzy-console-test/activation.env \\
    --execute

This maintenance command is intentionally limited to an active Console
deployment whose environment is "test". It rotates the test Platform runtime
credential, re-signs the existing test license with the current active dev
signing key, corrects the test deployment site URL, generates a fresh test
Data Runtime static token, and asks the protected Platform internal API to
generate a new test policy bundle.

Secrets are never printed. The output env file is created with mode 0600 and
must not already exist.
`
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--execute') {
      args.execute = true
      continue
    }
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (!item.startsWith('--')) {
      throw new Error(`unexpected argument: ${item}`)
    }
    const name = item.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for --${name}`)
    }
    args[name] = value
    index += 1
  }
  return args
}

function text(value) {
  return String(value || '').trim()
}

function required(args, name) {
  const value = text(args[name])
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function unquote(value) {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2
    && (
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
    )
  ) {
    return trimmed.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  return trimmed
}

function readEnvFile(file) {
  const env = {}
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    env[line.slice(0, separator).trim()] = unquote(line.slice(separator + 1))
  }
  return env
}

function normalizePrivateKey(value) {
  const raw = text(value)
  if (!raw) return ''
  if (raw.startsWith('base64:')) {
    return Buffer.from(raw.slice('base64:'.length), 'base64').toString('utf8').trim()
  }
  return raw.replace(/\\n/g, '\n')
}

function samePublicKey(left, right) {
  try {
    const leftDer = createPublicKey(left).export({ type: 'spki', format: 'der' })
    const rightDer = createPublicKey(right).export({ type: 'spki', format: 'der' })
    return Buffer.compare(leftDer, rightDer) === 0
  } catch {
    return false
  }
}

function quoteEnv(value) {
  return `"${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')}"`
}

function sqlDateNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function internalToken(env) {
  const raw = text(
    env.HZY_CLOUDFLARE_INTERNAL_TOKEN
    || env.PLATFORM_INTERNAL_SERVICE_TOKENS
    || env.PLATFORM_INTERNAL_SERVICE_TOKEN
  )
  return raw.split(',').map(item => item.trim()).find(Boolean) || ''
}

function makeRuntimeToken() {
  return `hzy_rt_${randomBytes(32).toString('base64url')}`
}

function makeDataRuntimeToken() {
  return `hzy_dr_${randomBytes(32).toString('base64url')}`
}

function hashRuntimeToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function hashLicensePayload(payload) {
  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`
}

function signLicense(payload, kid, privateKeyPem) {
  const serialized = JSON.stringify(payload)
  const signature = sign(null, Buffer.from(serialized), createPrivateKey(privateKeyPem))
    .toString('base64url')
  return JSON.stringify({
    schemaVersion: 'license-token.v1',
    payload,
    signature,
    kid,
    alg: 'Ed25519',
    signedAt: sqlDateNow()
  })
}

async function queryOne(connection, sql, params = []) {
  const [rows] = await connection.execute(sql, params)
  return rows[0] || null
}

async function generateBundle(input) {
  const url = new URL(
    `/api/platform/internal/console/tenants/${encodeURIComponent(input.tenantCode)}/bundle`,
    `${input.platformUrl.replace(/\/+$/, '')}/`
  )
  url.searchParams.set('environment', 'test')
  url.searchParams.set('deploymentCode', input.deploymentCode)
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${input.token}`,
      'x-hzy-internal-principal': 'console-test-activation-maintenance'
    }
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body || (body.code !== 0 && body.success !== true)) {
    const message = text(body?.message || body?.statusMessage) || `HTTP ${response.status}`
    throw new Error(`test policy bundle generation failed: ${message}`)
  }
  return body.data || body
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  const envFile = resolve(required(args, 'env-file'))
  const deploymentCode = required(args, 'deployment-code')
  const publicUrl = new URL(required(args, 'public-url')).toString().replace(/\/$/, '')
  const platformUrl = new URL(required(args, 'platform-url')).toString().replace(/\/$/, '')
  const tenantRuntimeUrl = new URL(required(args, 'tenant-runtime-url')).toString().replace(/\/$/, '')
  const output = resolve(required(args, 'output'))

  if (!args.execute) {
    throw new Error('refusing to modify test activation state without --execute')
  }
  if (!existsSync(envFile)) {
    throw new Error(`env file not found: ${envFile}`)
  }
  if (existsSync(output)) {
    throw new Error(`refusing to overwrite activation output: ${output}`)
  }

  const env = {
    ...process.env,
    ...readEnvFile(envFile)
  }
  const privateKeyPem = normalizePrivateKey(env.HZY_PLATFORM_SIGNING_PRIVATE_KEY)
  const platformInternalToken = internalToken(env)
  if (!privateKeyPem) throw new Error('HZY_PLATFORM_SIGNING_PRIVATE_KEY is missing')
  if (!platformInternalToken) throw new Error('Platform internal service token is missing')

  const connection = await mysql.createConnection({
    host: text(env.DB_HOST) || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: required(env, 'DB_USER'),
    password: env.DB_PASSWORD || '',
    database: required(env, 'DB_NAME'),
    multipleStatements: false
  })

  let activation
  try {
    const deployment = await queryOne(
      connection,
      `SELECT id, tenant_code AS tenantCode, app_code AS appCode,
              deployment_code AS deploymentCode, environment, status, site_id AS siteId
         FROM deployments
        WHERE deployment_code = ?
        LIMIT 1`,
      [deploymentCode]
    )
    if (!deployment) throw new Error(`test deployment not found: ${deploymentCode}`)
    if (deployment.appCode !== 'console') throw new Error('deployment app_code must be console')
    if (deployment.environment !== 'test') throw new Error('refusing non-test deployment')
    if (deployment.status !== 'active') throw new Error('test deployment must be active')

    const activeKey = await queryOne(
      connection,
      `SELECT kid, alg, public_key AS publicKey
         FROM platform_signing_keys
        WHERE status = 'active'
        ORDER BY activated_at DESC, id DESC
        LIMIT 1`
    )
    if (!activeKey || activeKey.alg !== 'Ed25519') {
      throw new Error('an active Ed25519 dev signing key is required')
    }
    const derivedPublicKey = createPublicKey(createPrivateKey(privateKeyPem))
      .export({ type: 'spki', format: 'pem' })
      .toString()
    if (!samePublicKey(activeKey.publicKey, derivedPublicKey)) {
      throw new Error('configured dev signing private key does not match the active public key')
    }

    const license = await queryOne(
      connection,
      `SELECT l.id, l.signed_token AS signedToken
         FROM licenses l
         JOIN license_deployments ld ON ld.license_id = l.id
        WHERE l.tenant_code = ?
          AND ld.deployment_id = ?
          AND ld.status = 'active'
        ORDER BY l.id DESC
        LIMIT 1`,
      [deployment.tenantCode, deployment.id]
    )
    if (!license?.signedToken) throw new Error('active test license is missing')
    const previousToken = JSON.parse(license.signedToken)
    const licensePayload = previousToken?.payload
    if (!licensePayload || typeof licensePayload !== 'object') {
      throw new Error('existing test license payload is invalid')
    }
    if (
      licensePayload.tenantCode !== deployment.tenantCode
      || Number(licensePayload.deploymentId) !== Number(deployment.id)
      || licensePayload.deploymentCode !== deployment.deploymentCode
      || licensePayload.appCode !== 'console'
    ) {
      throw new Error('existing test license is not bound to the selected deployment')
    }

    const platformRuntimeToken = makeRuntimeToken()
    const dataRuntimeToken = makeDataRuntimeToken()
    const signedLicenseToken = signLicense(licensePayload, activeKey.kid, privateKeyPem)

    await connection.beginTransaction()
    try {
      await connection.execute(
        `UPDATE deployment_sites
            SET public_url = ?, updated_at = UTC_TIMESTAMP()
          WHERE id = ?
            AND environment = 'test'
            AND status = 'active'`,
        [publicUrl, deployment.siteId]
      )

      await connection.execute(
        `INSERT INTO tenant_runtime_credentials
          (tenant_code, credential_mode, runtime_token_hash, runtime_token_last4, status,
           issued_by_account_id, issued_at, rotated_at, expires_at, revoked_at,
           last_used_at, created_at, updated_at)
         VALUES (?, 'tenant', ?, ?, 'active', NULL, UTC_TIMESTAMP(), NULL, NULL, NULL,
                 NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           credential_mode = 'tenant',
           runtime_token_hash = VALUES(runtime_token_hash),
           runtime_token_last4 = VALUES(runtime_token_last4),
           status = 'active',
           issued_by_account_id = NULL,
           issued_at = UTC_TIMESTAMP(),
           rotated_at = UTC_TIMESTAMP(),
           expires_at = NULL,
           revoked_at = NULL,
           last_used_at = NULL,
           updated_at = UTC_TIMESTAMP()`,
        [
          deployment.tenantCode,
          hashRuntimeToken(platformRuntimeToken),
          platformRuntimeToken.slice(-4)
        ]
      )

      await connection.execute(
        `UPDATE licenses
            SET payload_hash = ?, signed_token = ?, updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [hashLicensePayload(licensePayload), signedLicenseToken, license.id]
      )
      await connection.execute(
        `UPDATE policy_bundles pb
          JOIN policy_bundle_targets pbt ON pbt.bundle_id = pb.id
           SET pb.status = 'superseded'
         WHERE pbt.deployment_id = ?
           AND pb.status = 'active'`,
        [deployment.id]
      )

      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    }

    const bundle = await generateBundle({
      tenantCode: deployment.tenantCode,
      deploymentCode: deployment.deploymentCode,
      platformUrl,
      token: platformInternalToken
    })
    const bundleKid = text(bundle.signedByKid || bundle.kid)
    if (bundleKid !== activeKey.kid) {
      throw new Error(`generated bundle kid mismatch: ${bundleKid || '<empty>'}`)
    }

    activation = {
      tenantCode: deployment.tenantCode,
      deploymentCode: deployment.deploymentCode,
      platformRuntimeToken,
      dataRuntimeToken,
      signedLicenseToken,
      signingKid: activeKey.kid,
      signingPublicKey: derivedPublicKey,
      bundleVersion: text(bundle.bundleVersion),
      bundleHash: text(bundle.bundleHash)
    }
  } finally {
    await connection.end()
  }

  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  const lines = [
    `HZY_PLATFORM_URL=${quoteEnv(platformUrl)}`,
    `HZY_PLATFORM_TENANT_CODE=${quoteEnv(activation.tenantCode)}`,
    `HZY_PLATFORM_DEPLOYMENT_CODE=${quoteEnv(activation.deploymentCode)}`,
    `HZY_PLATFORM_RUNTIME_TOKEN=${quoteEnv(activation.platformRuntimeToken)}`,
    `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN=${quoteEnv(platformInternalToken)}`,
    `HZY_PLATFORM_SIGNING_KID=${quoteEnv(activation.signingKid)}`,
    `HZY_PLATFORM_SIGNING_PUBKEY=${quoteEnv(activation.signingPublicKey)}`,
    `HZY_PLATFORM_LICENSE_TOKEN=${quoteEnv(activation.signedLicenseToken)}`,
    `HZY_CONSOLE_DATA_ACCESS_MODE=${quoteEnv('tenant-runtime')}`,
    `HZY_CONSOLE_TENANT_RUNTIME_URL=${quoteEnv(tenantRuntimeUrl)}`,
    `HZY_CONSOLE_TENANT_RUNTIME_TOKEN=${quoteEnv(activation.dataRuntimeToken)}`,
    `HZY_TENANT_RUNTIME_AUDIENCE=${quoteEnv('data-runtime')}`,
    ''
  ]
  await writeFile(output, lines.join('\n'), { mode: 0o600, flag: 'wx' })

  console.info('[console-test-activation] prepared')
  console.info(`[console-test-activation] tenant=${activation.tenantCode}`)
  console.info(`[console-test-activation] deployment=${activation.deploymentCode}`)
  console.info(`[console-test-activation] signingKid=${activation.signingKid}`)
  console.info(`[console-test-activation] bundleVersion=${activation.bundleVersion || '<empty>'}`)
  console.info(`[console-test-activation] bundleHash=${activation.bundleHash || '<empty>'}`)
  console.info(`[console-test-activation] output=${output} mode=0600`)
}

main().catch((error) => {
  console.error(`[console-test-activation] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})

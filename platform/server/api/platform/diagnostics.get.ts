import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { H3Event } from 'h3'
import { createError, defineEventHandler, getHeader, setHeader } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { useRuntimeConfig } from '#imports'
import { queryRow } from '~~/server/utils/db'

type CloudflareRuntimeEnv = Record<string, unknown>
type CloudflareRuntimeEvent = {
  context?: {
    cloudflare?: {
      env?: CloudflareRuntimeEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareRuntimeEnv
      }
    }
    nitro?: {
      env?: CloudflareRuntimeEnv
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: CloudflareRuntimeEnv
      }
    }
  }
}

type CloudflareGlobal = typeof globalThis & {
  __hzyCloudflareEnv?: CloudflareRuntimeEnv
}

interface DatabaseProbeRow extends RowDataPacket {
  databaseName: string | null
  checkedAt: string
}

interface SigningKeyRow extends RowDataPacket {
  kid: string
  alg: string
  publicKey: string
  privateKeyRef: string
  status: string
  activatedAt: string
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getCloudflareEnv(event: H3Event) {
  const runtimeEvent = event as unknown as CloudflareRuntimeEvent
  return runtimeEvent.context?.cloudflare?.env
    || runtimeEvent.context?._platform?.cloudflare?.env
    || runtimeEvent.context?.nitro?.env
    || runtimeEvent.req?.runtime?.cloudflare?.env
    || (globalThis as CloudflareGlobal).__hzyCloudflareEnv
    || {}
}

function runtimeEnvValue(event: H3Event, ...keys: string[]) {
  const cloudflareEnv = getCloudflareEnv(event)
  for (const key of keys) {
    const value = stringValue(cloudflareEnv[key] || process.env[key])
    if (value) return value
  }
  return ''
}

function bearerToken(value: unknown) {
  const match = stringValue(value).match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

function normalizeHost(value: unknown) {
  const host = stringValue(value).toLowerCase()
  if (!host) return ''
  if (host.startsWith('[')) {
    return host.slice(1, host.indexOf(']'))
  }
  return host.split(':')[0]
}

function normalizeIp(value: unknown) {
  return stringValue(value)
    .replace(/^::ffff:/i, '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
}

function isLoopbackAddress(value: unknown) {
  const ip = normalizeIp(value)
  return ip === 'localhost'
    || ip === '::1'
    || ip === '0:0:0:0:0:0:0:1'
    || /^127(?:\.\d{1,3}){3}$/.test(ip)
}

function hasDiagnosticsToken(event: H3Event) {
  const expected = runtimeEnvValue(event, 'HZY_PLATFORM_DIAGNOSTICS_TOKEN', 'PLATFORM_DIAGNOSTICS_TOKEN')
  if (!expected) return false

  const actual = bearerToken(getHeader(event, 'authorization'))
    || stringValue(getHeader(event, 'x-hzy-diagnostics-token'))
  return actual === expected
}

function isLocalRequest(event: H3Event) {
  const host = normalizeHost(getHeader(event, 'host'))
  if (!isLoopbackAddress(host)) {
    return false
  }

  const forwardedFor = stringValue(getHeader(event, 'x-forwarded-for'))
  if (forwardedFor) {
    return isLoopbackAddress(forwardedFor.split(',')[0])
  }

  return isLoopbackAddress(event.node?.req?.socket?.remoteAddress)
}

function assertDiagnosticsAccess(event: H3Event) {
  if (hasDiagnosticsToken(event) || isLocalRequest(event)) {
    return
  }

  throw createError({
    statusCode: 403,
    statusMessage: 'Diagnostics Forbidden',
    message: 'platform diagnostics require loopback access or HZY_PLATFORM_DIAGNOSTICS_TOKEN'
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function normalizeUrl(value: unknown) {
  return stringValue(value).replace(/\/+$/, '')
}

function publicKeyFingerprint(publicKey: string) {
  return `sha256:${createHash('sha256').update(publicKey).digest('hex').slice(0, 32)}`
}

function normalizePemInput(value: string) {
  const normalized = value.trim()
  if (!normalized) return ''
  if (normalized.startsWith('base64:')) {
    return Buffer.from(normalized.slice('base64:'.length), 'base64').toString('utf8').trim()
  }
  return normalized.replace(/\\n/g, '\n')
}

function samePublicKey(left: string, right: string) {
  return left.replace(/\s+/g, '') === right.replace(/\s+/g, '')
}

function privateKeyRefType(privateKeyRef: string) {
  if (privateKeyRef.startsWith('env:')) return 'env'
  if (privateKeyRef.startsWith('file://') || privateKeyRef.startsWith('/')) return 'file'
  if (privateKeyRef.startsWith('kms:')) return 'kms'
  return privateKeyRef ? 'other' : null
}

function privateKeyRefToPath(privateKeyRef: string) {
  return privateKeyRef.startsWith('file://')
    ? fileURLToPath(privateKeyRef)
    : privateKeyRef
}

function publicKeyFromPrivateKey(privateKeyPem: string) {
  const privateKey = createPrivateKey(privateKeyPem)
  return createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString()
}

async function readPrivateKeyMaterial(event: H3Event, privateKeyRef: string) {
  if (privateKeyRef.startsWith('env:')) {
    const envName = privateKeyRef.slice('env:'.length).trim()
    const value = envName ? normalizePemInput(runtimeEnvValue(event, envName)) : ''
    if (!value) {
      throw new Error(`platform signing private key env is empty: ${envName || '<empty>'}`)
    }
    if (value.startsWith('file://') || value.startsWith('/')) {
      return readFile(privateKeyRefToPath(value), 'utf8')
    }
    return value
  }

  if (privateKeyRef.startsWith('kms:')) {
    throw new Error('KMS-backed platform signing keys are not implemented yet')
  }

  if (!privateKeyRef) {
    throw new Error('platform signing private_key_ref is empty')
  }

  return readFile(privateKeyRefToPath(privateKeyRef), 'utf8')
}

async function validatePrivateKeyUsable(event: H3Event, row: SigningKeyRow) {
  try {
    const privateKeyPem = normalizePemInput(await readPrivateKeyMaterial(event, row.privateKeyRef))
    const derivedPublicKey = publicKeyFromPrivateKey(privateKeyPem)
    if (!samePublicKey(row.publicKey, derivedPublicKey)) {
      return {
        privateKeyUsable: false,
        error: 'platform signing private key does not match active public key'
      }
    }

    return {
      privateKeyUsable: true,
      error: null
    }
  } catch (error) {
    return {
      privateKeyUsable: false,
      error: errorMessage(error)
    }
  }
}

async function loadDatabaseSnapshot(event: H3Event) {
  const config = useRuntimeConfig(event)
  const configuredName = runtimeEnvValue(event, 'DB_NAME') || stringValue(config.db?.name) || 'hzy_platform'

  try {
    const row = await queryRow<DatabaseProbeRow>(
      'SELECT DATABASE() AS databaseName, UTC_TIMESTAMP() AS checkedAt'
    )
    return {
      connected: true,
      configuredName,
      databaseName: row?.databaseName || null,
      checkedAt: row?.checkedAt || null,
      error: null
    }
  } catch (error) {
    return {
      connected: false,
      configuredName,
      databaseName: null,
      checkedAt: null,
      error: errorMessage(error)
    }
  }
}

async function loadSigningSnapshot(event: H3Event) {
  try {
    const row = await queryRow<SigningKeyRow>(
      `SELECT kid, alg, public_key AS publicKey, private_key_ref AS privateKeyRef, status, activated_at AS activatedAt
       FROM platform_signing_keys
       WHERE status = 'active'
       ORDER BY activated_at DESC, id DESC
       LIMIT 1`
    )

    if (!row) {
      return {
        activeKeyPresent: false,
        kid: null,
        alg: null,
        publicKeyFingerprint: null,
        privateKeyRefType: null,
        privateKeyUsable: false,
        activatedAt: null,
        error: null
      }
    }

    const privateKey = await validatePrivateKeyUsable(event, row)

    return {
      activeKeyPresent: true,
      kid: row.kid,
      alg: row.alg,
      publicKeyFingerprint: publicKeyFingerprint(row.publicKey),
      privateKeyRefType: privateKeyRefType(row.privateKeyRef),
      privateKeyUsable: privateKey.privateKeyUsable,
      activatedAt: row.activatedAt,
      error: privateKey.error
    }
  } catch (error) {
    return {
      activeKeyPresent: false,
      kid: null,
      alg: null,
      publicKeyFingerprint: null,
      privateKeyRefType: null,
      privateKeyUsable: false,
      activatedAt: null,
      error: errorMessage(error)
    }
  }
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Expires', '0')

  assertDiagnosticsAccess(event)

  const config = useRuntimeConfig(event)
  const [database, signing] = await Promise.all([
    loadDatabaseSnapshot(event),
    loadSigningSnapshot(event)
  ])

  return {
    code: 0,
    data: {
      checkedAt: new Date().toISOString(),
      process: {
        nodeEnv: process.env.NODE_ENV || null,
        pm2Name: runtimeEnvValue(event, 'HZY_PLATFORM_PM2_NAME', 'PM2_NAME') || null,
        host: runtimeEnvValue(event, 'HOST', 'NITRO_HOST') || null,
        port: runtimeEnvValue(event, 'PORT', 'NITRO_PORT') || null
      },
      platform: {
        serviceUrl: normalizeUrl(runtimeEnvValue(event, 'PLATFORM_SERVICE_URL') || config.public?.serviceUrl),
        stage: runtimeEnvValue(event, 'NUXT_PUBLIC_PLATFORM_STAGE') || stringValue(config.public?.platformStage),
        deploymentProfile: runtimeEnvValue(event, 'HZY_DEPLOYMENT_PROFILE', 'NUXT_PUBLIC_DEPLOYMENT_PROFILE')
          || stringValue(config.public?.deploymentProfile)
      },
      database,
      signing
    }
  }
})

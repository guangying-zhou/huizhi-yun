import { createPublicKey, verify as nodeVerify } from 'node:crypto'
import { readBody } from 'h3'
import { loadPlatformRuntimeConfig } from '~~/server/utils/platformRuntime'

interface LicenseToken {
  schemaVersion: string
  payload: Record<string, unknown>
  signature: string
  kid: string
  alg: string
  signedAt: string
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function verifySignature(input: {
  payload: string
  signature: string
  publicKeyPem: string
}) {
  return nodeVerify(
    null,
    Buffer.from(input.payload),
    createPublicKey(input.publicKeyPem),
    Buffer.from(input.signature, 'base64url')
  )
}

function parseLicenseToken(value: unknown): LicenseToken {
  if (typeof value === 'string') {
    const parsed = JSON.parse(value) as unknown
    return parseLicenseToken(parsed)
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'licenseToken is required'
    })
  }

  const token = value as Partial<LicenseToken>
  if (!token.payload || typeof token.payload !== 'object' || Array.isArray(token.payload)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'licenseToken.payload is required'
    })
  }

  return {
    schemaVersion: normalizeString(token.schemaVersion),
    payload: token.payload as Record<string, unknown>,
    signature: normalizeString(token.signature),
    kid: normalizeString(token.kid),
    alg: normalizeString(token.alg),
    signedAt: normalizeString(token.signedAt)
  }
}

export default defineEventHandler(async (event) => {
  const config = loadPlatformRuntimeConfig(event)
  const body = await readBody<Record<string, unknown> | null>(event).catch(() => null)
  const licenseToken = parseLicenseToken(body?.licenseToken)

  if (licenseToken.schemaVersion !== 'license-token.v1') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `unsupported license token schema: ${licenseToken.schemaVersion}`
    })
  }

  if (licenseToken.alg !== 'Ed25519') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `unsupported license alg: ${licenseToken.alg}`
    })
  }

  if (licenseToken.kid !== config.signingKid) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `license kid mismatch: ${licenseToken.kid} !== ${config.signingKid}`
    })
  }

  const payload = licenseToken.payload
  const tenantCode = normalizeString(payload.tenantCode)
  const appCode = normalizeString(payload.appCode)
  const deploymentCode = normalizeString(payload.deploymentCode)
  const expiresAt = normalizeString(payload.expiresAt)

  if (tenantCode !== config.tenantCode) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `license tenantCode mismatch: ${tenantCode} !== ${config.tenantCode}`
    })
  }

  if (body?.appCode && appCode !== normalizeString(body.appCode)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `license appCode mismatch: ${appCode} !== ${normalizeString(body.appCode)}`
    })
  }

  if (body?.deploymentCode && deploymentCode !== normalizeString(body.deploymentCode)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `license deploymentCode mismatch: ${deploymentCode} !== ${normalizeString(body.deploymentCode)}`
    })
  }

  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `license expired: ${expiresAt}`
    })
  }

  const verified = verifySignature({
    payload: JSON.stringify(payload),
    signature: licenseToken.signature,
    publicKeyPem: config.signingPubkey
  })

  if (!verified) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'license signature verification failed'
    })
  }

  return {
    code: 0,
    data: {
      platform: {
        baseUrl: config.baseUrl,
        tenantCode,
        deploymentCode,
        runtimeToken: config.runtimeToken,
        signingKid: config.signingKid,
        signingPubkey: config.signingPubkey
      }
    }
  }
})

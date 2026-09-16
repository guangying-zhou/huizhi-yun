import { createPublicKey, verify as nodeVerify } from 'node:crypto'
import { createError, defineEventHandler, readBody, setHeader, type H3Event } from 'h3'
import { issueServiceAccessToken, writeTokenEvent, hashOpaqueValue } from '~~/server/utils/oidc'
import { loadPlatformRuntimeConfig } from '~~/server/utils/platformRuntime'
import { consumeBootstrapAccessKey } from '~~/server/utils/serviceClients'

interface LicenseToken {
  schemaVersion: string
  payload: Record<string, unknown>
  signature: string
  kid: string
  alg: string
  signedAt: string
}

function stringValue(value: unknown) {
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
    return parseLicenseToken(JSON.parse(value) as unknown)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, message: 'licenseToken is required' })
  }

  const token = value as Partial<LicenseToken>
  if (!token.payload || typeof token.payload !== 'object' || Array.isArray(token.payload)) {
    throw createError({ statusCode: 400, message: 'licenseToken.payload is required' })
  }

  return {
    schemaVersion: stringValue(token.schemaVersion),
    payload: token.payload as Record<string, unknown>,
    signature: stringValue(token.signature),
    kid: stringValue(token.kid),
    alg: stringValue(token.alg),
    signedAt: stringValue(token.signedAt)
  }
}

function requireValidLicense(input: {
  event: H3Event
  licenseToken: LicenseToken
  requestedAppCode: string
  requestedDeploymentCode: string
}) {
  const config = loadPlatformRuntimeConfig(input.event)
  const token = input.licenseToken
  if (token.schemaVersion !== 'license-token.v1') {
    throw createError({ statusCode: 400, message: `unsupported license token schema: ${token.schemaVersion}` })
  }
  if (token.alg !== 'Ed25519') {
    throw createError({ statusCode: 400, message: `unsupported license alg: ${token.alg}` })
  }
  if (token.kid !== config.signingKid) {
    throw createError({ statusCode: 403, message: `license kid mismatch: ${token.kid} !== ${config.signingKid}` })
  }

  const payload = token.payload
  const tenantCode = stringValue(payload.tenantCode)
  const appCode = stringValue(payload.appCode)
  const deploymentCode = stringValue(payload.deploymentCode)
  const expiresAt = stringValue(payload.expiresAt)

  if (tenantCode !== config.tenantCode) {
    throw createError({ statusCode: 403, message: `license tenantCode mismatch: ${tenantCode} !== ${config.tenantCode}` })
  }
  if (input.requestedAppCode && appCode !== input.requestedAppCode) {
    throw createError({ statusCode: 403, message: `license appCode mismatch: ${appCode} !== ${input.requestedAppCode}` })
  }
  if (input.requestedDeploymentCode && deploymentCode !== input.requestedDeploymentCode) {
    throw createError({ statusCode: 403, message: `license deploymentCode mismatch: ${deploymentCode} !== ${input.requestedDeploymentCode}` })
  }
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    throw createError({ statusCode: 403, message: `license expired: ${expiresAt}` })
  }

  const verified = verifySignature({
    payload: JSON.stringify(payload),
    signature: token.signature,
    publicKeyPem: config.signingPubkey
  })
  if (!verified) {
    throw createError({ statusCode: 403, message: 'license signature verification failed' })
  }

  return {
    appCode,
    deploymentCode
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown> | null>(event).catch(() => null)
  const licenseToken = parseLicenseToken(body?.licenseToken)
  const requestedAppCode = stringValue(body?.appCode || licenseToken.payload.appCode)
  const requestedDeploymentCode = stringValue(body?.deploymentCode || licenseToken.payload.deploymentCode)
  const license = requireValidLicense({
    event,
    licenseToken,
    requestedAppCode,
    requestedDeploymentCode
  })

  try {
    const serviceClient = await consumeBootstrapAccessKey({
      event,
      appCode: license.appCode,
      deploymentCode: license.deploymentCode,
      accessKey: body?.accessKey,
      audience: body?.audience,
      scope: body?.scope
    })
    const token = await issueServiceAccessToken({
      event,
      audience: stringValue(body?.audience),
      scope: serviceClient.scope,
      serviceClient
    })

    await writeTokenEvent(event, {
      eventType: 'issue_service',
      clientId: serviceClient.clientId,
      uid: null,
      sessionHash: null,
      result: 'success'
    })

    setHeader(event, 'Cache-Control', 'no-store')
    return {
      access_token: token.accessToken,
      token_type: token.tokenType,
      expires_in: token.expiresIn,
      scope: serviceClient.scope
    }
  } catch (error) {
    await writeTokenEvent(event, {
      eventType: 'issue_service',
      clientId: null,
      tokenHash: body?.accessKey ? hashOpaqueValue(stringValue(body.accessKey)) : null,
      result: 'failed',
      failureReason: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined)
    throw error
  }
})

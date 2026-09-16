import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'
import { dataRuntimeReleaseSettings } from '~~/server/utils/dataRuntimeRelease'
import {
  dataRuntimeSettings,
  normalizeDeploymentEnvironment,
  parseTenantSettings,
  tenantGatewaySettings,
  tenantPublicUrl
} from '~~/server/utils/tenantDeploymentSettings'
import { issueTenantRuntimeEnrollment, TENANT_RUNTIME_APPS } from '~~/server/utils/tenantRuntimeEnrollment'
import { sign } from '~~/server/utils/platformSigning'

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function installCommand(input: {
  tenantCode: string
  runtimeCode: string
  enrollmentCode: string
  platformBaseUrl: string
  packageBaseUrl: string
  approvedVersion: string
  releaseSigningKeyId: string
  jwtIssuer: string
  enabledApps: Set<string>
  deploymentBindings: Record<string, string>
  runtimeEndpoint: string | null
  consoleBaseUrl: string
  directoryConnectorEnrollmentToken: string
  platformSigningKid: string
  platformSigningPublicKey: string
}) {
  const installerBase = `${input.packageBaseUrl}/${input.approvedVersion}`
  const releasePublicKeyUrl = `${input.platformBaseUrl}/api/v1/runtime/release-public-key`
  const bindingsBase64 = Buffer.from(JSON.stringify(input.deploymentBindings)).toString('base64')
  const appFlagLines = TENANT_RUNTIME_APPS.map((app) => {
    const enabled = input.enabledApps.has(app.appCode) ? 'true' : 'false'
    return `    HZY_${app.envPrefix}_AGENT_ENABLED=${enabled} \\`
  })

  return [
    '(',
    'set -eu',
    'HZY_INSTALL_TMP="$(mktemp -d)"',
    'trap \'rm -rf "$HZY_INSTALL_TMP"\' EXIT',
    `curl -fL --retry 3 --output "$HZY_INSTALL_TMP/release-signing-public.pem" ${shellQuote(releasePublicKeyUrl)}`,
    'if command -v sha256sum >/dev/null 2>&1; then',
    '  HZY_RELEASE_KEY_ID="$(openssl pkey -pubin -in "$HZY_INSTALL_TMP/release-signing-public.pem" -outform DER | sha256sum | awk \'{print $1}\')"',
    'else',
    '  HZY_RELEASE_KEY_ID="$(openssl pkey -pubin -in "$HZY_INSTALL_TMP/release-signing-public.pem" -outform DER | shasum -a 256 | awk \'{print $1}\')"',
    'fi',
    `[ "$HZY_RELEASE_KEY_ID" = ${shellQuote(input.releaseSigningKeyId)} ] || { echo 'release signing key fingerprint mismatch' >&2; exit 1; }`,
    `curl -fL --retry 3 --output "$HZY_INSTALL_TMP/install.sh" ${shellQuote(`${installerBase}/install.sh`)}`,
    `curl -fL --retry 3 --output "$HZY_INSTALL_TMP/install.sh.sig" ${shellQuote(`${installerBase}/install.sh.sig`)}`,
    'openssl pkeyutl -verify -rawin -pubin -inkey "$HZY_INSTALL_TMP/release-signing-public.pem" -in "$HZY_INSTALL_TMP/install.sh" -sigfile "$HZY_INSTALL_TMP/install.sh.sig"',
    'sudo env \\',
    `    HZY_DATA_RUNTIME_TENANT=${shellQuote(input.tenantCode)} \\`,
    `    HZY_DATA_RUNTIME_DEPLOYMENT=${shellQuote(input.runtimeCode)} \\`,
    `    HZY_DATA_RUNTIME_INSTANCE=${shellQuote(input.runtimeCode)} \\`,
    `    HZY_DATA_RUNTIME_PLATFORM_URL=${shellQuote(input.platformBaseUrl)} \\`,
    `    HZY_DATA_RUNTIME_ENROLLMENT_CODE=${shellQuote(input.enrollmentCode)} \\`,
    `    HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64=${shellQuote(bindingsBase64)} \\`,
    `    HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_ID=${shellQuote(input.releaseSigningKeyId)} \\`,
    `    HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_ID=${shellQuote(input.platformSigningKid)} \\`,
    `    HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_PEM_BASE64=${shellQuote(Buffer.from(input.platformSigningPublicKey).toString('base64'))} \\`,
    `    HZY_DATA_RUNTIME_AUTH_MODE=${shellQuote('jwt')} \\`,
    `    HZY_DATA_RUNTIME_JWT_ISSUER=${shellQuote(input.jwtIssuer)} \\`,
    `    HZY_DATA_RUNTIME_JWKS_URL=${shellQuote(`${input.jwtIssuer}/.well-known/jwks.json`)} \\`,
    `    HZY_DIRECTORY_CONNECTOR_ENABLED=${shellQuote('true')} \\`,
    `    HZY_DIRECTORY_RUNTIME_ENABLED=${shellQuote('true')} \\`,
    `    HZY_DIRECTORY_CONNECTOR_CONSOLE_URL=${shellQuote(input.consoleBaseUrl)} \\`,
    `    HZY_DIRECTORY_CONNECTOR_ENROLLMENT_TOKEN=${shellQuote(input.directoryConnectorEnrollmentToken)} \\`,
    `    HZY_CONSOLE_RUNTIME_ENABLED=${shellQuote('true')} \\`,
    ...(input.runtimeEndpoint ? [`    HZY_DATA_RUNTIME_PUBLIC_ENDPOINT=${shellQuote(input.runtimeEndpoint)} \\`] : []),
    ...appFlagLines,
    `    bash "$HZY_INSTALL_TMP/install.sh" --release-public-key "$HZY_INSTALL_TMP/release-signing-public.pem" --version ${shellQuote(input.approvedVersion)} --update-version ${shellQuote(input.approvedVersion)}`,
    ')'
  ].join('\n')
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const tenantCode = String(event.context.platformTenantCode || '').trim()
  const membership = event.context.platformTenantMembership
  if (!tenantCode) {
    throw createError({ statusCode: 400, message: 'tenant context is missing' })
  }
  if (!membership?.isOwner) {
    throw createError({ statusCode: 403, message: 'only tenant owner can generate tenant runtime install command' })
  }

  const body = await readBody<Record<string, unknown> | null>(event).catch(() => null)
  const environment = normalizeDeploymentEnvironment(body?.environment || getQuery(event).environment)
  const release = await dataRuntimeReleaseSettings()
  const platformBaseUrl = String(useRuntimeConfig(event).public?.serviceUrl || getRequestURL(event).origin).trim().replace(/\/+$/, '')
  const tenant = await queryRow<RowDataPacket & { settings_json: unknown }>(
    'SELECT settings_json FROM tenants WHERE tenant_code = ? LIMIT 1',
    [tenantCode]
  )
  const parsedSettings = parseTenantSettings(tenant?.settings_json)
  const runtimeEndpoint = dataRuntimeSettings(parsedSettings, environment).defaultEndpoint || null
  const gateway = tenantGatewaySettings(parsedSettings, environment)
  if (!gateway.subdomain) {
    throw createError({ statusCode: 409, message: 'tenant gateway subdomain is required for Directory Connector enrollment' })
  }
  const consoleDeployment = await queryRow<RowDataPacket & { deployment_code: string }>(
    `SELECT deployment_code FROM deployments
      WHERE tenant_code=? AND environment=? AND app_code='console' AND status='active'
      ORDER BY id DESC LIMIT 1`,
    [tenantCode, environment]
  )
  if (!consoleDeployment?.deployment_code) {
    throw createError({ statusCode: 409, message: 'active Console deployment is required for Directory Connector enrollment' })
  }
  const enrollment = await issueTenantRuntimeEnrollment({
    tenantCode,
    environment,
    desiredVersion: release.approvedVersion,
    releaseSigningKeyId: release.releaseSigningKeyId,
    runtimeEndpoint,
    ttlSeconds: release.enrollmentTtlSeconds
  })
  const connectorPayload = {
    jti: randomUUID(),
    tenantCode,
    deploymentCode: consoleDeployment.deployment_code,
    runtimeCode: enrollment.runtimeCode,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + release.enrollmentTtlSeconds * 1000).toISOString()
  }
  const connectorSignature = await sign(JSON.stringify(connectorPayload))
  const directoryConnectorEnrollmentToken = JSON.stringify({
    schemaVersion: 'directory-connector-enrollment.v1',
    payload: connectorPayload,
    signature: connectorSignature.signature,
    kid: connectorSignature.kid,
    alg: connectorSignature.alg,
    signedAt: new Date().toISOString()
  })
  const consoleIssuer = tenantPublicUrl(gateway.subdomain)
  const consoleBaseUrl = `${consoleIssuer}/directory-connector`

  return ok({
    tenantCode,
    environment,
    runtimeCode: enrollment.runtimeCode,
    enrollmentCodeLast4: enrollment.codeLast4,
    expiresInSeconds: release.enrollmentTtlSeconds,
    desiredVersion: release.approvedVersion,
    releaseSigningKeyId: release.releaseSigningKeyId,
    enabledApps: ['console', ...enrollment.enabledApps],
    command: installCommand({
      tenantCode,
      runtimeCode: enrollment.runtimeCode,
      enrollmentCode: enrollment.code,
      platformBaseUrl,
      packageBaseUrl: release.packageBaseUrl,
      approvedVersion: release.approvedVersion,
      releaseSigningKeyId: release.releaseSigningKeyId,
      jwtIssuer: consoleIssuer,
      enabledApps: new Set(enrollment.enabledApps),
      deploymentBindings: enrollment.deploymentBindings,
      runtimeEndpoint,
      consoleBaseUrl,
      directoryConnectorEnrollmentToken,
      platformSigningKid: connectorSignature.kid,
      platformSigningPublicKey: connectorSignature.publicKey
    })
  })
})

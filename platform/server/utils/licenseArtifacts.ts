import { createHash } from 'node:crypto'
import { exportPubkey, sign } from '~~/server/utils/platformSigning'

export interface LicenseCapabilityPayload {
  capabilityCode: string
  capabilityValue: string | null
}

export interface LicensePayloadInput {
  licenseCode: string
  tenantCode: string
  planCode: string
  appCode: string
  deploymentId: number
  deploymentCode: string
  issuedAt: string
  expiresAt?: string | null
  graceUntil?: string | null
  capabilities?: LicenseCapabilityPayload[]
  vault?: {
    masterKeyRequired: boolean
    masterKeyFingerprint: string
    algorithm: string
  } | null
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function escapeEnvValue(value: string) {
  if (!value) return ''
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value
  return JSON.stringify(value)
}

export function normalizeLicenseCapabilities(capabilities: unknown[]): LicenseCapabilityPayload[] {
  return capabilities
    .filter(capability => capability && typeof capability === 'object')
    .map((capability) => {
      const record = capability as Record<string, unknown>
      const capabilityCode = String(record.capabilityCode || record.capability_code || '').trim()
      if (!capabilityCode) return null

      const rawValue = record.capabilityValue ?? record.capability_value
      return {
        capabilityCode,
        capabilityValue: rawValue == null ? null : String(rawValue)
      }
    })
    .filter((capability): capability is LicenseCapabilityPayload => capability !== null)
}

export function buildLicensePayload(input: LicensePayloadInput) {
  return {
    schemaVersion: 'license.v1',
    licenseCode: input.licenseCode,
    tenantCode: input.tenantCode,
    planCode: input.planCode,
    appCode: input.appCode,
    deploymentId: input.deploymentId,
    deploymentCode: input.deploymentCode,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt || null,
    graceUntil: input.graceUntil || null,
    capabilities: input.capabilities || [],
    ...(input.vault ? { vault: input.vault } : {})
  }
}

export function hashLicensePayload(payload: unknown) {
  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`
}

export async function buildSignedLicenseToken(payload: Record<string, unknown>) {
  const serialized = JSON.stringify(payload)
  const signed = await sign(serialized)

  return {
    token: JSON.stringify({
      schemaVersion: 'license-token.v1',
      payload,
      signature: signed.signature,
      kid: signed.kid,
      alg: signed.alg,
      signedAt: nowSql()
    }),
    kid: signed.kid,
    alg: signed.alg
  }
}

export async function buildAppEnvArtifact(input: {
  tenantCode: string
  appCode: string
  deploymentCode: string
  environment?: string | null
  runtimeToken?: string | null
  licenseToken?: string | null
  platformBaseUrl: string
  deploymentPublicUrl?: string | null
  appBasePath?: string | null
  consoleVaultMasterKey?: string | null
}) {
  const pubkey = await exportPubkey()

  const lines = [
    `HZY_PLATFORM_URL=${escapeEnvValue(input.platformBaseUrl)}`,
    `HZY_PLATFORM_TENANT_CODE=${escapeEnvValue(input.tenantCode)}`,
    `HZY_PLATFORM_DEPLOYMENT_CODE=${escapeEnvValue(input.deploymentCode)}`,
    `HZY_DEPLOYMENT_ENVIRONMENT=${escapeEnvValue(input.environment || 'prod')}`,
    `HZY_PLATFORM_RUNTIME_TOKEN=${escapeEnvValue(input.runtimeToken || '<rotate-runtime-token-to-display>')}`,
    `HZY_PLATFORM_SIGNING_KID=${escapeEnvValue(pubkey.kid)}`,
    `HZY_PLATFORM_SIGNING_PUBKEY=${escapeEnvValue(pubkey.publicKey)}`,
    `HZY_DEPLOYMENT_PUBLIC_URL=${escapeEnvValue(input.deploymentPublicUrl || '<deployment-public-url>')}`,
    `HZY_APP_BASE_PATH=${escapeEnvValue(input.appBasePath || `/${input.appCode}/`)}`,
    `NUXT_APP_BASE_URL=${escapeEnvValue(input.appBasePath || `/${input.appCode}/`)}`
  ]

  if (input.licenseToken || input.appCode === 'console') {
    lines.splice(7, 0, `HZY_PLATFORM_LICENSE_TOKEN=${escapeEnvValue(input.licenseToken || '<platform-license-token>')}`)
  }

  if (input.consoleVaultMasterKey) {
    lines.push(`HZY_CONSOLE_VAULT_MASTER_KEY=${escapeEnvValue(input.consoleVaultMasterKey)}`)
  }

  return lines.join('\n')
}

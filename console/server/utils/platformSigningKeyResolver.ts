export interface PlatformSigningKeyResolverConfig {
  activationMode: string
  baseUrl: string
  platformServiceToken: string
  signingKid: string
  signingPubkey: string
}

export interface PlatformSigningKeyMaterial {
  kid: string
  alg: string
  publicKey: string
  source: 'configured' | 'platform-internal'
}

interface PlatformSigningKeyEnvelope {
  success?: boolean
  code?: number
  data?: {
    kid?: string | null
    alg?: string | null
    publicKey?: string | null
    status?: string | null
    revokedAt?: string | null
  } | null
}

const TRUSTED_PLATFORM_SIGNING_KEY_STATUSES = new Set(['active', 'rotated'])

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function normalizePem(value: string) {
  return value.replace(/\\n/g, '\n')
}

function isSuccessfulEnvelope(envelope: PlatformSigningKeyEnvelope) {
  return envelope.success === true || envelope.code === 0
}

export function resolveConfiguredPlatformBundleSigningKey(
  config: PlatformSigningKeyResolverConfig,
  kid: string
): PlatformSigningKeyMaterial | null {
  const normalizedKid = normalizeString(kid)
  if (!normalizedKid || normalizedKid !== normalizeString(config.signingKid)) {
    return null
  }

  return {
    kid: normalizedKid,
    alg: 'Ed25519',
    publicKey: normalizePem(config.signingPubkey),
    source: 'configured'
  }
}

export function normalizePlatformSigningKeyEnvelope(
  envelope: PlatformSigningKeyEnvelope,
  expectedKid: string
): PlatformSigningKeyMaterial {
  if (!isSuccessfulEnvelope(envelope) || !envelope.data) {
    throw new Error('platform signing key response is invalid')
  }

  const key = envelope.data
  const kid = normalizeString(key.kid)
  if (!kid || kid !== expectedKid) {
    throw new Error(`platform signing key kid mismatch: ${kid || '<empty>'} !== ${expectedKid}`)
  }

  const alg = normalizeString(key.alg)
  if (alg !== 'Ed25519') {
    throw new Error(`unsupported platform signing key alg: ${alg || '<empty>'}`)
  }

  const status = normalizeString(key.status)
  if (!TRUSTED_PLATFORM_SIGNING_KEY_STATUSES.has(status) || normalizeString(key.revokedAt)) {
    throw new Error(`platform signing key is not trusted: kid=${kid}, status=${status || '<empty>'}`)
  }

  const publicKey = normalizePem(normalizeString(key.publicKey))
  if (!publicKey) {
    throw new Error(`platform signing key public key is missing: kid=${kid}`)
  }

  return {
    kid,
    alg,
    publicKey,
    source: 'platform-internal'
  }
}

async function fetchPlatformSigningKey(
  config: PlatformSigningKeyResolverConfig,
  kid: string
) {
  return await $fetch<PlatformSigningKeyEnvelope>(
    `${config.baseUrl}/api/platform/internal/signing-keys/${encodeURIComponent(kid)}`,
    {
      headers: {
        'Authorization': `Bearer ${config.platformServiceToken}`,
        'x-hzy-internal-principal': 'console-managed-cloud-worker'
      },
      timeout: 5000
    }
  )
}

export async function resolvePlatformBundleSigningKey(
  config: PlatformSigningKeyResolverConfig,
  kid: string
): Promise<PlatformSigningKeyMaterial> {
  const normalizedKid = normalizeString(kid)
  const configured = resolveConfiguredPlatformBundleSigningKey(config, normalizedKid)
  if (configured) {
    return configured
  }

  if (config.activationMode !== 'managed-cloud-multitenant' || !config.platformServiceToken) {
    throw new Error(`bundle kid mismatch: ${normalizedKid} !== ${normalizeString(config.signingKid)}`)
  }

  try {
    const envelope = await fetchPlatformSigningKey(config, normalizedKid)
    return normalizePlatformSigningKeyEnvelope(envelope, normalizedKid)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `bundle signing key unavailable: kid=${normalizedKid}, configuredKid=${normalizeString(config.signingKid)}; ${message}`
    )
  }
}

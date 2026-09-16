import { createHash, createPublicKey } from 'node:crypto'

export const DATA_RUNTIME_SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/

type CloudflareRuntimeEnv = Record<string, unknown>

type CloudflareRuntimeEvent = {
  context?: {
    cloudflare?: { env?: CloudflareRuntimeEnv }
    _platform?: { cloudflare?: { env?: CloudflareRuntimeEnv } }
    nitro?: { env?: CloudflareRuntimeEnv }
  }
  req?: { runtime?: { cloudflare?: { env?: CloudflareRuntimeEnv } } }
}

function envValue(env: CloudflareRuntimeEnv | undefined, name: string) {
  const value = env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

function requestCloudflareEnvValue(name: string) {
  try {
    const event = useRequestEvent() as unknown as CloudflareRuntimeEvent | undefined
    const env = event?.context?.cloudflare?.env
      || event?.context?._platform?.cloudflare?.env
      || event?.context?.nitro?.env
      || event?.req?.runtime?.cloudflare?.env
    return envValue(env, name)
  } catch {
    return ''
  }
}

function runtimeValue(configured: unknown, name: string) {
  return requestCloudflareEnvValue(name)
    || envValue(globalThis.__hzyCloudflareEnv as CloudflareRuntimeEnv | undefined, name)
    || String(process.env[name] || '').trim()
    || String(configured || '').trim()
}

function normalizedPem(value: unknown) {
  const raw = String(value || '').trim()
  if (raw.startsWith('base64:')) {
    return Buffer.from(raw.slice('base64:'.length), 'base64').toString('utf8').trim()
  }
  return raw.replace(/\\n/g, '\n')
}

function normalizeBaseUrl(value: unknown) {
  const raw = String(value || '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  const parsed = new URL(raw)
  if (parsed.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:')) {
    throw createError({ statusCode: 503, message: 'data runtime package base URL must use HTTPS' })
  }
  return parsed.toString().replace(/\/+$/, '')
}

export function resolveDataRuntimeReleaseTarget(input: {
  enrolledDesiredVersion: string
  enrolledSigningKeyId: string
  approvedVersion: string
  approvedSigningKeyId: string
  allowDowngrade?: boolean
}) {
  const enrolledDesiredVersion = String(input.enrolledDesiredVersion || '').trim()
  const enrolledSigningKeyId = String(input.enrolledSigningKeyId || '').trim()
  const approvedVersion = String(input.approvedVersion || '').trim()
  const approvedSigningKeyId = String(input.approvedSigningKeyId || '').trim()

  // Version promotion is safe to reconcile automatically only while the
  // enrolled Agent trusts the same release key. Key rotation remains an
  // explicit re-enrollment operation so a heartbeat can never replace the
  // instance trust anchor implicitly.
  if (!enrolledSigningKeyId || enrolledSigningKeyId !== approvedSigningKeyId) {
    return {
      desiredVersion: enrolledDesiredVersion,
      signingKeyId: enrolledSigningKeyId,
      changed: false,
      signingKeyCompatible: false,
      downgradeBlocked: false
    }
  }

  const downgradeBlocked = DATA_RUNTIME_SEMVER_PATTERN.test(approvedVersion)
    && DATA_RUNTIME_SEMVER_PATTERN.test(enrolledDesiredVersion)
    && compareDataRuntimeVersions(approvedVersion, enrolledDesiredVersion) < 0
    && input.allowDowngrade !== true

  if (downgradeBlocked) {
    return {
      desiredVersion: enrolledDesiredVersion,
      signingKeyId: enrolledSigningKeyId,
      changed: false,
      signingKeyCompatible: true,
      downgradeBlocked: true
    }
  }

  return {
    desiredVersion: approvedVersion,
    signingKeyId: enrolledSigningKeyId,
    changed: enrolledDesiredVersion !== approvedVersion,
    signingKeyCompatible: true,
    downgradeBlocked: false
  }
}

function parseVersion(value: string) {
  const [core = '', prerelease = ''] = value.split('-', 2)
  const coreParts = core.split('.').map(part => Number(part))
  return { coreParts, prerelease: prerelease ? prerelease.split('.') : [] }
}

export function compareDataRuntimeVersions(left: string, right: string) {
  if (!DATA_RUNTIME_SEMVER_PATTERN.test(left) || !DATA_RUNTIME_SEMVER_PATTERN.test(right)) {
    throw new Error('data runtime versions must be exact semantic versions')
  }

  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.coreParts[index] || 0) - (b.coreParts[index] || 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }

  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0
    return a.prerelease.length === 0 ? 1 : -1
  }

  const identifiers = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < identifiers; index += 1) {
    const leftIdentifier = a.prerelease[index]
    const rightIdentifier = b.prerelease[index]
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1
    }
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) {
      return Number(leftIdentifier) < Number(rightIdentifier) ? -1 : 1
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }

  return 0
}

export function dataRuntimeReleaseStaticSettings() {
  const config = useRuntimeConfig().dataRuntimeRelease || {}
  const releasePublicKeyPem = normalizedPem(runtimeValue(config.releasePublicKeyPem, 'HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_PEM'))
  if (!releasePublicKeyPem) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_PEM is required'
    })
  }

  let publicKeyDer: Buffer
  try {
    const publicKey = createPublicKey(releasePublicKeyPem)
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519')
    publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  } catch {
    throw createError({ statusCode: 503, message: 'configured data runtime release public key is invalid' })
  }

  const enrollmentTtlSeconds = Math.min(3600, Math.max(300, Number(runtimeValue(config.enrollmentTtlSeconds, 'HZY_DATA_RUNTIME_ENROLLMENT_TTL_SECONDS') || 900)))
  const jwtIssuer = normalizeBaseUrl(runtimeValue(config.jwtIssuer, 'HZY_DATA_RUNTIME_JWT_ISSUER'))
  if (!jwtIssuer) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'HZY_DATA_RUNTIME_JWT_ISSUER is required'
    })
  }
  return {
    bootstrapApprovedVersion: runtimeValue(config.approvedVersion, 'HZY_DATA_RUNTIME_APPROVED_VERSION'),
    packageBaseUrl: normalizeBaseUrl(runtimeValue(config.packageBaseUrl, 'HZY_DATA_RUNTIME_PACKAGE_BASE_URL')),
    releasePublicKeyPem,
    releaseSigningKeyId: createHash('sha256').update(publicKeyDer).digest('hex'),
    enrollmentTtlSeconds,
    jwtIssuer
  }
}

async function approvedReleaseFromRegistry() {
  const registry = await import('~~/server/utils/dataRuntimeReleaseRegistry')
  return await registry.queryApprovedDataRuntimeRelease()
}

export async function dataRuntimeReleaseSettings() {
  const settings = dataRuntimeReleaseStaticSettings()
  const approvedRelease = await approvedReleaseFromRegistry()
  if (approvedRelease && approvedRelease.release_signing_key_id !== settings.releaseSigningKeyId) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'The approved Data Runtime release does not match the current Platform release trust anchor'
    })
  }
  const approvedVersion = String(approvedRelease?.release_version || settings.bootstrapApprovedVersion || '').trim()
  if (!DATA_RUNTIME_SEMVER_PATTERN.test(approvedVersion)) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Approve a Data Runtime release in Platform Admin before enrolling or updating runtimes'
    })
  }

  return {
    ...settings,
    approvedVersion,
    approvalKind: approvedRelease?.approval_kind || 'bootstrap',
    approvedAt: approvedRelease?.approved_at || null,
    approvedSource: approvedRelease ? 'registry' as const : 'bootstrap' as const,
    allowDowngrade: approvedRelease?.approval_kind === 'rollback'
  }
}

import { createHash, verify } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { DATA_RUNTIME_SEMVER_PATTERN } from '~~/server/utils/dataRuntimeRelease'
import { queryRow, queryRows, withTransaction } from '~~/server/utils/db'

const RUNTIME_CODE = 'hzy-data-runtime'
const STABLE_CHANNEL = 'stable'
const MAX_MANIFEST_BYTES = 128 * 1024
const MAX_SIGNATURE_BYTES = 8 * 1024

interface ApprovedReleaseRow extends RowDataPacket {
  release_version: string
  release_signing_key_id: string
  approval_kind: string
  approved_at: string
}

interface RuntimeReleaseRow extends RowDataPacket {
  id: number
  release_version: string
  commit_sha: string
  built_at: string
  manifest_hash: string
  manifest_json: unknown
  release_signing_key_id: string
  package_base_url: string
  status: string
  discovered_at: string
  approved_at: string | null
  approval_kind: string | null
  approval_note: string | null
}

interface ReleaseIdRow extends RowDataPacket {
  id: number
  release_version: string
  release_signing_key_id: string
}

interface CountRow extends RowDataPacket { total: number }
interface ApprovedAtRow extends RowDataPacket { approved_at: string }

export interface DataRuntimeReleaseManifest {
  name: string
  version: string
  commit: string
  builtAt: string
  installer: {
    path: string
    sha256: string
    signaturePath: string
  }
  signature: {
    algorithm: string
    keyId: string
    path: string
  }
  platforms: Array<{ os: string, arch: string }>
  artifacts: Array<{
    os: string
    arch: string
    path: string
    sha256: string
    signaturePath: string
  }>
}

export interface VerifiedDataRuntimeRelease {
  version: string
  commit: string
  builtAt: string
  manifestHash: string
  manifest: DataRuntimeReleaseManifest
  releaseSigningKeyId: string
  packageBaseUrl: string
}

export interface DataRuntimeReleaseAuditContext {
  accountId: number | null
  ip: string | null
  userAgent: string | null
}

function isMissingRegistryTable(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_NO_SUCH_TABLE')
}

function registryMigrationError() {
  return createError({
    statusCode: 503,
    statusMessage: 'Service Unavailable',
    message: 'Data Runtime release registry migration is missing; apply HZY-Platform-SQL-Migration-v2.28-data-runtime-release-registry.sql'
  })
}

function requireSha256(value: unknown, field: string) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw createError({ statusCode: 422, message: `${field} must be a SHA-256 digest` })
  }
  return normalized
}

function parseManifest(raw: string, expectedVersion: string, approvedKeyId: string) {
  let manifest: DataRuntimeReleaseManifest
  try {
    manifest = JSON.parse(raw) as DataRuntimeReleaseManifest
  } catch {
    throw createError({ statusCode: 422, message: 'Data Runtime release manifest is not valid JSON' })
  }

  if (manifest.name !== RUNTIME_CODE || !DATA_RUNTIME_SEMVER_PATTERN.test(String(manifest.version || ''))) {
    throw createError({ statusCode: 422, message: 'Data Runtime release manifest identity or version is invalid' })
  }
  if (expectedVersion !== 'latest' && manifest.version !== expectedVersion) {
    throw createError({ statusCode: 409, message: `Release manifest version mismatch: expected ${expectedVersion}, got ${manifest.version}` })
  }
  if (!String(manifest.commit || '').trim() || Number.isNaN(new Date(manifest.builtAt).getTime())) {
    throw createError({ statusCode: 422, message: 'Data Runtime release manifest build metadata is invalid' })
  }
  if (
    manifest.signature?.algorithm !== 'Ed25519'
    || manifest.signature?.path !== 'manifest.json.sig'
    || requireSha256(manifest.signature?.keyId, 'signature.keyId') !== approvedKeyId
  ) {
    throw createError({ statusCode: 409, message: 'Data Runtime release signing key does not match the Platform trust anchor' })
  }

  requireSha256(manifest.installer?.sha256, 'installer.sha256')
  if (manifest.installer?.path !== 'install.sh' || manifest.installer?.signaturePath !== 'install.sh.sig') {
    throw createError({ statusCode: 422, message: 'Data Runtime installer metadata is invalid' })
  }

  const supportedPlatforms = new Set((manifest.artifacts || []).map(item => `${item.os}/${item.arch}`))
  for (const required of ['linux/amd64', 'linux/arm64']) {
    if (!supportedPlatforms.has(required)) {
      throw createError({ statusCode: 422, message: `Data Runtime release is missing required artifact ${required}` })
    }
  }
  for (const artifact of manifest.artifacts || []) {
    requireSha256(artifact.sha256, `artifact ${artifact.os}/${artifact.arch} sha256`)
    if (!artifact.path || artifact.signaturePath !== `${artifact.path}.sig`) {
      throw createError({ statusCode: 422, message: `Data Runtime artifact metadata is invalid for ${artifact.os}/${artifact.arch}` })
    }
  }

  return manifest
}

async function fetchReleaseFile(url: string, maxBytes: number) {
  const response = await fetch(url, {
    headers: { accept: 'application/octet-stream' },
    signal: AbortSignal.timeout(12_000)
  })
  if (!response.ok) {
    throw createError({ statusCode: 502, message: `Data Runtime release source returned HTTP ${response.status}` })
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw createError({ statusCode: 502, message: 'Data Runtime release source returned an invalid payload size' })
  }
  return bytes
}

export async function fetchVerifiedDataRuntimeRelease(input: {
  version: string
  packageBaseUrl: string
  releasePublicKeyPem: string
  releaseSigningKeyId: string
}): Promise<VerifiedDataRuntimeRelease> {
  const version = String(input.version || '').trim()
  if (version !== 'latest' && !DATA_RUNTIME_SEMVER_PATTERN.test(version)) {
    throw createError({ statusCode: 400, message: 'version must be latest or an exact semantic version' })
  }
  if (!input.packageBaseUrl) {
    throw createError({ statusCode: 503, message: 'Data Runtime package base URL is not configured' })
  }

  const releaseBaseUrl = `${input.packageBaseUrl}/${encodeURIComponent(version)}`
  const [manifestBytes, signatureBytes] = await Promise.all([
    fetchReleaseFile(`${releaseBaseUrl}/manifest.json`, MAX_MANIFEST_BYTES),
    fetchReleaseFile(`${releaseBaseUrl}/manifest.json.sig`, MAX_SIGNATURE_BYTES)
  ])
  if (!verify(null, manifestBytes, input.releasePublicKeyPem, signatureBytes)) {
    throw createError({ statusCode: 409, message: 'Data Runtime release manifest signature verification failed' })
  }

  const manifestText = manifestBytes.toString('utf8')
  const manifest = parseManifest(manifestText, version, input.releaseSigningKeyId)
  return {
    version: manifest.version,
    commit: manifest.commit.trim(),
    builtAt: new Date(manifest.builtAt).toISOString(),
    manifestHash: createHash('sha256').update(manifestBytes).digest('hex'),
    manifest,
    releaseSigningKeyId: manifest.signature.keyId,
    packageBaseUrl: input.packageBaseUrl
  }
}

export async function queryApprovedDataRuntimeRelease() {
  try {
    return await queryRow<ApprovedReleaseRow>(
      `SELECT r.release_version, r.release_signing_key_id, c.approval_kind, c.approved_at
       FROM platform_runtime_release_channels c
       INNER JOIN platform_runtime_releases r ON r.id = c.approved_release_id
       WHERE c.runtime_code = ?
         AND c.channel_code = ?
       LIMIT 1`,
      [RUNTIME_CODE, STABLE_CHANNEL]
    )
  } catch (error) {
    if (isMissingRegistryTable(error)) return null
    throw error
  }
}

function parseStoredManifest(value: unknown) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as DataRuntimeReleaseManifest
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' ? value as DataRuntimeReleaseManifest : null
}

function mapRelease(row: RuntimeReleaseRow) {
  return {
    id: Number(row.id),
    version: row.release_version,
    commit: row.commit_sha,
    builtAt: row.built_at,
    manifestHash: row.manifest_hash,
    manifest: parseStoredManifest(row.manifest_json),
    releaseSigningKeyId: row.release_signing_key_id,
    packageBaseUrl: row.package_base_url,
    status: row.status,
    discoveredAt: row.discovered_at,
    approvedAt: row.approved_at,
    approvalKind: row.approval_kind,
    approvalNote: row.approval_note,
    approved: Boolean(row.approved_at)
  }
}

const RELEASE_SELECT = `SELECT r.id, r.release_version, r.commit_sha, r.built_at, r.manifest_hash,
                               r.manifest_json, r.release_signing_key_id, r.package_base_url,
                               r.status, r.discovered_at,
                               CASE WHEN c.approved_release_id = r.id THEN c.approved_at ELSE NULL END AS approved_at,
                               CASE WHEN c.approved_release_id = r.id THEN c.approval_kind ELSE NULL END AS approval_kind,
                               CASE WHEN c.approved_release_id = r.id THEN c.approval_note ELSE NULL END AS approval_note
                        FROM platform_runtime_releases r
                        LEFT JOIN platform_runtime_release_channels c
                          ON c.runtime_code = r.runtime_code
                         AND c.channel_code = ?`

export async function listDataRuntimeReleases(pageSize = 20, offset = 0) {
  try {
    const rows = await queryRows<RuntimeReleaseRow[]>(
      `${RELEASE_SELECT}
       WHERE r.runtime_code = ?
       ORDER BY r.built_at DESC, r.id DESC
       LIMIT ? OFFSET ?`,
      [STABLE_CHANNEL, RUNTIME_CODE, pageSize, offset]
    )
    const count = await queryRow<CountRow>(
      'SELECT COUNT(*) AS total FROM platform_runtime_releases WHERE runtime_code = ?',
      [RUNTIME_CODE]
    )
    return { items: rows.map(mapRelease), total: Number(count?.total || 0) }
  } catch (error) {
    if (isMissingRegistryTable(error)) throw registryMigrationError()
    throw error
  }
}

async function queryDataRuntimeReleaseByVersion(version: string) {
  const row = await queryRow<RuntimeReleaseRow>(
    `${RELEASE_SELECT}
     WHERE r.runtime_code = ? AND r.release_version = ?
     LIMIT 1`,
    [STABLE_CHANNEL, RUNTIME_CODE, version]
  )
  return row ? mapRelease(row) : null
}

export async function storeDataRuntimeRelease(release: VerifiedDataRuntimeRelease, audit: DataRuntimeReleaseAuditContext) {
  try {
    await withTransaction(async (tx) => {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_runtime_releases
          (runtime_code, release_version, commit_sha, built_at, manifest_hash, manifest_json,
           release_signing_key_id, package_base_url, status, discovered_by_account_id,
           discovered_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           commit_sha = VALUES(commit_sha),
           built_at = VALUES(built_at),
           manifest_hash = VALUES(manifest_hash),
           manifest_json = VALUES(manifest_json),
           release_signing_key_id = VALUES(release_signing_key_id),
           package_base_url = VALUES(package_base_url),
           status = 'available',
           discovered_by_account_id = VALUES(discovered_by_account_id),
           discovered_at = UTC_TIMESTAMP(),
           updated_at = UTC_TIMESTAMP()`,
        [
          RUNTIME_CODE,
          release.version,
          release.commit,
          release.builtAt.slice(0, 19).replace('T', ' '),
          release.manifestHash,
          JSON.stringify(release.manifest),
          release.releaseSigningKeyId,
          release.packageBaseUrl,
          audit.accountId
        ]
      )
      await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_audit_logs
          (operator_account_id, target_type, target_id, target_tenant_code, action,
           before_json, after_json, source, ip, user_agent, created_at)
         VALUES (?, 'data_runtime_release', ?, NULL, 'runtime_release.synchronize',
                 NULL, ?, 'platform_admin', ?, ?, UTC_TIMESTAMP())`,
        [
          audit.accountId,
          release.version,
          JSON.stringify({
            version: release.version,
            commit: release.commit,
            builtAt: release.builtAt,
            manifestHash: release.manifestHash,
            releaseSigningKeyId: release.releaseSigningKeyId
          }),
          audit.ip,
          audit.userAgent
        ]
      )
    })
  } catch (error) {
    if (isMissingRegistryTable(error)) throw registryMigrationError()
    throw error
  }

  return await queryDataRuntimeReleaseByVersion(release.version)
}

export async function approveDataRuntimeRelease(input: {
  version: string
  releaseSigningKeyId: string
  accountId: number | null
  ip: string | null
  userAgent: string | null
  note: string | null
  confirmRollback: boolean
  compareVersions: (left: string, right: string) => number
}) {
  try {
    return await withTransaction(async (tx) => {
      const target = await tx.queryRow<ReleaseIdRow>(
        `SELECT id, release_version, release_signing_key_id
         FROM platform_runtime_releases
         WHERE runtime_code = ? AND release_version = ? AND status = 'available'
         LIMIT 1 FOR UPDATE`,
        [RUNTIME_CODE, input.version]
      )
      if (!target) {
        throw createError({ statusCode: 404, message: `Data Runtime release ${input.version} has not been synchronized` })
      }
      if (target.release_signing_key_id !== input.releaseSigningKeyId) {
        throw createError({ statusCode: 409, message: 'Data Runtime release signing key no longer matches the Platform trust anchor' })
      }

      const current = await tx.queryRow<ReleaseIdRow & { approval_kind: string }>(
        `SELECT r.id, r.release_version, r.release_signing_key_id, c.approval_kind
         FROM platform_runtime_release_channels c
         INNER JOIN platform_runtime_releases r ON r.id = c.approved_release_id
         WHERE c.runtime_code = ? AND c.channel_code = ?
         LIMIT 1 FOR UPDATE`,
        [RUNTIME_CODE, STABLE_CHANNEL]
      )
      const isRollback = Boolean(current && input.compareVersions(target.release_version, current.release_version) < 0)
      if (isRollback && !input.confirmRollback) {
        throw createError({
          statusCode: 409,
          message: `Approving ${target.release_version} would roll back the stable channel from ${current?.release_version}; explicit rollback confirmation is required`
        })
      }

      const approvalKind = isRollback ? 'rollback' : 'promotion'
      await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_runtime_release_channels
          (runtime_code, channel_code, approved_release_id, approval_kind,
           approved_by_account_id, approved_at, approval_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           approved_release_id = VALUES(approved_release_id),
           approval_kind = VALUES(approval_kind),
           approved_by_account_id = VALUES(approved_by_account_id),
           approved_at = UTC_TIMESTAMP(),
           approval_note = VALUES(approval_note),
           updated_at = UTC_TIMESTAMP()`,
        [RUNTIME_CODE, STABLE_CHANNEL, target.id, approvalKind, input.accountId, input.note]
      )
      const approvedChannel = await tx.queryRow<ApprovedAtRow>(
        `SELECT approved_at
         FROM platform_runtime_release_channels
         WHERE runtime_code = ? AND channel_code = ?
         LIMIT 1`,
        [RUNTIME_CODE, STABLE_CHANNEL]
      )
      if (!approvedChannel) {
        throw createError({ statusCode: 500, message: 'Data Runtime stable channel approval could not be read back' })
      }

      // The stable channel is the source of truth, but the instance row is what
      // tenant-facing screens and the Agent enrollment state read. Materialize
      // the new target in the same transaction so approval is immediately
      // visible; heartbeat remains the reconciliation path for offline Agents.
      const targetUpdate = await tx.execute<ResultSetHeader>(
        `UPDATE tenant_runtime_instances
         SET desired_version = ?,
             updated_at = UTC_TIMESTAMP()
         WHERE release_signing_key_id = ?
           AND desired_version <> ?`,
        [target.release_version, target.release_signing_key_id, target.release_version]
      )
      await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_audit_logs
          (operator_account_id, target_type, target_id, target_tenant_code, action,
           before_json, after_json, source, ip, user_agent, created_at)
         VALUES (?, 'data_runtime_release_channel', ?, NULL, ?, ?, ?, 'platform_admin', ?, ?, UTC_TIMESTAMP())`,
        [
          input.accountId,
          `${RUNTIME_CODE}:${STABLE_CHANNEL}`,
          isRollback ? 'runtime_release.rollback' : 'runtime_release.approve',
          current ? JSON.stringify({ version: current.release_version, approvalKind: current.approval_kind }) : null,
          JSON.stringify({
            version: target.release_version,
            approvalKind,
            note: input.note,
            updatedInstances: targetUpdate.affectedRows
          }),
          input.ip,
          input.userAgent
        ]
      )

      return {
        version: target.release_version,
        previousVersion: current?.release_version || null,
        approvalKind,
        approvedAt: approvedChannel.approved_at,
        isRollback,
        updatedInstances: targetUpdate.affectedRows
      }
    })
  } catch (error) {
    if (isMissingRegistryTable(error)) throw registryMigrationError()
    throw error
  }
}

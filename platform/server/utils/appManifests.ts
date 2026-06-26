import { createHash, randomBytes } from 'node:crypto'
import { createError } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { queryRow, withTransaction } from '~~/server/utils/db'
import { syncManifestResourceActions } from '~~/server/utils/appManifestResources'
import {
  materializeRecommendedRolesFromManifest,
  type ManifestRoleMaterializationResult
} from '~~/server/utils/appManifestRoles'

interface ManifestRow extends RowDataPacket {
  id: number
  app_code: string
  manifest_seq: number
  manifest_hash: string
  manifest_json: unknown
  status: string
  created_at: string
}

interface ReleaseRow extends RowDataPacket {
  id: number
  app_code: string
  release_version: string
  manifest_id: number
  status: string
  created_at: string
}

export interface RegisteredManifest {
  id: number
  tenantCode: null
  appCode: string
  manifestSeq: number
  manifestHash: string
  manifestJson: unknown
  status: string
  createdAt: string
}

export interface RegisteredRelease {
  id: number
  appCode: string
  releaseVersion: string
  manifestId: number
  status: string
  createdAt: string
}

export interface RegisterAppManifestInput {
  appCode: string
  /** GitLab release tag / 应用版本号，写入 platform_app_releases.release_version */
  releaseVersion: string
  manifestJson: Record<string, unknown>
  sourceType?: string
  sourceEndpoint?: string | null
  sourceTag?: string | null
  sourceCommitSha?: string | null
  bundleUri?: string | null
  bundleHash?: string | null
  bundleSizeBytes?: number | null
  reviewComment?: string | null
  releasedByAccountId?: number | null
}

export interface RegisterAppManifestResult {
  manifest: RegisteredManifest
  release: RegisteredRelease
  roleMaterialization: ManifestRoleMaterializationResult
}

function buildRegistrationNo() {
  return `REG-${Date.now()}-${randomBytes(4).toString('hex')}`
}

function parseManifestJson(value: unknown) {
  return typeof value === 'string' ? JSON.parse(value) : value
}

function normalizeManifestJson(manifestJson: Record<string, unknown>) {
  const normalized = { ...manifestJson }
  delete normalized.version
  delete normalized.displayVersion
  return normalized
}

function hasOwnProperty(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function normalizeNullableString(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const normalized = String(value).trim()
  return normalized || null
}

function computeManifestHash(serialized: string) {
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`
}

async function loadManifest(id: number) {
  return queryRow<ManifestRow>(
    `SELECT id, app_code, manifest_seq, manifest_hash, manifest_json, status, created_at
     FROM platform_app_manifests
     WHERE id = ?`,
    [id]
  )
}

async function loadRelease(id: number) {
  return queryRow<ReleaseRow>(
    `SELECT id, app_code, release_version, manifest_id, status, created_at
     FROM platform_app_releases
     WHERE id = ?`,
    [id]
  )
}

export async function registerAppManifest(input: RegisterAppManifestInput): Promise<RegisterAppManifestResult> {
  const {
    appCode,
    releaseVersion,
    manifestJson,
    sourceType = 'admin_ui',
    sourceEndpoint = null,
    sourceTag = null,
    sourceCommitSha = null,
    bundleUri = null,
    bundleHash = null,
    bundleSizeBytes = null,
    reviewComment = 'Approved via admin API',
    releasedByAccountId = null
  } = input

  const normalizedManifestJson = normalizeManifestJson(manifestJson)
  const serializedManifest = JSON.stringify(normalizedManifestJson)
  const manifestHash = computeManifestHash(serializedManifest)

  const { manifestId, releaseId, roleMaterialization } = await withTransaction(async (tx) => {
    // 1. 锁应用行
    const application = await tx.queryRow<RowDataPacket>(
      `SELECT id
       FROM platform_applications
       WHERE app_code = ?
       LIMIT 1
       FOR UPDATE`,
      [appCode]
    )
    if (!application) {
      throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `application not found: appCode=${appCode}` })
    }

    // 2. 按 (app_code, manifest_hash) 查；命中复用，未命中分配 seq+1 后插入
    const existingManifest = await tx.queryRow<RowDataPacket & { id: number }>(
      `SELECT id
       FROM platform_app_manifests
       WHERE app_code = ? AND manifest_hash = ?
       LIMIT 1`,
      [appCode, manifestHash]
    )

    let resolvedManifestId: number
    if (existingManifest) {
      resolvedManifestId = existingManifest.id
    } else {
      const seqRow = await tx.queryRow<RowDataPacket & { next_seq: number }>(
        `SELECT COALESCE(MAX(manifest_seq), 0) + 1 AS next_seq
         FROM platform_app_manifests
         WHERE app_code = ?
         FOR UPDATE`,
        [appCode]
      )
      const nextSeq = seqRow?.next_seq ?? 1

      const inserted = await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_app_manifests
          (app_code, manifest_seq, manifest_hash, manifest_json, status, created_at)
         VALUES (?, ?, ?, ?, 'active', NOW())`,
        [appCode, nextSeq, manifestHash, serializedManifest]
      )
      resolvedManifestId = inserted.insertId
    }

    await syncManifestResourceActions(tx, resolvedManifestId, appCode, normalizedManifestJson)

    // 3. 记录注册流水
    const registration = await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_app_manifest_registrations
        (registration_no, app_code, submitted_version, submitted_manifest_hash, submitted_manifest_json,
         source_type, source_endpoint, registration_status, review_status, result_manifest_id,
         review_comment, reviewed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', 'approved', ?, ?, NOW(), NOW(), NOW())`,
      [buildRegistrationNo(), appCode, releaseVersion, manifestHash, serializedManifest,
        sourceType, sourceEndpoint, resolvedManifestId, reviewComment]
    )

    // 4. 更新应用 aggregate。URL 仍由 Platform 应用/部署配置管理；展示元数据跟随 manifest。
    const applicationUpdates = [
      'latest_manifest_id = ?',
      'latest_registration_id = ?',
      'last_manifest_registered_at = NOW()',
      'last_manifest_review_status = \'approved\''
    ]
    const applicationParams: Array<number | string | null> = [resolvedManifestId, registration.insertId]
    const manifestAppName = normalizeNullableString(normalizedManifestJson.appName)

    if (manifestAppName) {
      applicationUpdates.push('app_name = ?')
      applicationParams.push(manifestAppName)
    }
    if (hasOwnProperty(normalizedManifestJson, 'description')) {
      applicationUpdates.push('description = ?')
      applicationParams.push(normalizeNullableString(normalizedManifestJson.description))
    }
    if (hasOwnProperty(normalizedManifestJson, 'icon')) {
      applicationUpdates.push('icon = ?')
      applicationParams.push(normalizeNullableString(normalizedManifestJson.icon))
    }

    applicationUpdates.push('updated_at = NOW()')
    applicationParams.push(appCode)

    await tx.execute<ResultSetHeader>(
      `UPDATE platform_applications
       SET ${applicationUpdates.join(', ')}
       WHERE app_code = ?`,
      applicationParams
    )

    const roleMaterialization = await materializeRecommendedRolesFromManifest(tx, {
      appCode,
      manifestId: resolvedManifestId,
      manifestJson: normalizedManifestJson
    })

    // 5. 找或建 release：按 (app_code, release_version) 唯一；manifest_id 不一致则更新
    const existingRelease = await tx.queryRow<RowDataPacket & { id: number, manifest_id: number, status: string }>(
      `SELECT id, manifest_id, status
       FROM platform_app_releases
       WHERE app_code = ? AND release_version = ?
       LIMIT 1`,
      [appCode, releaseVersion]
    )

    let resolvedReleaseId: number
    if (existingRelease) {
      resolvedReleaseId = existingRelease.id
      if (existingRelease.manifest_id !== resolvedManifestId) {
        if (existingRelease.status === 'released') {
          throw createError({
            statusCode: 409,
            statusMessage: 'Conflict',
            message: `release ${releaseVersion} already released with different manifest; cannot rebind`
          })
        }
        await tx.execute<ResultSetHeader>(
          `UPDATE platform_app_releases
           SET manifest_id = ?,
               source_tag = ?,
               source_commit_sha = ?,
               bundle_uri = COALESCE(?, bundle_uri),
               bundle_hash = COALESCE(?, bundle_hash),
               bundle_size_bytes = COALESCE(?, bundle_size_bytes),
               updated_at = NOW()
           WHERE id = ?`,
          [resolvedManifestId, sourceTag ?? releaseVersion, sourceCommitSha,
            bundleUri, bundleHash, bundleSizeBytes, existingRelease.id]
        )
      }
    } else {
      const inserted = await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_app_releases
          (app_code, release_version, source_tag, source_commit_sha, manifest_id,
           bundle_uri, bundle_hash, bundle_size_bytes, status,
           released_by_account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NOW(), NOW())`,
        [appCode, releaseVersion, sourceTag ?? releaseVersion, sourceCommitSha, resolvedManifestId,
          bundleUri, bundleHash, bundleSizeBytes, releasedByAccountId]
      )
      resolvedReleaseId = inserted.insertId
    }

    return { manifestId: resolvedManifestId, releaseId: resolvedReleaseId, roleMaterialization }
  })

  const manifest = await loadManifest(manifestId)
  if (!manifest) {
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', message: 'failed to load created manifest' })
  }
  const release = await loadRelease(releaseId)
  if (!release) {
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', message: 'failed to load created release' })
  }

  return {
    manifest: {
      id: manifest.id,
      tenantCode: null,
      appCode: manifest.app_code,
      manifestSeq: manifest.manifest_seq,
      manifestHash: manifest.manifest_hash,
      manifestJson: parseManifestJson(manifest.manifest_json),
      status: manifest.status,
      createdAt: manifest.created_at
    },
    release: {
      id: release.id,
      appCode: release.app_code,
      releaseVersion: release.release_version,
      manifestId: release.manifest_id,
      status: release.status,
      createdAt: release.created_at
    },
    roleMaterialization
  }
}

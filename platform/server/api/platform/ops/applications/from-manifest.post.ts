import { createError } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { queryRow, withTransaction } from '~~/server/utils/db'
import {
  fetchGitLabRawFile,
  getPlatformGitLabConfig,
  resolveGitLabRefToCommitSha
} from '~~/server/utils/gitlab'
import { registerAppManifest } from '~~/server/utils/appManifests'

interface ApplicationRow extends RowDataPacket {
  id: number
  app_code: string
  app_name: string
  description: string | null
  icon: string | null
  home_url: string | null
  callback_url: string | null
  logout_url: string | null
  repo_url: string | null
  app_type: string
  runtime_mode: string
  service_role: string
  auth_mode: string
  bundle_enabled: number
  sort_order: number
  latest_manifest_id: number | null
  latest_registration_id: number | null
  latest_release_id: number | null
  last_manifest_registered_at: string | null
  last_manifest_review_status: string | null
  last_released_at: string | null
  status: string
  created_at: string
  updated_at: string
}

const ALLOWED_APP_TYPES = new Set(['internal', 'external', 'system'])
const ALLOWED_RUNTIME_MODES = new Set(['customer-hosted', 'managed-control-plane', 'self-hosted-enterprise'])
const ALLOWED_SERVICE_ROLES = new Set(['business_app', 'directory_runtime', 'workflow_runtime', 'supporting_service'])
const ALLOWED_AUTH_MODES = new Set(['oidc', 'gitlab_oidc', 'cas', 'wecom', 'service'])
const ALLOWED_STATUSES = new Set(['active', 'suspended', 'disabled'])
const LEGACY_MANIFEST_APP_TYPE_MAP = new Map([
  ['business', 'internal'],
  ['business_app', 'internal'],
  ['directory_runtime', 'internal'],
  ['workflow_runtime', 'internal'],
  ['supporting_service', 'internal'],
  ['builtin', 'internal'],
  ['optional', 'internal'],
  ['third_party', 'external']
])
const LEGACY_MANIFEST_SERVICE_ROLE_MAP = new Map([
  ['business', 'business_app'],
  ['business_app', 'business_app'],
  ['directory_runtime', 'directory_runtime'],
  ['workflow_runtime', 'workflow_runtime'],
  ['supporting_service', 'supporting_service']
])

function requireAllowed(value: string, field: string, allowed: Set<string>) {
  if (!allowed.has(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} must be one of: ${Array.from(allowed).join(', ')}`
    })
  }
  return value
}

function parseManifest(raw: string): Record<string, unknown> {
  try {
    const manifest = JSON.parse(raw)
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('manifest root must be an object')
    }
    return manifest as Record<string, unknown>
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `invalid app manifest JSON: ${(error as Error).message}`
    })
  }
}

function normalizeManifestJson(manifestJson: Record<string, unknown>) {
  const normalized = { ...manifestJson }
  delete normalized.version
  delete normalized.displayVersion
  return normalized
}

function normalizeAbsoluteHttpUrl(value: unknown) {
  const normalized = normalizeNullableString(value)
  if (!normalized) return null
  return /^https?:\/\//i.test(normalized) ? normalized : null
}

function normalizeManifestAppType(value: unknown) {
  const normalized = normalizeNullableString(value)
  if (!normalized) return null
  return LEGACY_MANIFEST_APP_TYPE_MAP.get(normalized) || normalized
}

function inferServiceRoleFromManifestAppType(value: unknown) {
  const normalized = normalizeNullableString(value)
  if (!normalized) return null
  return LEGACY_MANIFEST_SERVICE_ROLE_MAP.get(normalized) || null
}

async function loadApplication(id: number) {
  return queryRow<ApplicationRow>(
    `SELECT pa.id, pa.app_code, pa.app_name, pa.description, pa.icon, pa.home_url, pa.callback_url, pa.logout_url, pa.repo_url,
            pa.app_type, pa.runtime_mode, pa.service_role, pa.auth_mode, pa.bundle_enabled, pa.sort_order,
            pa.latest_manifest_id, pa.latest_registration_id, pa.latest_release_id,
            pa.last_manifest_registered_at, pa.last_manifest_review_status, pa.last_released_at,
            pa.status, pa.created_at, pa.updated_at
     FROM platform_applications pa
     WHERE pa.id = ?`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const repoUrl = requireString(body.repoUrl, 'repoUrl')
  const version = requireString(body.version, 'version')
  const config = getPlatformGitLabConfig(event)
  const ref = normalizeNullableString(body.ref) || version
  const manifestPath = normalizeNullableString(body.manifestPath) || config.defaultManifestPath

  const commitSha = normalizeNullableString(body.commitSha) || await resolveGitLabRefToCommitSha(repoUrl, ref, config)
  const rawManifest = await fetchGitLabRawFile(repoUrl, manifestPath, commitSha, config)
  const manifestJson = normalizeManifestJson(parseManifest(rawManifest))

  const appCode = requireString(manifestJson.appCode ?? body.appCode, 'manifest.appCode')

  const appName = normalizeNullableString(body.appName)
    || normalizeNullableString(manifestJson.appName)
    || appCode

  const description = normalizeNullableString(body.description)
    ?? normalizeNullableString(manifestJson.description)

  const entry = manifestJson.entry && typeof manifestJson.entry === 'object' && !Array.isArray(manifestJson.entry)
    ? manifestJson.entry as Record<string, unknown>
    : {}

  const homeUrl = normalizeNullableString(body.homeUrl) ?? normalizeAbsoluteHttpUrl(entry.web)
  const icon = normalizeNullableString(body.icon) ?? normalizeNullableString(manifestJson.icon)
  const callbackUrl = normalizeNullableString(body.callbackUrl)
  const logoutUrl = normalizeNullableString(body.logoutUrl)
  const manifestAppType = normalizeNullableString(manifestJson.appType)
  const appType = requireAllowed(normalizeNullableString(body.appType) || normalizeManifestAppType(manifestAppType) || 'internal', 'appType', ALLOWED_APP_TYPES)
  const runtimeMode = requireAllowed(normalizeNullableString(body.runtimeMode) || 'customer-hosted', 'runtimeMode', ALLOWED_RUNTIME_MODES)
  const serviceRole = requireAllowed(
    normalizeNullableString(body.serviceRole)
    || normalizeNullableString(manifestJson.serviceRole)
    || inferServiceRoleFromManifestAppType(manifestAppType)
    || 'business_app',
    'serviceRole',
    ALLOWED_SERVICE_ROLES
  )
  const authMode = requireAllowed(normalizeNullableString(body.authMode) || normalizeNullableString(manifestJson.authMode) || 'oidc', 'authMode', ALLOWED_AUTH_MODES)
  const status = requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ALLOWED_STATUSES)
  const bundleEnabled = body.bundleEnabled === undefined
    ? (manifestJson.bundleEnabled === undefined ? true : Boolean(manifestJson.bundleEnabled))
    : Boolean(body.bundleEnabled)
  const sortOrder = body.sortOrder === undefined ? 1000 : Number(body.sortOrder)
  if (!Number.isFinite(sortOrder) || sortOrder < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'sortOrder must be a non-negative number' })
  }

  const applicationId = await withTransaction(async (tx) => {
    const existing = await tx.queryRow<RowDataPacket & { id: number }>(
      `SELECT id
       FROM platform_applications
       WHERE app_code = ?
       LIMIT 1`,
      [appCode]
    )

    if (existing) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `应用 ${appCode} 已存在，不能重复导入。请到应用详情中从 GitLab 拉取新版本。`,
        data: {
          code: 'APPLICATION_ALREADY_EXISTS',
          appCode
        }
      })
    }

    const insertResult = await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_applications
        (app_code, app_name, description, icon, home_url, callback_url, logout_url, repo_url,
         app_type, runtime_mode, service_role, auth_mode, bundle_enabled, sort_order, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [appCode, appName, description, icon, homeUrl, callbackUrl, logoutUrl, repoUrl, appType, runtimeMode, serviceRole, authMode, bundleEnabled ? 1 : 0, Math.trunc(sortOrder), status]
    )

    return insertResult.insertId
  })

  const sourceEndpoint = `gitlab:${repoUrl}#${commitSha}:${manifestPath}`
  const { manifest, release, roleMaterialization } = await registerAppManifest({
    appCode,
    releaseVersion: version,
    manifestJson,
    sourceType: 'gitlab_release',
    sourceEndpoint,
    sourceTag: ref,
    sourceCommitSha: commitSha,
    reviewComment: `Created via GitLab import: release=${version}, ref=${ref}, commit=${commitSha}`
  })

  const application = await loadApplication(applicationId)
  if (!application) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load created application'
    })
  }

  return ok({
    application: {
      id: application.id,
      tenantCode: null,
      appCode: application.app_code,
      appName: application.app_name,
      description: application.description,
      icon: application.icon,
      homeUrl: application.home_url,
      callbackUrl: application.callback_url,
      logoutUrl: application.logout_url,
      repoUrl: application.repo_url,
      appType: application.app_type,
      runtimeMode: application.runtime_mode,
      serviceRole: application.service_role,
      authMode: application.auth_mode,
      bundleEnabled: Boolean(application.bundle_enabled),
      sortOrder: Number(application.sort_order || 0),
      status: application.status,
      latestManifestId: application.latest_manifest_id,
      latestRegistrationId: application.latest_registration_id,
      latestReleaseId: application.latest_release_id,
      lastManifestRegisteredAt: application.last_manifest_registered_at,
      lastManifestReviewStatus: application.last_manifest_review_status,
      lastReleasedAt: application.last_released_at,
      createdAt: application.created_at,
      updatedAt: application.updated_at
    },
    manifest,
    release,
    roleMaterialization,
    gitlab: {
      repoUrl,
      releaseVersion: version,
      ref,
      commitSha,
      manifestPath
    }
  })
})

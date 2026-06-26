import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { queryRow, withTransaction } from '~~/server/utils/db'
import { normalizeNullableString, ok } from '~~/server/utils/api'

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
  last_manifest_registered_at: string | null
  last_manifest_review_status: string | null
  status: string
  created_at: string
  updated_at: string
}

const ALLOWED_APP_TYPES = new Set(['internal', 'external', 'system'])
const ALLOWED_RUNTIME_MODES = new Set(['customer-hosted', 'managed-control-plane', 'self-hosted-enterprise'])
const ALLOWED_SERVICE_ROLES = new Set(['business_app', 'directory_runtime', 'workflow_runtime', 'supporting_service'])
const ALLOWED_AUTH_MODES = new Set(['oidc', 'gitlab_oidc', 'cas', 'wecom', 'service'])
const ALLOWED_STATUSES = new Set(['active', 'suspended', 'disabled'])

function requireId(event: H3Event) {
  const raw = getRouterParam(event, 'id')
  const id = Number(raw)
  if (!raw || Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'id is invalid' })
  }
  return id
}

function requireAllowed(value: string, field: string, allowed: Set<string>) {
  if (!allowed.has(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `${field} must be one of: ${Array.from(allowed).join(', ')}` })
  }
  return value
}

async function loadApplication(id: number) {
  return queryRow<ApplicationRow>(
    `SELECT pa.id, pa.app_code, pa.app_name, pa.description, pa.icon, pa.home_url, pa.callback_url, pa.logout_url, pa.repo_url,
            pa.app_type, pa.runtime_mode, pa.service_role, pa.auth_mode, pa.bundle_enabled, pa.sort_order,
            pa.latest_manifest_id, pa.latest_registration_id, pa.last_manifest_registered_at, pa.last_manifest_review_status,
            pa.status, pa.created_at, pa.updated_at
     FROM platform_applications pa
     WHERE pa.id = ?`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const id = requireId(event)
  const body = await readBody<Record<string, unknown>>(event)

  const updates: string[] = []
  const params: Array<string | number | null> = []

  if (body.appName !== undefined) {
    const appName = String(body.appName || '').trim()
    if (!appName) throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'appName is required' })
    updates.push('app_name = ?')
    params.push(appName)
  }
  if (body.description !== undefined) {
    updates.push('description = ?')
    params.push(normalizeNullableString(body.description))
  }
  if (body.icon !== undefined) {
    updates.push('icon = ?')
    params.push(normalizeNullableString(body.icon))
  }
  if (body.homeUrl !== undefined) {
    updates.push('home_url = ?')
    params.push(normalizeNullableString(body.homeUrl))
  }
  if (body.callbackUrl !== undefined) {
    updates.push('callback_url = ?')
    params.push(normalizeNullableString(body.callbackUrl))
  }
  if (body.logoutUrl !== undefined) {
    updates.push('logout_url = ?')
    params.push(normalizeNullableString(body.logoutUrl))
  }
  if (body.repoUrl !== undefined) {
    updates.push('repo_url = ?')
    params.push(normalizeNullableString(body.repoUrl))
  }
  if (body.appType !== undefined) {
    updates.push('app_type = ?')
    params.push(requireAllowed(String(body.appType), 'appType', ALLOWED_APP_TYPES))
  }
  if (body.runtimeMode !== undefined) {
    updates.push('runtime_mode = ?')
    params.push(requireAllowed(String(body.runtimeMode), 'runtimeMode', ALLOWED_RUNTIME_MODES))
  }
  if (body.serviceRole !== undefined) {
    updates.push('service_role = ?')
    params.push(requireAllowed(String(body.serviceRole), 'serviceRole', ALLOWED_SERVICE_ROLES))
  }
  if (body.authMode !== undefined) {
    updates.push('auth_mode = ?')
    params.push(requireAllowed(String(body.authMode), 'authMode', ALLOWED_AUTH_MODES))
  }
  if (body.bundleEnabled !== undefined) {
    updates.push('bundle_enabled = ?')
    params.push(body.bundleEnabled ? 1 : 0)
  }
  if (body.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder)
    if (!Number.isFinite(sortOrder) || sortOrder < 0) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'sortOrder must be a non-negative number' })
    }
    updates.push('sort_order = ?')
    params.push(Math.trunc(sortOrder))
  }
  if (body.status !== undefined) {
    updates.push('status = ?')
    params.push(requireAllowed(String(body.status), 'status', ALLOWED_STATUSES))
  }

  if (!updates.length) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'no updatable fields provided' })
  }

  await withTransaction(async (tx) => {
    const existing = await tx.queryRow<RowDataPacket & { app_code: string }>(
      `SELECT id, app_code
       FROM platform_applications
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [id]
    )

    if (!existing) {
      throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `application not found: id=${id}` })
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE platform_applications
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = ?`,
      [...params, id]
    )
  })

  const application = await loadApplication(id)
  if (!application) {
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', message: 'failed to load updated application' })
  }

  return ok({
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
    lastManifestRegisteredAt: application.last_manifest_registered_at,
    lastManifestReviewStatus: application.last_manifest_review_status,
    createdAt: application.created_at,
    updatedAt: application.updated_at
  })
})

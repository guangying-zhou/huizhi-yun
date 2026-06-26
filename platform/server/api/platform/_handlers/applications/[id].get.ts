import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'

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

function requireId(event: H3Event) {
  const raw = getRouterParam(event, 'id')
  const id = Number(raw)
  if (!raw || Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'id is invalid' })
  }
  return id
}

export default defineEventHandler(async (event) => {
  const id = requireId(event)

  const application = await queryRow<ApplicationRow>(
    `SELECT pa.id, pa.app_code, pa.app_name, pa.description, pa.icon, pa.home_url, pa.callback_url, pa.logout_url, pa.repo_url,
            pa.app_type, pa.runtime_mode, pa.auth_mode, pa.bundle_enabled, pa.sort_order,
            pa.latest_manifest_id, pa.latest_registration_id, pa.last_manifest_registered_at, pa.last_manifest_review_status,
            pa.status, pa.created_at, pa.updated_at
     FROM platform_applications pa
     WHERE pa.id = ?`,
    [id]
  )

  if (!application) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `application not found: id=${id}` })
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

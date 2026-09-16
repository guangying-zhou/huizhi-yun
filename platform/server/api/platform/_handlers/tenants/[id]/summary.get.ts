import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'

interface TenantRow extends RowDataPacket {
  id: number
  tenant_code: string
  tenant_name: string
  display_name: string | null
  primary_domain: string | null
  status: string
  default_auth_mode: string
  default_deployment_mode: string
}

interface CountRow extends RowDataPacket {
  total: number
}

function requireId(event: H3Event) {
  const raw = getRouterParam(event, 'id')
  const id = Number(raw)
  if (!raw || Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'id is invalid'
    })
  }

  return id
}

function deriveOnboardingStage(input: {
  hasProfile: boolean
  appCount: number
  licenseCount: number
  deploymentCount: number
  status: string
}) {
  if (!input.hasProfile) {
    return 'draft'
  }

  if (input.appCount <= 0) {
    return 'profile_completed'
  }

  if (input.licenseCount <= 0) {
    return 'apps_selected'
  }

  if (input.deploymentCount <= 0) {
    return 'license_ready'
  }

  if (input.status !== 'active') {
    return 'deployment_configured'
  }

  return 'active'
}

export default defineEventHandler(async (event) => {
  const id = requireId(event)

  const tenant = await queryRow<TenantRow>(
    `SELECT id, tenant_code, tenant_name, display_name, primary_domain, status, default_auth_mode, default_deployment_mode
     FROM tenants
     WHERE id = ?
     LIMIT 1`,
    [id]
  )

  if (!tenant) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant not found: id=${id}`
    })
  }

  const tenantCode = tenant.tenant_code

  const [
    users,
    subjects,
    roles,
    templates,
    applications,
    deployments,
    licenses
  ] = await Promise.all([
    queryRow<CountRow>(`SELECT COUNT(*) AS total FROM tenant_subjects WHERE tenant_code = ? AND subject_type = 'user'`, [tenantCode]),
    queryRow<CountRow>(`SELECT COUNT(*) AS total FROM tenant_subjects WHERE tenant_code = ?`, [tenantCode]),
    queryRow<CountRow>(`SELECT COUNT(*) AS total FROM tenant_roles WHERE tenant_code = ?`, [tenantCode]),
    queryRow<CountRow>(`SELECT COUNT(*) AS total FROM tenant_permission_templates WHERE tenant_code = ?`, [tenantCode]),
    queryRow<CountRow>(`SELECT COUNT(*) AS total FROM subscriptions WHERE tenant_code = ?`, [tenantCode]),
    queryRow<CountRow>(`SELECT COUNT(*) AS total FROM deployments WHERE tenant_code = ?`, [tenantCode]),
    queryRow<CountRow>(`SELECT COUNT(*) AS total FROM licenses WHERE tenant_code = ?`, [tenantCode])
  ])

  const summary = {
    userCount: users?.total || 0,
    subjectCount: subjects?.total || 0,
    roleCount: roles?.total || 0,
    templateCount: templates?.total || 0,
    applicationCount: applications?.total || 0,
    deploymentCount: deployments?.total || 0,
    licenseCount: licenses?.total || 0
  }

  const hasProfile = Boolean((tenant.display_name && tenant.display_name.trim()) || (tenant.primary_domain && tenant.primary_domain.trim()))
  const onboardingStage = deriveOnboardingStage({
    hasProfile,
    appCount: summary.applicationCount,
    licenseCount: summary.licenseCount,
    deploymentCount: summary.deploymentCount,
    status: tenant.status
  })

  return ok({
    tenantId: tenant.id,
    tenantCode,
    tenantName: tenant.tenant_name,
    displayName: tenant.display_name,
    primaryDomain: tenant.primary_domain,
    status: tenant.status,
    defaultAuthMode: tenant.default_auth_mode,
    defaultDeploymentMode: tenant.default_deployment_mode,
    onboardingStage,
    summary
  })
})

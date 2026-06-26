import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

type RoleScope = 'platform' | 'tenant' | 'app'

interface SystemRoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  description: string | null
  is_required: number
  status: string
  permission_count: number
  template_count: number
  tenant_count: number
}

interface PermissionRow extends RowDataPacket {
  app_code: string
  resource_code: string
  resource_name: string
  action: string
  manifest_action_id: number | null
}

interface ScopeRow extends RowDataPacket {
  app_code: string
  resource_code: string
  resource_name: string
  action: string
  manifest_action_id: number | null
  scope_type: string
  scope_value: string
  status: string
}

interface TemplateRow extends RowDataPacket {
  id: number
  template_code: string
  template_name: string
  template_type: string
  status: string
  usage_tenant_count: number
}

interface TenantRow extends RowDataPacket {
  tenant_code: string
  tenant_name: string
  local_role_code: string
  status: string
  member_count: number
}

const TENANT_ROLE_TYPES = new Set(['system', 'base', 'tenant'])

function requireCode(event: H3Event) {
  const raw = getRouterParam(event, 'code')
  const code = String(raw || '').trim()
  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'code is required'
    })
  }

  return code
}

function resolveScope(roleType: string, appCode: string | null): RoleScope {
  const normalizedRoleType = String(roleType || '').trim().toLowerCase()
  if (!appCode || normalizedRoleType === 'platform') {
    return 'platform'
  }

  if (TENANT_ROLE_TYPES.has(normalizedRoleType)) {
    return 'tenant'
  }

  return 'app'
}

export default defineEventHandler(async (event) => {
  const code = requireCode(event)

  const role = await queryRow<SystemRoleRow>(
    `SELECT psr.id,
            psr.role_code,
            psr.role_name,
            psr.role_type,
            psr.app_code,
            psr.description,
            psr.is_required,
            psr.status,
            (
              SELECT COUNT(*)
              FROM platform_app_role_permissions psrp
              WHERE psrp.app_role_id = psr.id
            ) AS permission_count,
            (
              SELECT COUNT(*)
              FROM platform_system_app_role_maps sarm
              WHERE sarm.app_role_code = psr.role_code
            ) AS template_count,
            (
              SELECT COUNT(DISTINCT tr.tenant_code)
              FROM tenant_role_app_role_maps tram
              INNER JOIN tenant_roles tr
                ON tr.id = tram.role_id
               AND tr.tenant_code = tram.tenant_code
              WHERE tram.app_role_code = psr.role_code
            ) AS tenant_count
     FROM platform_app_roles psr
     WHERE psr.role_code = ?
     LIMIT 1`,
    [code]
  )

  if (!role) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `system role not found: roleCode=${code}`
    })
  }

  const permissions = await queryRows<PermissionRow[]>(
    `SELECT psrp.app_code,
            psrp.resource_code,
            COALESCE(source_mr.resource_name, latest_mr.resource_name, psrp.resource_code) AS resource_name,
            psrp.action,
            psrp.manifest_action_id
     FROM platform_app_role_permissions psrp
     LEFT JOIN platform_app_manifest_resource_actions source_mra
       ON source_mra.id = psrp.manifest_action_id
     LEFT JOIN platform_app_manifest_resources source_mr
       ON source_mr.id = source_mra.manifest_resource_id
     LEFT JOIN platform_applications pa
       ON pa.app_code = psrp.app_code
     LEFT JOIN platform_app_manifest_resources latest_mr
       ON latest_mr.app_code = psrp.app_code
      AND latest_mr.manifest_id = pa.latest_manifest_id
      AND latest_mr.resource_code = psrp.resource_code
     WHERE psrp.app_role_id = ?
     ORDER BY psrp.app_code ASC, psrp.resource_code ASC, psrp.action ASC`,
    [role.id]
  )

  const templates = await queryRows<TemplateRow[]>(
    `SELECT pst.id,
            pst.role_code AS template_code,
            pst.role_name AS template_name,
            pst.role_type AS template_type,
            pst.status,
            (
              SELECT COUNT(DISTINCT tr.tenant_code)
              FROM tenant_roles tr
              WHERE tr.source = 'system'
                AND tr.source_role_code = pst.role_code
            ) AS usage_tenant_count
     FROM platform_system_app_role_maps pstr
     INNER JOIN platform_system_roles pst
       ON pst.id = pstr.system_role_id
     WHERE pstr.app_role_code = ?
     ORDER BY pstr.sort_order ASC, pst.sort_order ASC, pst.role_code ASC`,
    [role.role_code]
  )

  const scopes = await queryRows<ScopeRow[]>(
    `SELECT psrs.app_code,
            psrs.resource_code,
            COALESCE(source_mr.resource_name, latest_mr.resource_name, psrs.resource_code) AS resource_name,
            psrs.action,
            psrs.manifest_action_id,
            psrs.scope_type,
            psrs.scope_value,
            psrs.status
     FROM platform_app_role_scopes psrs
     LEFT JOIN platform_app_manifest_resource_actions source_mra
       ON source_mra.id = psrs.manifest_action_id
     LEFT JOIN platform_app_manifest_resources source_mr
       ON source_mr.id = source_mra.manifest_resource_id
     LEFT JOIN platform_applications pa
       ON pa.app_code = psrs.app_code
     LEFT JOIN platform_app_manifest_resources latest_mr
       ON latest_mr.app_code = psrs.app_code
      AND latest_mr.manifest_id = pa.latest_manifest_id
      AND latest_mr.resource_code = psrs.resource_code
     WHERE psrs.app_role_id = ?
     ORDER BY psrs.app_code ASC, psrs.resource_code ASC, psrs.action ASC, psrs.scope_type ASC, psrs.scope_value ASC`,
    [role.id]
  )

  const tenants = await queryRows<TenantRow[]>(
    `SELECT tr.tenant_code,
            COALESCE(t.display_name, t.tenant_name, tr.tenant_code) AS tenant_name,
            tr.role_code AS local_role_code,
            tr.status,
            (
              SELECT COUNT(*)
              FROM tenant_account_roles tar
              WHERE tar.tenant_code = tr.tenant_code
                AND tar.role_id = tr.id
                AND (tar.expired_at IS NULL OR tar.expired_at > NOW())
            ) AS member_count
     FROM tenant_role_app_role_maps tram
     INNER JOIN tenant_roles tr
       ON tr.id = tram.role_id
      AND tr.tenant_code = tram.tenant_code
     LEFT JOIN tenants t
       ON t.tenant_code = tr.tenant_code
     WHERE tram.app_role_code = ?
     ORDER BY tr.tenant_code ASC`,
    [role.role_code]
  )

  return ok({
    role: {
      id: role.id,
      roleCode: role.role_code,
      roleName: role.role_name,
      roleType: role.role_type,
      appCode: role.app_code,
      scope: resolveScope(role.role_type, role.app_code),
      description: role.description,
      isRequired: Boolean(role.is_required),
      status: role.status,
      permissionCount: role.permission_count,
      templateCount: role.template_count,
      tenantCount: role.tenant_count
    },
    permissions: permissions.map(item => ({
      appCode: item.app_code,
      resourceCode: item.resource_code,
      resourceName: item.resource_name,
      action: item.action,
      manifestActionId: item.manifest_action_id
    })),
    scopes: scopes.map(item => ({
      appCode: item.app_code,
      resourceCode: item.resource_code,
      resourceName: item.resource_name,
      action: item.action,
      manifestActionId: item.manifest_action_id,
      scopeType: item.scope_type,
      scopeValue: item.scope_value,
      status: item.status
    })),
    templates: templates.map(item => ({
      id: item.id,
      templateCode: item.template_code,
      templateName: item.template_name,
      templateType: item.template_type,
      status: item.status,
      usageTenantCount: item.usage_tenant_count
    })),
    tenants: tenants.map(item => ({
      tenantCode: item.tenant_code,
      tenantName: item.tenant_name,
      localRoleCode: item.local_role_code,
      status: item.status,
      memberCount: item.member_count
    }))
  })
})

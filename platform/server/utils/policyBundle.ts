import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { getHeader, setResponseHeader, setResponseStatus } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { buildAppHomeUrl, defaultApiBase, defaultAppBasePath, deriveLogoutUrl, resolveOidcCallbackUrl } from '~~/server/utils/appUrls'
import { queryRow, queryRows, withTransaction } from '~~/server/utils/db'
import { parseStoredJson } from '~~/server/utils/platform'
import { sign } from '~~/server/utils/platformSigning'
import { materializeSystemRole } from '~~/server/utils/tenantSystemRoles'
import {
  DEFAULT_DEPLOYMENT_ENVIRONMENT,
  consoleLoginSettings,
  normalizeDeploymentEnvironment,
  parseTenantSettings
} from '~~/server/utils/tenantDeploymentSettings'

const POLICY_BUNDLE_SCHEMA_VERSION = 'policy-bundle.v1'
const POLICY_BUNDLE_SIGNATURE_ALG = 'Ed25519'
const LEGACY_CONSOLE_VIEWER_ROLE_CODES = ['console.viewer', 'tenant_console_view', 'tenant_console_viewer']
const LEGACY_CONSOLE_VIEWER_ROLE_SQL = LEGACY_CONSOLE_VIEWER_ROLE_CODES.map(roleCode => `'${roleCode}'`).join(', ')

// Baseline permissions are employee self-service defaults. Console management
// access must come from explicit tenant roles/templates.
const BASELINE_PERMISSIONS = [
  { appCode: 'workflow', resourceCode: 'workflow_workspace', action: 'view', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'view', scopeType: 'relation', scopeValue: 'assigned' },
  { appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'edit', scopeType: 'relation', scopeValue: 'assigned' },
  { appCode: 'workflow', resourceCode: 'workflow_instances', action: 'view', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'codocs', resourceCode: 'documents', action: 'view', scopeType: 'relation', scopeValue: 'owned_or_shared' },
  { appCode: 'codocs', resourceCode: 'documents', action: 'create', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'codocs', resourceCode: 'documents', action: 'edit', scopeType: 'relation', scopeValue: 'owned_or_shared' },
  { appCode: 'codocs', resourceCode: 'documents', action: 'delete', scopeType: 'relation', scopeValue: 'owned_or_shared' },
  { appCode: 'codocs', resourceCode: 'departments', action: 'view', scopeType: 'relation', scopeValue: 'member_department' },
  { appCode: 'codocs', resourceCode: 'departments', action: 'create', scopeType: 'relation', scopeValue: 'member_department' },
  { appCode: 'codocs', resourceCode: 'departments', action: 'edit', scopeType: 'relation', scopeValue: 'member_department' },
  { appCode: 'codocs', resourceCode: 'company', action: 'view', scopeType: 'tenant', scopeValue: 'published' },
  { appCode: 'codocs', resourceCode: 'info', action: 'view', scopeType: 'tenant', scopeValue: 'published' },
  { appCode: 'codocs', resourceCode: 'reviews', action: 'view', scopeType: 'relation', scopeValue: 'participant' },
  { appCode: 'codocs', resourceCode: 'reviews', action: 'submit', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'assets', resourceCode: 'dashboard', action: 'view', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'assets', resourceCode: 'asset_items', action: 'view', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'assets', resourceCode: 'assignments', action: 'view', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'assets', resourceCode: 'assignments', action: 'edit', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'aims', resourceCode: 'aims_overview', action: 'view', scopeType: 'relation', scopeValue: 'participant' },
  { appCode: 'aims', resourceCode: 'projects', action: 'view', scopeType: 'relation', scopeValue: 'participant' },
  { appCode: 'aims', resourceCode: 'work_items', action: 'view', scopeType: 'relation', scopeValue: 'participant' },
  { appCode: 'aims', resourceCode: 'notifications', action: 'view', scopeType: 'subject', scopeValue: 'self' }
]

type JsonValue
  = | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue }

interface TenantRow extends RowDataPacket {
  tenantCode: string
  tenantName: string
  tenantType: string
  status: string
  settingsJson: unknown
}

interface DeploymentTargetRow extends RowDataPacket {
  id: number
  deploymentCode: string
  appCode: string
  subscriptionId: number
  environment: string
  status: string
  siteId: number | null
  basePath: string | null
  apiBase: string | null
  routeSource: string | null
}

interface DeploymentSiteProjectionRow extends RowDataPacket {
  siteId: number
  siteCode: string
  publicUrl: string
  rootAppCode: string | null
  environment: string
  status: string
}

interface NextSeqRow extends RowDataPacket {
  nextSeq: number
}

interface DeploymentEnvironmentRow extends RowDataPacket {
  environment: string
}

interface InheritedSystemRoleRow extends RowDataPacket {
  roleCode: string
}

export interface RuntimePolicyBundleRow extends RowDataPacket {
  id: number
  tenant_code: string
  environment: string
  deployment_id: number
  bundle_id: number
  bundle_version: string
  bundle_hash: string
  bundle_payload_json: unknown
  bundle_uri: string
  signature: string | null
  signed_by_kid: string | null
  signed_at: string | null
  schema_version: string
  issued_at: string
  expires_at: string | null
  status: string
  created_at: string
}

export interface GeneratedPolicyBundle {
  tenantCode: string
  environment: string
  bundleId: number
  bundleVersion: string
  bundleHash: string
  bundleUri: string
  schemaVersion: string
  payload: Record<string, unknown>
  signature: string
  signedByKid: string
  alg: string
  signedAt: string
  issuedAt: string
  expiresAt: string | null
  targets: Array<{
    deploymentId: number
    deploymentCode: string
    appCode: string
    environment: string
  }>
}

function normalizeJson(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeJson(item))
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const normalized: Record<string, JsonValue> = {}

    for (const key of Object.keys(record).sort()) {
      const normalizedValue = normalizeJson(record[key])
      if (normalizedValue !== undefined) {
        normalized[key] = normalizedValue
      }
    }

    return normalized
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  return String(value)
}

function stableStringify(value: unknown) {
  return JSON.stringify(normalizeJson(value))
}

function hashBundlePayload(payloadJson: string) {
  return `sha256_${createHash('sha256').update(payloadJson).digest('hex')}`
}

function toSqlDateTime(date: Date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function toVersionTimestamp(date: Date) {
  return date.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
}

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  return parseStoredJson<T>(value) || fallback
}

function hasAppCodes(appCodes: string[]) {
  return appCodes.length > 0
}

function buildInClause(values: string[]) {
  return values.map(() => '?').join(', ')
}

function excludeLegacyConsoleViewerRoleSql(alias: string) {
  return `NOT (${alias}.app_code = 'console' AND ${alias}.role_code IN (${LEGACY_CONSOLE_VIEWER_ROLE_SQL}))`
}

async function findTenant(tenantCode: string) {
  return queryRow<TenantRow>(
    `SELECT tenant_code AS tenantCode, tenant_name AS tenantName, tenant_type AS tenantType, status,
            settings_json AS settingsJson
     FROM tenants
     WHERE tenant_code = ?
     LIMIT 1`,
    [tenantCode]
  )
}

function redactConsoleLoginSecret(value: Record<string, unknown>) {
  const consoleLogin = value.consoleLogin
  if (!consoleLogin || typeof consoleLogin !== 'object' || Array.isArray(consoleLogin)) {
    return
  }

  const login = consoleLogin as Record<string, unknown>
  for (const [sectionKey, secretKey] of [
    ['oidc', 'clientSecret'],
    ['wecom', 'corpsecret']
  ] as const) {
    const section = login[sectionKey]
    if (section && typeof section === 'object' && !Array.isArray(section)) {
      const record = section as Record<string, unknown>
      if (String(record[secretKey] || '').trim()) {
        record[secretKey] = '[redacted]'
      }
    }
  }
}

export function redactPolicyBundlePayloadForResponse(payload: Record<string, unknown>) {
  const cloned = JSON.parse(JSON.stringify(payload || {})) as Record<string, unknown>
  redactConsoleLoginSecret(cloned)
  return cloned
}

async function findTargetDeployments(tenantCode: string, environment: string) {
  return queryRows<DeploymentTargetRow[]>(
    `SELECT id, deployment_code AS deploymentCode, app_code AS appCode, subscription_id AS subscriptionId,
            environment,
            site_id AS siteId, base_path AS basePath, api_base AS apiBase, route_source AS routeSource,
            status
     FROM deployments
     WHERE tenant_code = ?
       AND environment = ?
       AND status = 'active'
     ORDER BY app_code, id`,
    [tenantCode, environment]
  )
}

async function findDeploymentSiteProjection(tenantCode: string, environment: string) {
  return queryRow<DeploymentSiteProjectionRow>(
    `SELECT id AS siteId, site_code AS siteCode, public_url AS publicUrl,
            root_app_code AS rootAppCode, environment, status
     FROM deployment_sites
     WHERE tenant_code = ?
       AND environment = ?
       AND status = 'active'
     ORDER BY id DESC
     LIMIT 1`,
    [tenantCode, environment]
  )
}

async function syncInheritedSystemRoles(tenantCode: string) {
  const roles = await queryRows<InheritedSystemRoleRow[]>(
    `SELECT DISTINCT tr.source_role_code AS roleCode
     FROM tenant_roles tr
     INNER JOIN platform_system_roles psr
       ON psr.role_code = tr.source_role_code
      AND psr.status = 'active'
     WHERE tr.tenant_code = ?
       AND tr.source = 'system'
       AND tr.source_role_code IS NOT NULL
       AND tr.is_overridden = 0
       AND tr.status = 'active'
     ORDER BY tr.source_role_code`,
    [tenantCode]
  )

  if (!roles.length) {
    return
  }

  await withTransaction(async (tx) => {
    for (const role of roles) {
      await materializeSystemRole(tx, {
        tenantCode,
        systemRoleCode: role.roleCode
      })
    }
  })
}

async function collectTenantAppCodes(tenantCode: string, environment: string, deployments: DeploymentTargetRow[]) {
  const rows = await queryRows<Array<RowDataPacket & { appCode: string }>>(
    `SELECT DISTINCT app_code AS appCode
     FROM subscriptions
     WHERE tenant_code = ?
       AND status = 'active'
     UNION
     SELECT DISTINCT app_code AS appCode
     FROM deployments
     WHERE tenant_code = ?
       AND environment = ?
       AND status = 'active'
     ORDER BY appCode`,
    [tenantCode, tenantCode, environment]
  )

  return [...new Set([...deployments.map(item => item.appCode), ...rows.map(item => item.appCode)].filter(Boolean))].sort()
}

async function collectApplications(tenantCode: string, environment: string, appCodes: string[]) {
  if (!hasAppCodes(appCodes)) {
    return []
  }

  const rows = await queryRows<RowDataPacket[]>(
    `SELECT pa.app_code AS appCode, pa.app_name AS appName, pa.description, pa.icon,
            pa.home_url AS defaultHomeUrl,
            pa.callback_url AS defaultCallbackUrl,
            pa.logout_url AS logoutUrl,
            COALESCE(ds.public_url, tenant_site.public_url) AS publicUrl,
            d.base_path AS basePath,
            d.api_base AS apiBase,
            d.route_source AS routeSource,
            pa.app_type AS appType, pa.runtime_mode AS runtimeMode, pa.service_role AS serviceRole,
            pa.auth_mode AS authMode, pa.bundle_enabled AS bundleEnabled, pa.sort_order AS sortOrder, pa.status
     FROM platform_applications pa
     LEFT JOIN deployments d
       ON d.id = (
         SELECT d2.id
         FROM deployments d2
         WHERE d2.tenant_code = ?
           AND d2.app_code = pa.app_code
           AND d2.environment = ?
           AND d2.status = 'active'
         ORDER BY CASE WHEN d2.status = 'active' THEN 0 ELSE 1 END, d2.updated_at DESC, d2.id DESC
         LIMIT 1
       )
     LEFT JOIN deployment_sites ds
       ON ds.id = d.site_id
      AND ds.status = 'active'
     LEFT JOIN deployment_sites tenant_site
       ON tenant_site.id = (
         SELECT ds2.id
         FROM deployment_sites ds2
         WHERE ds2.tenant_code = ?
           AND ds2.environment = ?
           AND ds2.status = 'active'
         ORDER BY ds2.id DESC
         LIMIT 1
       )
     WHERE pa.app_code IN (${buildInClause(appCodes)})
     ORDER BY pa.sort_order ASC, pa.app_code ASC`,
    [tenantCode, environment, tenantCode, environment, ...appCodes]
  )

  return rows.map((row) => {
    const basePath = row.basePath || defaultAppBasePath(row.appCode)
    const apiBase = row.apiBase || defaultApiBase(row.appCode)
    const homeUrl = buildAppHomeUrl(row.publicUrl, basePath) || row.defaultHomeUrl || null
    const callbackUrl = resolveOidcCallbackUrl(row.defaultCallbackUrl, homeUrl)
    return {
      appCode: row.appCode,
      appName: row.appName,
      description: row.description,
      icon: row.icon,
      basePath,
      apiBase,
      routeSource: row.routeSource || 'default',
      homeUrl,
      callbackUrl,
      logoutUrl: row.logoutUrl || deriveLogoutUrl(homeUrl),
      appType: row.appType,
      runtimeMode: row.runtimeMode,
      serviceRole: row.serviceRole,
      authMode: row.authMode,
      bundleEnabled: row.bundleEnabled,
      sortOrder: Number(row.sortOrder || 0),
      status: row.status
    }
  })
}

async function collectManifestResources(appCodes: string[]) {
  if (!hasAppCodes(appCodes)) {
    return []
  }

  return queryRows<RowDataPacket[]>(
    `SELECT r.app_code AS appCode, r.manifest_id AS manifestId, r.resource_code AS resourceCode,
            r.resource_name AS resourceName, r.description, r.sort_order AS sortOrder, r.status
     FROM platform_app_manifest_resources r
     LEFT JOIN platform_applications pa ON pa.app_code = r.app_code
     WHERE r.status = 'active'
       AND r.app_code IN (${buildInClause(appCodes)})
       AND r.manifest_id = COALESCE(
         pa.latest_manifest_id,
         (
           SELECT pam.id
           FROM platform_app_manifests pam
           WHERE pam.app_code = r.app_code
             AND pam.status = 'active'
           ORDER BY pam.manifest_seq DESC, pam.id DESC
           LIMIT 1
         )
       )
     ORDER BY r.app_code, r.resource_code`,
    appCodes
  )
}

async function collectManifestActions(appCodes: string[]) {
  if (!hasAppCodes(appCodes)) {
    return []
  }

  return queryRows<RowDataPacket[]>(
    `SELECT a.app_code AS appCode, a.manifest_id AS manifestId, a.resource_code AS resourceCode,
            a.action, a.action_code AS actionCode, a.action_name AS actionName,
            a.description, a.sort_order AS sortOrder, a.requires_grant AS requiresGrant,
            a.status
     FROM platform_app_manifest_resource_actions a
     LEFT JOIN platform_applications pa ON pa.app_code = a.app_code
     WHERE a.status = 'active'
       AND a.app_code IN (${buildInClause(appCodes)})
       AND a.manifest_id = COALESCE(
         pa.latest_manifest_id,
         (
           SELECT pam.id
           FROM platform_app_manifests pam
           WHERE pam.app_code = a.app_code
             AND pam.status = 'active'
           ORDER BY pam.manifest_seq DESC, pam.id DESC
           LIMIT 1
         )
       )
     ORDER BY a.app_code, a.resource_code, a.action`,
    appCodes
  )
}

async function collectSubjects(tenantCode: string) {
  return queryRows<RowDataPacket[]>(
    `SELECT s.subject_type AS subjectType, s.subject_code AS subjectCode,
            s.display_name AS displayName, s.external_ref AS externalRef,
            parent.subject_code AS parentSubjectCode, s.status
     FROM tenant_subjects s
     LEFT JOIN tenant_subjects parent ON parent.id = s.parent_subject_id
     WHERE s.tenant_code = ?
       AND s.status = 'active'
     ORDER BY s.subject_type, s.subject_code`,
    [tenantCode]
  )
}

async function collectSubjectMemberships(tenantCode: string) {
  return queryRows<RowDataPacket[]>(
    `SELECT subject.subject_type AS subjectType,
            subject.subject_code AS subjectCode,
            container.subject_type AS containerSubjectType,
            container.subject_code AS containerSubjectCode,
            tsm.relation_type AS relationType,
            tsm.is_primary AS isPrimary,
            tsm.source,
            tsm.status
     FROM tenant_subject_memberships tsm
     INNER JOIN tenant_subjects subject
       ON subject.id = tsm.subject_id
      AND subject.tenant_code = tsm.tenant_code
      AND subject.status = 'active'
     INNER JOIN tenant_subjects container
       ON container.id = tsm.container_subject_id
      AND container.tenant_code = tsm.tenant_code
      AND container.status = 'active'
     WHERE tsm.tenant_code = ?
       AND tsm.status = 'active'
       AND subject.subject_type = 'user'
       AND container.subject_type IN ('department', 'job')
       AND tsm.relation_type IN ('member', 'manager', 'leader')
     ORDER BY subject.subject_code, container.subject_type, container.subject_code, tsm.relation_type`,
    [tenantCode]
  )
}

async function collectTenantRoles(tenantCode: string) {
  return queryRows<RowDataPacket[]>(
    `SELECT role_code AS roleCode, role_name AS roleName, role_type AS roleType,
            app_code AS appCode, description, source, source_role_code AS sourceRoleCode,
            source_manifest_id AS sourceManifestId, is_overridden AS isOverridden,
            is_assignable AS isAssignable, status
     FROM tenant_roles
     WHERE tenant_code = ?
       AND status = 'active'
     ORDER BY COALESCE(app_code, ''), role_code`,
    [tenantCode]
  )
}

async function collectTenantRolePermissions(tenantCode: string) {
  return queryRows<RowDataPacket[]>(
    `SELECT r.role_code AS roleCode, p.app_code AS appCode, p.resource_code AS resourceCode,
            p.action, p.source_manifest_action_id AS sourceManifestActionId,
            'custom' AS sourceType, NULL AS appRoleCode
     FROM tenant_role_permissions p
     INNER JOIN tenant_roles r
       ON r.id = p.role_id
      AND r.tenant_code = p.tenant_code
      AND r.status = 'active'
     WHERE p.tenant_code = ?
       AND NOT (p.app_code = 'console' AND r.role_code IN (${LEGACY_CONSOLE_VIEWER_ROLE_SQL}))
     UNION ALL
     SELECT r.role_code AS roleCode, arp.app_code AS appCode, arp.resource_code AS resourceCode,
            arp.action, arp.manifest_action_id AS sourceManifestActionId,
            'app_role' AS sourceType, ar.role_code AS appRoleCode
     FROM tenant_role_app_role_maps tram
     INNER JOIN tenant_roles r
       ON r.id = tram.role_id
      AND r.tenant_code = tram.tenant_code
      AND r.status = 'active'
     INNER JOIN platform_app_roles ar
      ON ar.role_code = tram.app_role_code
      AND ar.status = 'active'
      AND ar.app_code <> 'collab'
      AND ${excludeLegacyConsoleViewerRoleSql('ar')}
     INNER JOIN platform_app_role_permissions arp
       ON arp.app_role_id = ar.id
     WHERE tram.tenant_code = ?
     ORDER BY roleCode, appCode, resourceCode, action`,
    [tenantCode, tenantCode]
  )
}

async function collectTenantRoleScopes(tenantCode: string) {
  return queryRows<RowDataPacket[]>(
    `SELECT r.role_code AS roleCode, s.app_code AS appCode, s.resource_code AS resourceCode,
            s.action, s.scope_type AS scopeType, s.scope_value AS scopeValue,
            s.source_manifest_action_id AS sourceManifestActionId, s.status,
            'custom' AS sourceType, NULL AS appRoleCode
     FROM tenant_role_scopes s
     INNER JOIN tenant_roles r
       ON r.id = s.role_id
      AND r.tenant_code = s.tenant_code
      AND r.status = 'active'
     WHERE s.tenant_code = ?
       AND s.status = 'active'
       AND NOT (s.app_code = 'console' AND r.role_code IN (${LEGACY_CONSOLE_VIEWER_ROLE_SQL}))
     UNION ALL
     SELECT r.role_code AS roleCode, ars.app_code AS appCode, ars.resource_code AS resourceCode,
            ars.action, ars.scope_type AS scopeType, ars.scope_value AS scopeValue,
            ars.manifest_action_id AS sourceManifestActionId, ars.status,
            'app_role' AS sourceType, ar.role_code AS appRoleCode
     FROM tenant_role_app_role_maps tram
     INNER JOIN tenant_roles r
       ON r.id = tram.role_id
      AND r.tenant_code = tram.tenant_code
      AND r.status = 'active'
     INNER JOIN platform_app_roles ar
      ON ar.role_code = tram.app_role_code
      AND ar.status = 'active'
      AND ar.app_code <> 'collab'
      AND ${excludeLegacyConsoleViewerRoleSql('ar')}
     INNER JOIN platform_app_role_scopes ars
       ON ars.app_role_id = ar.id
      AND ars.status = 'active'
     WHERE tram.tenant_code = ?
     ORDER BY roleCode, appCode, resourceCode, action, scopeType, scopeValue`,
    [tenantCode, tenantCode]
  )
}

async function collectTenantRoleAppRoleMaps(tenantCode: string) {
  return queryRows<RowDataPacket[]>(
    `SELECT r.role_code AS roleCode, tram.app_role_code AS appRoleCode,
            tram.source_system_role_code AS sourceSystemRoleCode, tram.sort_order AS sortOrder
     FROM tenant_role_app_role_maps tram
     INNER JOIN tenant_roles r
       ON r.id = tram.role_id
      AND r.tenant_code = tram.tenant_code
      AND r.status = 'active'
     INNER JOIN platform_app_roles ar
      ON ar.role_code = tram.app_role_code
      AND ar.status = 'active'
      AND ar.app_code <> 'collab'
      AND ${excludeLegacyConsoleViewerRoleSql('ar')}
     WHERE tram.tenant_code = ?
     ORDER BY r.role_code, tram.sort_order, tram.app_role_code`,
    [tenantCode]
  )
}

async function collectSubjectRoles(tenantCode: string) {
  return queryRows<RowDataPacket[]>(
    `SELECT sr.id AS assignmentId,
            s.subject_type AS subjectType, s.subject_code AS subjectCode,
            r.role_code AS roleCode, sr.source_type AS sourceType, sr.source_id AS sourceId,
            sr.assignment_kind AS assignmentKind, sr.status,
            sr.granted_at AS grantedAt, sr.starts_at AS startsAt, sr.expired_at AS expiredAt
     FROM tenant_subject_roles sr
     INNER JOIN tenant_subjects s
       ON s.id = sr.subject_id
      AND s.tenant_code = sr.tenant_code
      AND s.status = 'active'
     INNER JOIN tenant_roles r
       ON r.id = sr.role_id
      AND r.tenant_code = sr.tenant_code
      AND r.status = 'active'
     WHERE sr.tenant_code = ?
       AND sr.status = 'active'
       AND (sr.starts_at IS NULL OR sr.starts_at <= UTC_TIMESTAMP())
       AND (sr.expired_at IS NULL OR sr.expired_at > UTC_TIMESTAMP())
     ORDER BY s.subject_type, s.subject_code, r.role_code, sr.source_type, sr.source_id_key`,
    [tenantCode]
  )
}

async function collectSubjectRoleScopes(tenantCode: string) {
  return queryRows<RowDataPacket[]>(
    `SELECT srs.assignment_id AS assignmentId,
            s.subject_type AS subjectType, s.subject_code AS subjectCode,
            r.role_code AS roleCode,
            sr.source_type AS sourceType, sr.source_id AS sourceId,
            srs.app_code AS appCode, srs.resource_code AS resourceCode, srs.action,
            srs.scope_dimension AS scopeDimension,
            srs.scope_predicate AS scopePredicate,
            srs.scope_value AS scopeValue,
            srs.scope_group AS scopeGroup,
            srs.scope_mode AS scopeMode,
            srs.status
     FROM tenant_subject_role_scopes srs
     INNER JOIN tenant_subject_roles sr
       ON sr.id = srs.assignment_id
      AND sr.tenant_code = srs.tenant_code
      AND sr.status = 'active'
      AND (sr.starts_at IS NULL OR sr.starts_at <= UTC_TIMESTAMP())
      AND (sr.expired_at IS NULL OR sr.expired_at > UTC_TIMESTAMP())
     INNER JOIN tenant_subjects s
       ON s.id = sr.subject_id
      AND s.tenant_code = sr.tenant_code
      AND s.status = 'active'
     INNER JOIN tenant_roles r
       ON r.id = sr.role_id
      AND r.tenant_code = sr.tenant_code
      AND r.status = 'active'
     WHERE srs.tenant_code = ?
       AND srs.status = 'active'
     ORDER BY s.subject_type, s.subject_code, r.role_code, srs.assignment_id, srs.scope_group, srs.scope_dimension, srs.scope_predicate, srs.scope_value`,
    [tenantCode]
  )
}

async function collectPermissionTemplates(tenantCode: string) {
  return queryRows<RowDataPacket[]>(
    `SELECT template_code AS templateCode, template_name AS templateName,
            template_type AS templateType, description, source,
            source_template_code AS sourceTemplateCode, is_overridden AS isOverridden,
            sort_order AS sortOrder, status
     FROM tenant_permission_templates
     WHERE tenant_code = ?
       AND status = 'active'
     ORDER BY sort_order, template_code`,
    [tenantCode]
  )
}

async function collectTemplateRoles(tenantCode: string) {
  return queryRows<RowDataPacket[]>(
    `SELECT t.template_code AS templateCode, r.role_code AS roleCode,
            tr.sort_order AS sortOrder
     FROM tenant_template_roles tr
     INNER JOIN tenant_permission_templates t
       ON t.id = tr.template_id
      AND t.tenant_code = tr.tenant_code
      AND t.status = 'active'
     INNER JOIN tenant_roles r
       ON r.id = tr.role_id
      AND r.tenant_code = tr.tenant_code
      AND r.status = 'active'
     WHERE tr.tenant_code = ?
     ORDER BY t.template_code, tr.sort_order, r.role_code`,
    [tenantCode]
  )
}

async function collectTemplateBindings(tenantCode: string) {
  return queryRows<RowDataPacket[]>(
    `SELECT t.template_code AS templateCode, b.subject_type AS subjectType,
            s.subject_code AS subjectCode, b.priority, b.status,
            b.start_at AS startAt, b.end_at AS endAt
     FROM tenant_template_bindings b
     INNER JOIN tenant_permission_templates t
       ON t.id = b.template_id
      AND t.tenant_code = b.tenant_code
      AND t.status = 'active'
     INNER JOIN tenant_subjects s
       ON s.id = b.subject_id
      AND s.tenant_code = b.tenant_code
      AND s.status = 'active'
     WHERE b.tenant_code = ?
       AND b.status = 'active'
       AND (b.start_at IS NULL OR b.start_at <= UTC_TIMESTAMP())
       AND (b.end_at IS NULL OR b.end_at > UTC_TIMESTAMP())
     ORDER BY b.priority, t.template_code, b.subject_type, s.subject_code`,
    [tenantCode]
  )
}

async function collectTemplateOverrides(tenantCode: string) {
  return queryRows<RowDataPacket[]>(
    `SELECT o.subject_type AS subjectType, s.subject_code AS subjectCode,
            r.role_code AS roleCode, o.override_type AS overrideType,
            t.template_code AS sourceTemplateCode, o.reason, o.status
     FROM tenant_template_overrides o
     INNER JOIN tenant_subjects s
       ON s.id = o.subject_id
      AND s.tenant_code = o.tenant_code
      AND s.status = 'active'
     INNER JOIN tenant_roles r
       ON r.id = o.role_id
      AND r.tenant_code = o.tenant_code
      AND r.status = 'active'
     LEFT JOIN tenant_permission_templates t
       ON t.id = o.source_template_id
      AND t.tenant_code = o.tenant_code
     WHERE o.tenant_code = ?
       AND o.status = 'active'
     ORDER BY o.subject_type, s.subject_code, r.role_code, o.override_type, COALESCE(t.template_code, '')`,
    [tenantCode]
  )
}

async function collectAppRoles(appCodes: string[]) {
  return queryRows<RowDataPacket[]>(
    `SELECT role_code AS roleCode, role_name AS roleName, role_type AS roleType,
            app_code AS appCode, description, is_required AS isRequired, status
     FROM platform_app_roles
     WHERE status = 'active'
       AND app_code <> 'collab'
       AND ${excludeLegacyConsoleViewerRoleSql('platform_app_roles')}
       ${hasAppCodes(appCodes) ? `AND app_code IN (${buildInClause(appCodes)})` : ''}
     ORDER BY COALESCE(app_code, ''), role_code`,
    appCodes
  )
}

async function collectAppRolePermissions(appCodes: string[]) {
  const appFilter = hasAppCodes(appCodes)
    ? `AND (ar.app_code IN (${buildInClause(appCodes)}) OR p.app_code IN (${buildInClause(appCodes)}))`
    : ''

  return queryRows<RowDataPacket[]>(
    `SELECT ar.role_code AS roleCode, p.app_code AS appCode, p.resource_code AS resourceCode,
            p.action, p.manifest_action_id AS manifestActionId
     FROM platform_app_role_permissions p
     INNER JOIN platform_app_roles ar ON ar.id = p.app_role_id
     WHERE ar.status = 'active'
       AND ar.app_code <> 'collab'
       AND ${excludeLegacyConsoleViewerRoleSql('ar')}
       ${appFilter}
     ORDER BY ar.role_code, p.app_code, p.resource_code, p.action`,
    hasAppCodes(appCodes) ? [...appCodes, ...appCodes] : []
  )
}

async function collectAppRoleScopes(appCodes: string[]) {
  const appFilter = hasAppCodes(appCodes)
    ? `AND (ar.app_code IN (${buildInClause(appCodes)}) OR s.app_code IN (${buildInClause(appCodes)}))`
    : ''

  return queryRows<RowDataPacket[]>(
    `SELECT ar.role_code AS roleCode, s.app_code AS appCode, s.resource_code AS resourceCode,
            s.action, s.scope_type AS scopeType, s.scope_value AS scopeValue,
            s.manifest_action_id AS manifestActionId, s.status
     FROM platform_app_role_scopes s
     INNER JOIN platform_app_roles ar ON ar.id = s.app_role_id
     WHERE ar.status = 'active'
       AND ar.app_code <> 'collab'
       AND ${excludeLegacyConsoleViewerRoleSql('ar')}
       AND s.status = 'active'
       ${appFilter}
     ORDER BY ar.role_code, s.app_code, s.resource_code, s.action, s.scope_type, s.scope_value`,
    hasAppCodes(appCodes) ? [...appCodes, ...appCodes] : []
  )
}

async function collectSystemRoles() {
  return queryRows<RowDataPacket[]>(
    `SELECT role_code AS roleCode, role_name AS roleName, role_type AS roleType,
            description, is_required AS isRequired, sort_order AS sortOrder, status
     FROM platform_system_roles
     WHERE status = 'active'
     ORDER BY sort_order, role_code`
  )
}

async function collectSystemAppRoleMaps(appCodes: string[]) {
  const appFilter = hasAppCodes(appCodes)
    ? `AND ar.app_code IN (${buildInClause(appCodes)})`
    : ''

  return queryRows<RowDataPacket[]>(
    `SELECT sr.role_code AS systemRoleCode, ar.role_code AS appRoleCode,
            ar.app_code AS appCode, sarm.sort_order AS sortOrder
     FROM platform_system_app_role_maps sarm
     INNER JOIN platform_system_roles sr
       ON sr.id = sarm.system_role_id
      AND sr.status = 'active'
     INNER JOIN platform_app_roles ar
       ON ar.id = sarm.app_role_id
      AND ar.status = 'active'
      AND ar.app_code <> 'collab'
      AND ${excludeLegacyConsoleViewerRoleSql('ar')}
     WHERE 1 = 1
       ${appFilter}
     ORDER BY sr.sort_order, sr.role_code, sarm.sort_order, ar.role_code`,
    appCodes
  )
}

async function collectCapabilities(tenantCode: string, environment: string) {
  const rows = await queryRows<RowDataPacket[]>(
    `SELECT l.license_code AS licenseCode, lc.capability_code AS capabilityCode,
            lc.capability_value AS capabilityValue, pc.capability_name AS capabilityName,
            pc.capability_type AS capabilityType, pc.value_schema_json AS valueSchemaJson
     FROM licenses l
     INNER JOIN license_deployments ld
       ON ld.license_id = l.id
      AND ld.status = 'active'
      AND (ld.effective_until IS NULL OR ld.effective_until > UTC_TIMESTAMP())
     INNER JOIN deployments d
       ON d.id = ld.deployment_id
      AND d.environment = ?
     INNER JOIN license_capabilities lc ON lc.license_id = l.id
     LEFT JOIN platform_capabilities pc ON pc.capability_code = lc.capability_code
     WHERE l.tenant_code = ?
       AND l.status = 'active'
       AND (l.expires_at IS NULL OR l.expires_at > UTC_TIMESTAMP())
     ORDER BY l.license_code, lc.capability_code`,
    [environment, tenantCode]
  )

  return rows.map(row => ({
    ...row,
    valueSchemaJson: parseJsonColumn(row.valueSchemaJson, null)
  }))
}

function collectBaselinePermissions(appCodes: string[]) {
  const appCodeSet = new Set(appCodes)
  return BASELINE_PERMISSIONS
    .filter(permission => appCodeSet.has(permission.appCode))
    .map(permission => ({ ...permission }))
}

function normalizePolicyBundleInput(input: string | {
  tenantCode: string
  environment?: unknown
  platformBaseUrl?: string | null
}) {
  if (typeof input === 'string') {
    return {
      tenantCode: input.trim(),
      environment: DEFAULT_DEPLOYMENT_ENVIRONMENT,
      platformBaseUrl: null
    }
  }

  return {
    tenantCode: String(input.tenantCode || '').trim(),
    environment: normalizeDeploymentEnvironment(input.environment),
    platformBaseUrl: String(input.platformBaseUrl || '').trim().replace(/\/+$/, '') || null
  }
}

export async function buildPolicyBundlePayload(input: string | {
  tenantCode: string
  environment?: unknown
  platformBaseUrl?: string | null
}) {
  const { tenantCode, environment, platformBaseUrl } = normalizePolicyBundleInput(input)
  const tenant = await findTenant(tenantCode)
  if (!tenant) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant not found: tenantCode=${tenantCode}`
    })
  }

  const deployments = await findTargetDeployments(tenantCode, environment)
  const deploymentSite = await findDeploymentSiteProjection(tenantCode, environment)
  const tenantSettings = parseTenantSettings(tenant.settingsJson)
  const consoleLogin = consoleLoginSettings(tenantSettings, environment)
  const appCodes = await collectTenantAppCodes(tenantCode, environment, deployments)
  const baselinePermissions = collectBaselinePermissions(appCodes)
  const generatedAt = new Date().toISOString()

  const [
    applications,
    manifestResources,
    manifestActions,
    subjects,
    subjectMemberships,
    roles,
    roleAppRoleMaps,
    rolePermissions,
    roleScopes,
    subjectRoles,
    subjectRoleScopes,
    permissionTemplates,
    templateRoles,
    templateBindings,
    templateOverrides,
    appRoles,
    appRolePermissions,
    appRoleScopes,
    systemRoles,
    systemAppRoleMaps,
    capabilities
  ] = await Promise.all([
    collectApplications(tenantCode, environment, appCodes),
    collectManifestResources(appCodes),
    collectManifestActions(appCodes),
    collectSubjects(tenantCode),
    collectSubjectMemberships(tenantCode),
    collectTenantRoles(tenantCode),
    collectTenantRoleAppRoleMaps(tenantCode),
    collectTenantRolePermissions(tenantCode),
    collectTenantRoleScopes(tenantCode),
    collectSubjectRoles(tenantCode),
    collectSubjectRoleScopes(tenantCode),
    collectPermissionTemplates(tenantCode),
    collectTemplateRoles(tenantCode),
    collectTemplateBindings(tenantCode),
    collectTemplateOverrides(tenantCode),
    collectAppRoles(appCodes),
    collectAppRolePermissions(appCodes),
    collectAppRoleScopes(appCodes),
    collectSystemRoles(),
    collectSystemAppRoleMaps(appCodes),
    collectCapabilities(tenantCode, environment)
  ])

  return {
    schemaVersion: POLICY_BUNDLE_SCHEMA_VERSION,
    generatedAt,
    environment,
    tenant: {
      tenantCode: tenant.tenantCode,
      tenantName: tenant.tenantName,
      tenantType: tenant.tenantType,
      status: tenant.status
    },
    platform: {
      baseUrl: platformBaseUrl
    },
    consoleLogin,
    deployment: deploymentSite
      ? {
          siteId: deploymentSite.siteId,
          siteCode: deploymentSite.siteCode,
          publicUrl: deploymentSite.publicUrl,
          rootAppCode: deploymentSite.rootAppCode,
          environment: deploymentSite.environment,
          status: deploymentSite.status
        }
      : null,
    deployments: deployments.map(item => ({
      deploymentId: item.id,
      deploymentCode: item.deploymentCode,
      appCode: item.appCode,
      environment: item.environment,
      siteId: item.siteId,
      basePath: item.basePath,
      apiBase: item.apiBase,
      routeSource: item.routeSource,
      status: item.status
    })),
    applications,
    manifestResources,
    manifestActions,
    subjects,
    subjectMemberships,
    roles,
    roleAppRoleMaps,
    rolePermissions,
    roleScopes,
    subjectRoles,
    subjectRoleScopes,
    permissionTemplates,
    templateRoles,
    templateBindings,
    templateOverrides,
    appRoles,
    appRolePermissions,
    appRoleScopes,
    systemRoles,
    systemAppRoleMaps,
    baselinePermissions,
    capabilities
  }
}

export async function generatePolicyBundle(input: {
  tenantCode: string
  environment?: unknown
  platformBaseUrl?: string | null
  expiresAt?: string | null
}): Promise<GeneratedPolicyBundle> {
  const tenantCode = String(input.tenantCode || '').trim()
  if (!tenantCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenantCode is required'
    })
  }

  const environment = normalizeDeploymentEnvironment(input.environment)
  const platformBaseUrl = String(input.platformBaseUrl || '').trim().replace(/\/+$/, '') || null
  await syncInheritedSystemRoles(tenantCode)
  const payload = await buildPolicyBundlePayload({ tenantCode, environment, platformBaseUrl })
  const targetDeployments = Array.isArray(payload.deployments) ? payload.deployments : []

  if (targetDeployments.length === 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `active deployment is required before generating policy bundle: tenantCode=${tenantCode}, environment=${environment}`
    })
  }

  const payloadJson = stableStringify(payload)
  const bundleHash = hashBundlePayload(payloadJson)
  const signed = await sign(payloadJson)
  const now = new Date()
  const issuedAt = toSqlDateTime(now)
  const signedAt = issuedAt
  const expiresAt = input.expiresAt || null

  return withTransaction(async (tx) => {
    const seqRow = await tx.queryRow<NextSeqRow>(
      `SELECT COUNT(*) + 1 AS nextSeq
       FROM policy_bundles
       WHERE tenant_code = ?
         AND environment = ?`,
      [tenantCode, environment]
    )
    const nextSeq = Math.max(1, Number(seqRow?.nextSeq || 1))
    const bundleVersion = `pv_${environment}_${toVersionTimestamp(now)}_${String(nextSeq).padStart(4, '0')}`
    const bundleUri = `inline://policy-bundles/${tenantCode}/${environment}/${bundleVersion}`

    const result = await tx.execute<ResultSetHeader>(
      `INSERT INTO policy_bundles
        (tenant_code, environment, bundle_version, bundle_hash, bundle_payload_json, bundle_uri,
         signature, signed_by_kid, signed_at, schema_version, issued_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        tenantCode,
        environment,
        bundleVersion,
        bundleHash,
        payloadJson,
        bundleUri,
        signed.signature,
        signed.kid,
        signedAt,
        POLICY_BUNDLE_SCHEMA_VERSION,
        issuedAt,
        expiresAt
      ]
    )

    const bundleId = result.insertId
    const deployments = await tx.queryRows<DeploymentTargetRow[]>(
      `SELECT id, deployment_code AS deploymentCode, app_code AS appCode, subscription_id AS subscriptionId,
              environment,
              site_id AS siteId, base_path AS basePath, api_base AS apiBase, route_source AS routeSource,
              status
       FROM deployments
       WHERE tenant_code = ?
         AND environment = ?
         AND status = 'active'
       ORDER BY app_code, id`,
      [tenantCode, environment]
    )

    for (const deployment of deployments) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO policy_bundle_targets
          (bundle_id, deployment_id, status, created_at, updated_at)
         VALUES (?, ?, 'pending', UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           updated_at = UTC_TIMESTAMP()`,
        [bundleId, deployment.id]
      )
    }

    return {
      tenantCode,
      environment,
      bundleId,
      bundleVersion,
      bundleHash,
      bundleUri,
      schemaVersion: POLICY_BUNDLE_SCHEMA_VERSION,
      payload: parseJsonColumn<Record<string, unknown>>(payloadJson, {}),
      signature: signed.signature,
      signedByKid: signed.kid,
      alg: signed.alg,
      signedAt,
      issuedAt,
      expiresAt,
      targets: deployments.map(item => ({
        deploymentId: item.id,
        deploymentCode: item.deploymentCode,
        appCode: item.appCode,
        environment: item.environment
      }))
    }
  })
}

export async function findPolicyBundleForDeployment(input: {
  deploymentId: number
  version?: string | null
}) {
  const version = String(input.version || '').trim()
  const selectColumns = `pb.id, pb.id AS bundle_id, pb.tenant_code, pb.environment, pbt.deployment_id, pb.bundle_version,
          pb.bundle_hash, pb.bundle_payload_json, pb.bundle_uri, pb.signature,
          pb.signed_by_kid, pb.signed_at, pb.schema_version, pb.issued_at,
          pb.expires_at, pb.status, pb.created_at`

  if (version) {
    return queryRow<RuntimePolicyBundleRow>(
      `SELECT ${selectColumns}
       FROM policy_bundle_targets pbt
       INNER JOIN policy_bundles pb ON pb.id = pbt.bundle_id
       WHERE pbt.deployment_id = ?
         AND pb.bundle_version = ?
         AND pb.status = 'active'
         AND (pb.expires_at IS NULL OR pb.expires_at > UTC_TIMESTAMP())
       LIMIT 1`,
      [input.deploymentId, version]
    )
  }

  return queryRow<RuntimePolicyBundleRow>(
    `SELECT ${selectColumns}
     FROM (
       SELECT MAX(pbt.bundle_id) AS bundle_id
       FROM policy_bundle_targets pbt
       INNER JOIN policy_bundles pb2 ON pb2.id = pbt.bundle_id
       WHERE pbt.deployment_id = ?
         AND pb2.status = 'active'
         AND (pb2.expires_at IS NULL OR pb2.expires_at > UTC_TIMESTAMP())
     ) latest
     INNER JOIN policy_bundles pb ON pb.id = latest.bundle_id
     INNER JOIN policy_bundle_targets pbt
       ON pbt.bundle_id = pb.id
      AND pbt.deployment_id = ?
     WHERE latest.bundle_id IS NOT NULL`,
    [input.deploymentId, input.deploymentId]
  )
}

export async function findOrGeneratePolicyBundleForDeployment(input: {
  deploymentId: number
  tenantCode: string
  version?: string | null
}) {
  const version = String(input.version || '').trim()
  const existing = await findPolicyBundleForDeployment({
    deploymentId: input.deploymentId,
    version
  })

  if (existing || version) {
    return existing
  }

  const deployment = await queryRow<DeploymentEnvironmentRow>(
    `SELECT environment
     FROM deployments
     WHERE id = ?
       AND tenant_code = ?
     LIMIT 1`,
    [input.deploymentId, input.tenantCode]
  )

  await generatePolicyBundle({
    tenantCode: input.tenantCode,
    environment: deployment?.environment || DEFAULT_DEPLOYMENT_ENVIRONMENT
  })

  return findPolicyBundleForDeployment({
    deploymentId: input.deploymentId
  })
}

export function parsePolicyBundlePayload(value: unknown) {
  return parseJsonColumn<Record<string, unknown>>(value, {})
}

export function formatPolicyBundleSignature(bundle: {
  signature: string | null
  signed_by_kid: string | null
  signed_at?: string | null
}) {
  return {
    signature: bundle.signature,
    kid: bundle.signed_by_kid,
    alg: POLICY_BUNDLE_SIGNATURE_ALG,
    signedAt: bundle.signed_at || null
  }
}

function normalizeEtagToken(value: string) {
  const trimmed = value.trim()
  const withoutWeakPrefix = trimmed.toLowerCase().startsWith('w/')
    ? trimmed.slice(2).trim()
    : trimmed

  return withoutWeakPrefix.replace(/^"|"$/g, '')
}

export function setPolicyBundleCacheHeaders(event: H3Event, bundle: { bundle_hash: string, bundle_version: string }) {
  setResponseHeader(event, 'ETag', `"${bundle.bundle_hash}"`)
  setResponseHeader(event, 'x-policy-bundle-version', bundle.bundle_version)
}

export function maybeReturnPolicyBundleNotModified(event: H3Event, bundle: { bundle_hash: string, bundle_version: string }) {
  setPolicyBundleCacheHeaders(event, bundle)

  const ifNoneMatch = getHeader(event, 'if-none-match')
  if (!ifNoneMatch) {
    return false
  }

  const matched = ifNoneMatch
    .split(',')
    .map(normalizeEtagToken)
    .some(value => value === '*' || value === bundle.bundle_hash)

  if (!matched) {
    return false
  }

  setResponseStatus(event, 304)
  return true
}

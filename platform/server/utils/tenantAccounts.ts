import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { AuthenticatedRequestContext } from '~~/server/utils/access'
import { requireAuthenticated } from '~~/server/utils/access'
import type { PlatformSessionScope } from '~~/server/utils/platformAuth'
import { queryRow, queryRows, withTransaction } from '~~/server/utils/db'

type TenantType = 'enterprise' | 'team' | 'trial'
type AuthMode = 'oidc' | 'gitlab_oidc' | 'cas' | 'wecom'
type DeploymentMode = 'managed-control-plane' | 'self-hosted-enterprise'

interface AccountRow extends RowDataPacket {
  id: number
  uid: string
  username: string
  email: string
  display_name: string
  account_type: string
}

interface TenantMembershipRow extends RowDataPacket {
  account_id: number
  tenant_code: string
  membership_status: string
  is_owner: number
}

interface CurrentTenantRow extends RowDataPacket {
  id: number
  tenant_code: string
  tenant_name: string
  display_name: string | null
  tenant_type: TenantType
  primary_domain: string | null
  industry_category: string | null
  company_size: string | null
  province: string | null
  city: string | null
  status: string
  default_auth_mode: AuthMode
  default_deployment_mode: DeploymentMode
  onboarding_stage: string
  membership_status: string
  is_owner: number
  joined_at: string | null
  last_accessed_at: string | null
  role_codes: string | null
  created_at: string
  updated_at: string
}

export interface PlatformAccountRef {
  accountId: number
  uid: string
  username: string
  email: string
  displayName: string
  accountType: string
}

export interface CurrentTenantItem {
  id: number
  tenantCode: string
  tenantName: string
  displayName: string | null
  tenantType: TenantType
  primaryDomain: string | null
  industryCategory: string | null
  companySize: string | null
  province: string | null
  city: string | null
  status: string
  defaultAuthMode: AuthMode
  defaultDeploymentMode: DeploymentMode
  onboardingStage: string
  membershipStatus: string
  isOwner: boolean
  roleCodes: string[]
  joinedAt: string | null
  lastAccessedAt: string | null
  createdAt: string
  updatedAt: string
}

const ALLOWED_TENANT_TYPES = new Set<TenantType>(['enterprise', 'team', 'trial'])
const ALLOWED_AUTH_MODES = new Set<AuthMode>(['oidc', 'gitlab_oidc', 'cas', 'wecom'])
const ALLOWED_DEPLOYMENT_MODES = new Set<DeploymentMode>(['managed-control-plane', 'self-hosted-enterprise'])
const ALLOWED_INDUSTRY_CATEGORIES = new Set('ABCDEFGHIJKLMNOPQRST'.split(''))
const ALLOWED_COMPANY_SIZES = new Set(['micro', 'small', 'medium', 'large'])

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function normalizeNullableString(value: unknown) {
  const normalized = normalizeString(value)
  return normalized || null
}

function requireAllowed<T extends string>(value: unknown, field: string, allowed: Set<T>, fallback: T): T {
  const normalized = normalizeString(value) || fallback
  if (!allowed.has(normalized as T)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} must be one of: ${Array.from(allowed).join(', ')}`
    })
  }

  return normalized as T
}

function optionalAllowed(value: unknown, field: string, allowed: Set<string>) {
  const normalized = normalizeString(value)
  if (!normalized) return null
  if (!allowed.has(normalized)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} must be one of: ${Array.from(allowed).join(', ')}`
    })
  }

  return normalized
}

function toTenantItem(row: CurrentTenantRow): CurrentTenantItem {
  return {
    id: Number(row.id),
    tenantCode: row.tenant_code,
    tenantName: row.tenant_name,
    displayName: row.display_name,
    tenantType: row.tenant_type,
    primaryDomain: row.primary_domain,
    industryCategory: row.industry_category,
    companySize: row.company_size,
    province: row.province,
    city: row.city,
    status: row.status,
    defaultAuthMode: row.default_auth_mode,
    defaultDeploymentMode: row.default_deployment_mode,
    onboardingStage: row.onboarding_stage,
    membershipStatus: row.membership_status,
    isOwner: Boolean(row.is_owner),
    roleCodes: String(row.role_codes || '').split(',').map(item => item.trim()).filter(Boolean),
    joinedAt: row.joined_at,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export async function resolvePlatformAccount(auth: AuthenticatedRequestContext): Promise<PlatformAccountRef> {
  if (auth.session) {
    return {
      accountId: auth.session.accountId,
      uid: auth.session.uid,
      username: auth.session.username,
      email: auth.session.email,
      displayName: auth.session.displayName,
      accountType: auth.session.accountType
    }
  }

  const account = await queryRow<AccountRow>(
    `SELECT id, uid, username, email, display_name, account_type
     FROM platform_accounts
     WHERE uid = ?
       AND status = 'active'
     LIMIT 1`,
    [auth.uid]
  )

  if (!account) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `platform account not found for uid=${auth.uid}`
    })
  }

  return {
    accountId: Number(account.id),
    uid: account.uid,
    username: account.username,
    email: account.email,
    displayName: account.display_name,
    accountType: account.account_type
  }
}

export async function requireAuthenticatedPlatformAccount(event: H3Event, options: {
  scope?: PlatformSessionScope
} = {}) {
  const auth = await requireAuthenticated(event, {
    scope: options.scope
  })
  const account = await resolvePlatformAccount(auth)

  return {
    auth,
    account
  }
}

export async function requireActiveTenantMembership(auth: AuthenticatedRequestContext, tenantCode: string) {
  const normalizedTenantCode = normalizeString(tenantCode)
  const account = await resolvePlatformAccount(auth)

  const membership = await queryRow<TenantMembershipRow>(
    `SELECT account_id, tenant_code, status AS membership_status, is_owner
     FROM tenant_account_memberships
     WHERE tenant_code = ?
       AND account_id = ?
       AND status = 'active'
     LIMIT 1`,
    [normalizedTenantCode, account.accountId]
  )

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `tenant membership denied for uid=${account.uid}, tenantCode=${normalizedTenantCode}`
    })
  }

  return {
    account,
    tenantCode: membership.tenant_code,
    membershipStatus: membership.membership_status,
    isOwner: Boolean(membership.is_owner)
  }
}

export async function listCurrentTenants(auth: AuthenticatedRequestContext) {
  const account = await resolvePlatformAccount(auth)
  const rows = await queryRows<CurrentTenantRow[]>(
    `SELECT t.id,
            t.tenant_code,
            t.tenant_name,
            t.display_name,
            t.tenant_type,
            t.primary_domain,
            JSON_UNQUOTE(JSON_EXTRACT(t.settings_json, '$.industryCategory')) AS industry_category,
            JSON_UNQUOTE(JSON_EXTRACT(t.settings_json, '$.companySize')) AS company_size,
            JSON_UNQUOTE(JSON_EXTRACT(t.settings_json, '$.province')) AS province,
            JSON_UNQUOTE(JSON_EXTRACT(t.settings_json, '$.city')) AS city,
            t.status,
            t.default_auth_mode,
            t.default_deployment_mode,
            t.onboarding_stage,
            tam.status AS membership_status,
            tam.is_owner,
            tam.joined_at,
            tam.last_accessed_at,
            GROUP_CONCAT(DISTINCT tr.role_code ORDER BY tr.role_code SEPARATOR ',') AS role_codes,
            t.created_at,
            t.updated_at
     FROM tenant_account_memberships tam
     INNER JOIN tenants t
       ON t.tenant_code = tam.tenant_code
     LEFT JOIN tenant_account_roles tar
       ON tar.tenant_code = tam.tenant_code
      AND tar.account_id = tam.account_id
      AND (tar.expired_at IS NULL OR tar.expired_at > UTC_TIMESTAMP())
     LEFT JOIN tenant_roles tr
       ON tr.id = tar.role_id
      AND tr.tenant_code = tar.tenant_code
      AND tr.status = 'active'
     WHERE tam.account_id = ?
       AND tam.status = 'active'
     GROUP BY t.id, t.tenant_code, t.tenant_name, t.display_name, t.tenant_type, t.primary_domain,
              t.settings_json,
              t.status, t.default_auth_mode, t.default_deployment_mode, t.onboarding_stage,
              tam.status, tam.is_owner, tam.joined_at, tam.last_accessed_at, t.created_at, t.updated_at
     ORDER BY COALESCE(tam.last_accessed_at, tam.joined_at, t.created_at) DESC,
              t.tenant_code ASC`,
    [account.accountId]
  )

  return rows.map(toTenantItem)
}

export async function createOwnedTenant(auth: AuthenticatedRequestContext, payload: Record<string, unknown>) {
  const account = await resolvePlatformAccount(auth)
  const tenantName = normalizeString(payload.tenantName)
  if (!tenantName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenantName is required'
    })
  }

  const displayName = normalizeNullableString(payload.displayName)
  const tenantType = requireAllowed(payload.tenantType, 'tenantType', ALLOWED_TENANT_TYPES, 'enterprise')
  const primaryDomain = normalizeNullableString(payload.primaryDomain)
  const defaultAuthMode = requireAllowed(payload.defaultAuthMode, 'defaultAuthMode', ALLOWED_AUTH_MODES, 'oidc')
  const defaultDeploymentMode = requireAllowed(
    payload.defaultDeploymentMode,
    'defaultDeploymentMode',
    ALLOWED_DEPLOYMENT_MODES,
    'managed-control-plane'
  )
  const industryCategory = optionalAllowed(payload.industryCategory, 'industryCategory', ALLOWED_INDUSTRY_CATEGORIES)
  const companySize = optionalAllowed(payload.companySize, 'companySize', ALLOWED_COMPANY_SIZES)
  const province = normalizeNullableString(payload.province)
  const city = normalizeNullableString(payload.city)
  const settingsJson = JSON.stringify({
    industryCategory: industryCategory || null,
    companySize: companySize || null,
    province,
    city
  })

  const tenantCode = await withTransaction(async (tx) => {
    const latestTenant = await tx.queryRow<RowDataPacket & { tenant_code: string | null }>(
      `SELECT tenant_code
       FROM tenants
       WHERE tenant_code REGEXP '^C[0-9]{6}$'
       ORDER BY tenant_code DESC
       LIMIT 1
       FOR UPDATE`
    )

    const latestCode = typeof latestTenant?.tenant_code === 'string'
      ? latestTenant.tenant_code
      : null
    const nextSequence = latestCode ? Number.parseInt(latestCode.slice(1), 10) + 1 : 1
    const nextTenantCode = `C${String(nextSequence).padStart(6, '0')}`

    await tx.execute<ResultSetHeader>(
      `INSERT INTO tenants
        (tenant_code, tenant_name, display_name, tenant_type, primary_domain, status,
         default_auth_mode, default_deployment_mode, owner_contact_email,
         settings_json, onboarding_stage, activated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 'draft', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        nextTenantCode,
        tenantName,
        displayName,
        tenantType,
        primaryDomain,
        defaultAuthMode,
        defaultDeploymentMode,
        account.email || null,
        settingsJson
      ]
    )

    await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_account_memberships
        (tenant_code, account_id, status, is_owner, invited_by_account_id, invited_at, joined_at, last_accessed_at, created_at, updated_at)
       VALUES (?, ?, 'active', 1, NULL, NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         status = 'active',
         is_owner = 1,
         joined_at = COALESCE(joined_at, UTC_TIMESTAMP()),
         last_accessed_at = UTC_TIMESTAMP(),
         updated_at = UTC_TIMESTAMP()`,
      [nextTenantCode, account.accountId]
    )

    return nextTenantCode
  })

  const tenants = await listCurrentTenants(auth)
  const created = tenants.find(item => item.tenantCode === tenantCode)
  if (!created) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load created tenant membership'
    })
  }

  return created
}

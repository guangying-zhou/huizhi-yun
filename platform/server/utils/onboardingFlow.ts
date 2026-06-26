import { createHash } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { queryRow, queryRows, withTransaction } from '~~/server/utils/db'
import { exportPubkey, sign } from '~~/server/utils/platformSigning'
import { issueRuntimeToken, type RuntimeCredentialSnapshot } from '~~/server/utils/runtimeToken'
import { generatePolicyBundle, type GeneratedPolicyBundle } from '~~/server/utils/policyBundle'
import { CONSOLE_APP_CODE, requireConsoleApplicationRegistered } from '~~/server/utils/consoleApp'
import { ensureConsoleVaultMasterKey, fingerprintConsoleVaultMasterKey } from '~~/server/utils/deploymentBootstrapSecrets'
import { buildDeploymentRouteDefaults, findActiveDeploymentSite, type DeploymentSiteRow } from '~~/server/utils/deploymentSites'
import { DEFAULT_DEPLOYMENT_ENVIRONMENT, normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

type TransactionExecutor = {
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

type StepStatus = 'pending' | 'running' | 'completed' | 'blocked' | 'failed'

interface TenantRow extends RowDataPacket {
  id: number
  tenant_code: string
  tenant_name: string
  display_name: string | null
  tenant_type: string
  primary_domain: string | null
  status: string
  default_auth_mode: string
  default_deployment_mode: string
  onboarding_stage: string
}

interface PlanRow extends RowDataPacket {
  id: number
  plan_code: string
  plan_name: string
  plan_tier: string
  status: string
}

interface PlanAppRow extends RowDataPacket {
  app_code: string
  app_name: string
  role_in_plan: string
  pin_release_id: number | null
  target_release_id: number | null
  runtime_mode: string
  service_role: string
  sort_order: number
}

interface PlanCapabilityRow extends RowDataPacket {
  capability_code: string
  capability_value: string | null
}

interface SubscriptionRow extends RowDataPacket {
  id: number
  app_code: string
  subscription_no: string
}

interface DeploymentRow extends RowDataPacket {
  id: number
  tenant_code: string
  app_code: string
  subscription_id: number
  site_id: number | null
  base_path: string | null
  api_base: string | null
  route_source: string
  deployment_code: string
  deployment_name: string
  deployment_mode: string
  environment: string
  status: string
  license_status: string
  connectivity_status: string
  created_at: string
  updated_at: string
}

interface LicenseRow extends RowDataPacket {
  id: number
  license_code: string
  tenant_code: string
  subscription_id: number
  plan_code: string
  status: string
  issued_at: string
  expires_at: string | null
  grace_until: string | null
  payload_hash: string
  signed_token: string | null
}

interface OnboardingStepRow extends RowDataPacket {
  step_code: string
  step_name: string
  step_order: number
  step_status: StepStatus
  step_payload_json: unknown
  blocker_reason: string | null
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

interface CountRow extends RowDataPacket {
  total: number
}

interface AccountIdRow extends RowDataPacket {
  id: number
}

export interface OnboardingInput {
  tenantCode?: string | null
  tenantName: string
  displayName?: string | null
  tenantType?: string | null
  primaryDomain?: string | null
  defaultAuthMode?: string | null
  defaultDeploymentMode?: string | null
  planCode: string
  deploymentCode?: string | null
  deploymentName?: string | null
  deploymentMode?: string | null
  environment?: string | null
  deploymentEnvironment?: string | null
  region?: string | null
  deploymentPublicUrl?: string | null
  rootAppCode?: string | null
  consoleBasePath?: string | null
  platformBaseUrl?: string | null
  licenseExpiresAt?: string | null
  runtimeTokenExpiresAt?: string | null
  generateBundle?: boolean
  forceBundle?: boolean
  requestedByUid?: string | null
}

export interface OnboardingFlowResult {
  tenant: {
    tenantCode: string
    tenantName: string
    status: string
    onboardingStage: string
  }
  plan: {
    planCode: string
    planName: string
  } | null
  tenantSubscriptionId: number | null
  subscriptions: Array<{
    id: number
    appCode: string
    subscriptionNo: string
  }>
  deployment: {
    id: number
    deploymentCode: string
    appCode: string
    deploymentName: string
    deploymentMode: string
    environment: string
    publicUrl: string | null
    rootAppCode: string | null
    basePath: string | null
    apiBase: string | null
    status: string
  } | null
  license: {
    id: number
    licenseCode: string
    status: string
    signedToken: string | null
  } | null
  runtimeCredential: RuntimeCredentialSnapshot | null
  runtimeToken: string | null
  bundle: GeneratedPolicyBundle | null
  subjectReady: boolean
  consoleEnv: string | null
  licenseArtifact: string | null
  steps: OnboardingStep[]
}

export interface OnboardingStep {
  stepCode: string
  stepName: string
  stepOrder: number
  stepStatus: StepStatus
  payload: Record<string, unknown> | null
  blockerReason: string | null
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

const ONBOARDING_STEPS = [
  { code: 'tenant', name: '创建租户', order: 10 },
  { code: 'console_app', name: '确认 Console 应用', order: 20 },
  { code: 'subscription', name: '创建订阅与应用权益', order: 30 },
  { code: 'deployment', name: '创建 Console Deployment', order: 40 },
  { code: 'license', name: '签发 License', order: 50 },
  { code: 'runtime_token', name: '签发 Runtime Token', order: 60 },
  { code: 'subject_sync', name: 'Subject 最小实体同步', order: 70 },
  { code: 'bundle', name: '生成首版 Policy Bundle', order: 80 },
  { code: 'finalize', name: '生成交付材料', order: 90 }
]

function normalizeNullableString(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const normalized = String(value).trim()
  return normalized || null
}

function requireNonEmpty(value: unknown, field: string) {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} is required`
    })
  }
  return normalized
}

function toSqlDateTime(value: unknown) {
  const rawValue = normalizeNullableString(value)
  if (!rawValue) {
    return null
  }

  const date = new Date(rawValue.includes('T') ? rawValue : `${rawValue.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'datetime value is invalid'
    })
  }

  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function hashJson(payload: unknown) {
  return `sha256_${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`
}

function buildTenantSubscriptionNo(tenantCode: string) {
  return `TSUB-${tenantCode}-${Date.now()}`
}

function buildAppSubscriptionNo(tenantCode: string, appCode: string) {
  return `SUB-${tenantCode}-${appCode.slice(0, 16)}-${Date.now()}`
}

function onboardingEnvironment(input: Pick<OnboardingInput, 'environment' | 'deploymentEnvironment'>) {
  return normalizeDeploymentEnvironment(input.deploymentEnvironment || input.environment)
}

function buildDeploymentCode(tenantCode: string, environment: string) {
  return environment === DEFAULT_DEPLOYMENT_ENVIRONMENT
    ? `${tenantCode}-console`
    : `${tenantCode}-${environment}-console`
}

function buildLicenseCode(tenantCode: string, environment: string) {
  return environment === DEFAULT_DEPLOYMENT_ENVIRONMENT
    ? `LIC-${tenantCode}-CONSOLE`
    : `LIC-${tenantCode}-CONSOLE-${environment.toUpperCase()}`
}

function parseJsonPayload(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>
    } catch {
      return null
    }
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return null
}

function escapeEnvValue(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`
}

function getPlatformBaseUrl(input?: string | null) {
  const explicit = normalizeNullableString(input)
  if (explicit) {
    return explicit.replace(/\/$/, '')
  }

  const config = useRuntimeConfig()
  const configured = normalizeNullableString(config.public?.serviceUrl)
  return (configured || 'http://localhost:3010').replace(/\/$/, '')
}

async function findPlatformAccountId(tx: TransactionExecutor, uid?: string | null) {
  const normalizedUid = normalizeNullableString(uid)
  if (!normalizedUid) {
    return null
  }

  const row = await tx.queryRow<AccountIdRow>(
    `SELECT id
     FROM platform_accounts
     WHERE uid = ?
     LIMIT 1`,
    [normalizedUid]
  )

  return row?.id || null
}

async function ensureOnboardingSteps(tx: TransactionExecutor, tenantCode: string) {
  for (const step of ONBOARDING_STEPS) {
    await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_onboarding_steps
        (tenant_code, step_code, step_name, step_order, step_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         step_name = VALUES(step_name),
         step_order = VALUES(step_order),
         updated_at = UTC_TIMESTAMP()`,
      [tenantCode, step.code, step.name, step.order]
    )
  }
}

async function writeStep(
  tx: TransactionExecutor,
  tenantCode: string,
  stepCode: string,
  status: StepStatus,
  payload: Record<string, unknown> | null = null,
  blockerReason: string | null = null
) {
  const step = ONBOARDING_STEPS.find(item => item.code === stepCode)
  const stepName = step?.name || stepCode
  const stepOrder = step?.order || 100
  const payloadJson = payload ? JSON.stringify(payload) : null
  await tx.execute<ResultSetHeader>(
    `INSERT INTO tenant_onboarding_steps
      (tenant_code, step_code, step_name, step_order, step_status, step_payload_json,
       blocker_reason, started_at, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(),
       CASE WHEN ? = 'completed' THEN UTC_TIMESTAMP() ELSE NULL END, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       step_name = VALUES(step_name),
       step_order = VALUES(step_order),
       step_status = VALUES(step_status),
       step_payload_json = VALUES(step_payload_json),
       blocker_reason = VALUES(blocker_reason),
       started_at = COALESCE(started_at, UTC_TIMESTAMP()),
       completed_at = CASE WHEN VALUES(step_status) = 'completed' THEN UTC_TIMESTAMP() ELSE NULL END,
       updated_at = UTC_TIMESTAMP()`,
    [tenantCode, stepCode, stepName, stepOrder, status, payloadJson, blockerReason, status]
  )
}

async function setStep(
  tenantCode: string,
  stepCode: string,
  status: StepStatus,
  payload: Record<string, unknown> | null = null,
  blockerReason: string | null = null
) {
  await withTransaction(async (tx) => {
    await ensureOnboardingSteps(tx, tenantCode)
    await writeStep(tx, tenantCode, stepCode, status, payload, blockerReason)
  })
}

async function updateTenantStage(tx: TransactionExecutor, tenantCode: string, stage: string, completed = false) {
  await tx.execute<ResultSetHeader>(
    `UPDATE tenants
     SET onboarding_stage = ?,
         onboarding_updated_at = UTC_TIMESTAMP(),
         onboarding_completed_at = CASE WHEN ? THEN COALESCE(onboarding_completed_at, UTC_TIMESTAMP()) ELSE onboarding_completed_at END,
         activated_at = CASE WHEN ? THEN COALESCE(activated_at, UTC_TIMESTAMP()) ELSE activated_at END,
         status = CASE WHEN ? THEN 'active' ELSE status END,
         updated_at = UTC_TIMESTAMP()
     WHERE tenant_code = ?`,
    [stage, completed ? 1 : 0, completed ? 1 : 0, completed ? 1 : 0, tenantCode]
  )
}

async function createOrUpdateTenant(tx: TransactionExecutor, input: OnboardingInput) {
  const tenantCodeInput = normalizeNullableString(input.tenantCode)
  const tenantName = requireNonEmpty(input.tenantName, 'tenantName')
  const displayName = normalizeNullableString(input.displayName)
  const tenantType = normalizeNullableString(input.tenantType) || 'enterprise'
  const primaryDomain = normalizeNullableString(input.primaryDomain)
  const defaultAuthMode = normalizeNullableString(input.defaultAuthMode) || 'oidc'
  const defaultDeploymentMode = normalizeNullableString(input.defaultDeploymentMode) || 'customer-hosted'

  if (tenantCodeInput) {
    const existing = await tx.queryRow<TenantRow>(
      `SELECT id, tenant_code, tenant_name, display_name, tenant_type, primary_domain,
              status, default_auth_mode, default_deployment_mode, onboarding_stage
       FROM tenants
       WHERE tenant_code = ?
       LIMIT 1
       FOR UPDATE`,
      [tenantCodeInput]
    )

    if (!existing) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `tenant not found: tenantCode=${tenantCodeInput}`
      })
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE tenants
       SET tenant_name = ?, display_name = ?, tenant_type = ?, primary_domain = ?,
           default_auth_mode = ?, default_deployment_mode = ?,
           onboarding_stage = CASE WHEN onboarding_stage = 'draft' THEN 'tenant_created' ELSE onboarding_stage END,
           onboarding_updated_at = UTC_TIMESTAMP(),
           updated_at = UTC_TIMESTAMP()
       WHERE tenant_code = ?`,
      [tenantName, displayName, tenantType, primaryDomain, defaultAuthMode, defaultDeploymentMode, tenantCodeInput]
    )

    return {
      ...existing,
      tenant_name: tenantName,
      display_name: displayName,
      tenant_type: tenantType,
      primary_domain: primaryDomain,
      default_auth_mode: defaultAuthMode,
      default_deployment_mode: defaultDeploymentMode
    }
  }

  const latestTenant = await tx.queryRow<RowDataPacket & { tenant_code: string }>(
    `SELECT tenant_code
     FROM tenants
     WHERE tenant_code REGEXP '^C[0-9]{6}$'
     ORDER BY tenant_code DESC
     LIMIT 1
     FOR UPDATE`
  )
  const latestCode = typeof latestTenant?.tenant_code === 'string' ? latestTenant.tenant_code : null
  const nextSequence = latestCode ? Number.parseInt(latestCode.slice(1), 10) + 1 : 1
  const tenantCode = `C${String(nextSequence).padStart(6, '0')}`

  const result = await tx.execute<ResultSetHeader>(
    `INSERT INTO tenants
      (tenant_code, tenant_name, display_name, tenant_type, primary_domain, status,
       default_auth_mode, default_deployment_mode, onboarding_stage, onboarding_updated_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 'tenant_created', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [tenantCode, tenantName, displayName, tenantType, primaryDomain, defaultAuthMode, defaultDeploymentMode]
  )

  return {
    id: result.insertId,
    tenant_code: tenantCode,
    tenant_name: tenantName,
    display_name: displayName,
    tenant_type: tenantType,
    primary_domain: primaryDomain,
    status: 'active',
    default_auth_mode: defaultAuthMode,
    default_deployment_mode: defaultDeploymentMode,
    onboarding_stage: 'tenant_created'
  } as TenantRow
}

async function loadPlan(tx: TransactionExecutor, planCode: string) {
  const plan = await tx.queryRow<PlanRow>(
    `SELECT id, plan_code, plan_name, plan_tier, status
     FROM platform_plans
     WHERE plan_code = ?
     LIMIT 1`,
    [planCode]
  )

  if (!plan) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `plan not found: planCode=${planCode}`
    })
  }

  if (plan.status !== 'active') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `plan is not active: planCode=${planCode}`
    })
  }

  return plan
}

async function loadPlanApps(tx: TransactionExecutor, planId: number) {
  const rows = await tx.queryRows<PlanAppRow[]>(
    `SELECT ppa.app_code, pa.app_name, ppa.role_in_plan, ppa.pin_release_id,
            COALESCE(
              ppa.pin_release_id,
              (
                SELECT pr.id
                FROM platform_app_releases pr
                WHERE pr.app_code = ppa.app_code
                  AND pr.status = 'released'
                ORDER BY pr.released_at DESC, pr.id DESC
                LIMIT 1
              )
            ) AS target_release_id,
            pa.runtime_mode, pa.service_role, ppa.sort_order
     FROM platform_plan_apps ppa
     INNER JOIN platform_applications pa ON pa.app_code = ppa.app_code
     WHERE ppa.plan_id = ?
       AND pa.status = 'active'
     ORDER BY ppa.role_in_plan ASC, ppa.sort_order ASC, ppa.app_code ASC`,
    [planId]
  )

  if (!rows.some(item => item.app_code === CONSOLE_APP_CODE)) {
    const consoleApp = await tx.queryRow<PlanAppRow>(
      `SELECT app_code, app_name, 'core' AS role_in_plan, NULL AS pin_release_id,
              NULL AS target_release_id, runtime_mode, service_role, 0 AS sort_order
       FROM platform_applications
       WHERE app_code = ?
       LIMIT 1`,
      [CONSOLE_APP_CODE]
    )
    if (consoleApp) {
      rows.unshift(consoleApp)
    }
  }

  return rows
}

async function loadPlanCapabilities(tx: TransactionExecutor, planId: number) {
  return tx.queryRows<PlanCapabilityRow[]>(
    `SELECT capability_code, capability_value
     FROM platform_plan_capabilities
     WHERE plan_id = ?
     ORDER BY capability_code`,
    [planId]
  )
}

async function ensureTenantSubscription(
  tx: TransactionExecutor,
  tenantCode: string,
  plan: PlanRow,
  createdByAccountId: number | null
) {
  const active = await tx.queryRow<RowDataPacket & { id: number }>(
    `SELECT id
     FROM tenant_subscriptions
     WHERE tenant_code = ?
       AND status = 'active'
     LIMIT 1
     FOR UPDATE`,
    [tenantCode]
  )

  if (active) {
    await tx.execute<ResultSetHeader>(
      `UPDATE tenant_subscriptions
       SET plan_code = ?, source = 'ops_grant', started_at = COALESCE(started_at, UTC_TIMESTAMP()),
           ended_at = NULL, created_by_account_id = COALESCE(created_by_account_id, ?),
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [plan.plan_code, createdByAccountId, active.id]
    )
    return Number(active.id)
  }

  const inserted = await tx.execute<ResultSetHeader>(
    `INSERT INTO tenant_subscriptions
      (subscription_no, tenant_code, plan_code, status, source, started_at, created_by_account_id, created_at, updated_at)
     VALUES (?, ?, ?, 'active', 'ops_grant', UTC_TIMESTAMP(), ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [buildTenantSubscriptionNo(tenantCode), tenantCode, plan.plan_code, createdByAccountId]
  )

  return inserted.insertId
}

async function ensureAppSubscriptions(
  tx: TransactionExecutor,
  tenantCode: string,
  tenantSubscriptionId: number,
  plan: PlanRow,
  apps: PlanAppRow[],
  createdByAccountId: number | null
) {
  const subscriptions: SubscriptionRow[] = []

  for (const app of apps) {
    const existing = await tx.queryRow<SubscriptionRow>(
      `SELECT id, app_code, subscription_no
       FROM subscriptions
       WHERE tenant_code = ?
         AND app_code = ?
         AND status = 'active'
       LIMIT 1
       FOR UPDATE`,
      [tenantCode, app.app_code]
    )

    if (existing) {
      await tx.execute<ResultSetHeader>(
        `UPDATE subscriptions
         SET tenant_subscription_id = ?, plan_code = ?, target_release_id = ?, source = 'ops_grant',
             started_at = COALESCE(started_at, UTC_TIMESTAMP()), ended_at = NULL,
             created_by_account_id = COALESCE(created_by_account_id, ?), updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [tenantSubscriptionId, plan.plan_code, app.target_release_id, createdByAccountId, existing.id]
      )
      subscriptions.push(existing)
      continue
    }

    const subscriptionNo = buildAppSubscriptionNo(tenantCode, app.app_code)
    const inserted = await tx.execute<ResultSetHeader>(
      `INSERT INTO subscriptions
        (subscription_no, tenant_subscription_id, tenant_code, app_code, plan_code,
         target_release_id, status, source, started_at, created_by_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 'ops_grant', UTC_TIMESTAMP(), ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [subscriptionNo, tenantSubscriptionId, tenantCode, app.app_code, plan.plan_code, app.target_release_id, createdByAccountId]
    )

    subscriptions.push({
      id: inserted.insertId,
      app_code: app.app_code,
      subscription_no: subscriptionNo
    } as SubscriptionRow)
  }

  return subscriptions
}

async function ensureConsoleDeployment(
  tx: TransactionExecutor,
  tenant: TenantRow,
  consoleSubscription: SubscriptionRow,
  site: DeploymentSiteRow,
  input: OnboardingInput
) {
  const environment = onboardingEnvironment(input)
  const deploymentCode = normalizeNullableString(input.deploymentCode) || buildDeploymentCode(tenant.tenant_code, environment)
  const deploymentName = normalizeNullableString(input.deploymentName)
    || (environment === DEFAULT_DEPLOYMENT_ENVIRONMENT ? `${tenant.tenant_name} · Console` : `${tenant.tenant_name} · ${environment} Console`)
  const deploymentMode = normalizeNullableString(input.deploymentMode) || 'customer-hosted'
  const region = normalizeNullableString(input.region)
  const route = buildDeploymentRouteDefaults({
    appCode: CONSOLE_APP_CODE,
    site,
    basePath: input.consoleBasePath
  })

  const existingByCode = await tx.queryRow<DeploymentRow>(
    `SELECT id, tenant_code, app_code, subscription_id, site_id, base_path, api_base, route_source,
            deployment_code, deployment_name, deployment_mode, environment,
            status, license_status, connectivity_status, created_at, updated_at
     FROM deployments
     WHERE deployment_code = ?
     LIMIT 1
     FOR UPDATE`,
    [deploymentCode]
  )

  if (
    existingByCode
    && (
      existingByCode.tenant_code !== tenant.tenant_code
      || existingByCode.app_code !== CONSOLE_APP_CODE
      || existingByCode.environment !== environment
    )
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `deploymentCode already used by tenantCode=${existingByCode.tenant_code}, appCode=${existingByCode.app_code}, environment=${existingByCode.environment}`
    })
  }

  const existing = existingByCode || await tx.queryRow<DeploymentRow>(
    `SELECT id, tenant_code, app_code, subscription_id, site_id, base_path, api_base, route_source,
            deployment_code, deployment_name, deployment_mode, environment,
            status, license_status, connectivity_status, created_at, updated_at
     FROM deployments
     WHERE tenant_code = ?
       AND app_code = ?
       AND environment = ?
       AND status = 'active'
     LIMIT 1
     FOR UPDATE`,
    [tenant.tenant_code, CONSOLE_APP_CODE, environment]
  )

  if (existing) {
    await tx.execute<ResultSetHeader>(
      `UPDATE deployments
       SET subscription_id = ?, deployment_code = ?, deployment_name = ?, deployment_mode = ?,
           site_id = ?, base_path = ?, api_base = ?, route_source = ?,
           environment = ?, region = ?, status = 'active',
           connectivity_status = COALESCE(connectivity_status, 'pending'),
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        consoleSubscription.id,
        deploymentCode,
        deploymentName,
        deploymentMode,
        route.siteId,
        route.basePath,
        route.apiBase,
        route.routeSource,
        environment,
        region,
        existing.id
      ]
    )
    return {
      ...existing,
      subscription_id: consoleSubscription.id,
      site_id: route.siteId,
      base_path: route.basePath,
      api_base: route.apiBase,
      route_source: route.routeSource,
      deployment_code: deploymentCode,
      deployment_name: deploymentName,
      deployment_mode: deploymentMode,
      environment,
      status: 'active'
    }
  }

  const inserted = await tx.execute<ResultSetHeader>(
    `INSERT INTO deployments
      (deployment_code, tenant_code, app_code, subscription_id, site_id, base_path, api_base, route_source,
       deployment_name, deployment_mode,
       environment, region, status, license_status, connectivity_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'pending', 'pending', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [
      deploymentCode,
      tenant.tenant_code,
      CONSOLE_APP_CODE,
      consoleSubscription.id,
      route.siteId,
      route.basePath,
      route.apiBase,
      route.routeSource,
      deploymentName,
      deploymentMode,
      environment,
      region
    ]
  )

  return {
    id: inserted.insertId,
    tenant_code: tenant.tenant_code,
    app_code: CONSOLE_APP_CODE,
    subscription_id: consoleSubscription.id,
    site_id: route.siteId,
    base_path: route.basePath,
    api_base: route.apiBase,
    route_source: route.routeSource,
    deployment_code: deploymentCode,
    deployment_name: deploymentName,
    deployment_mode: deploymentMode,
    environment,
    status: 'active',
    license_status: 'pending',
    connectivity_status: 'pending',
    created_at: nowSql(),
    updated_at: nowSql()
  } as DeploymentRow
}

async function buildSignedLicenseToken(payload: Record<string, unknown>) {
  const serialized = JSON.stringify(payload)
  const signed = await sign(serialized)

  return {
    token: JSON.stringify({
      schemaVersion: 'license-token.v1',
      payload,
      signature: signed.signature,
      kid: signed.kid,
      alg: signed.alg,
      signedAt: nowSql()
    }),
    kid: signed.kid,
    alg: signed.alg
  }
}

async function ensureConsoleLicense(
  tx: TransactionExecutor,
  tenant: TenantRow,
  plan: PlanRow,
  deployment: DeploymentRow,
  capabilities: PlanCapabilityRow[],
  input: OnboardingInput,
  consoleVaultMasterKey: string
) {
  const issuedAt = nowSql()
  const expiresAt = toSqlDateTime(input.licenseExpiresAt)
  const graceUntil = null
  const licenseCode = buildLicenseCode(tenant.tenant_code, deployment.environment || DEFAULT_DEPLOYMENT_ENVIRONMENT)
  const capabilityPayload = capabilities.map(item => ({
    capabilityCode: item.capability_code,
    capabilityValue: item.capability_value
  }))
  const payload = {
    schemaVersion: 'license.v1',
    licenseCode,
    tenantCode: tenant.tenant_code,
    planCode: plan.plan_code,
    appCode: CONSOLE_APP_CODE,
    deploymentId: deployment.id,
    deploymentCode: deployment.deployment_code,
    issuedAt,
    expiresAt,
    graceUntil,
    vault: {
      masterKeyRequired: true,
      masterKeyFingerprint: fingerprintConsoleVaultMasterKey(consoleVaultMasterKey),
      algorithm: 'aes-256-gcm'
    },
    capabilities: capabilityPayload
  }
  const payloadHash = hashJson(payload)
  const signed = await buildSignedLicenseToken(payload)

  const existing = await tx.queryRow<LicenseRow>(
    `SELECT id, license_code, tenant_code, subscription_id, plan_code, status,
            issued_at, expires_at, grace_until, payload_hash, signed_token
     FROM licenses
     WHERE tenant_code = ?
       AND license_code = ?
     LIMIT 1
     FOR UPDATE`,
    [tenant.tenant_code, licenseCode]
  )

  let licenseId = Number(existing?.id || 0)
  if (licenseId) {
    await tx.execute<ResultSetHeader>(
      `UPDATE licenses
       SET subscription_id = ?, plan_code = ?, status = 'active', issued_at = ?,
           expires_at = ?, grace_until = ?, payload_hash = ?, signed_token = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [deployment.subscription_id, plan.plan_code, issuedAt, expiresAt, graceUntil, payloadHash, signed.token, licenseId]
    )
  } else {
    const inserted = await tx.execute<ResultSetHeader>(
      `INSERT INTO licenses
        (license_code, subscription_id, tenant_code, plan_code, status, issued_at,
         expires_at, grace_until, payload_hash, signed_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [licenseCode, deployment.subscription_id, tenant.tenant_code, plan.plan_code, issuedAt, expiresAt, graceUntil, payloadHash, signed.token]
    )
    licenseId = inserted.insertId
  }

  await tx.execute<ResultSetHeader>(
    `UPDATE license_deployments
     SET status = 'inactive', effective_until = COALESCE(effective_until, UTC_TIMESTAMP())
     WHERE deployment_id = ?
       AND status = 'active'`,
    [deployment.id]
  )
  await tx.execute<ResultSetHeader>(
    `INSERT INTO license_deployments
      (license_id, deployment_id, effective_from, status, created_at)
     VALUES (?, ?, UTC_TIMESTAMP(), 'active', UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       status = 'active',
       effective_until = NULL`,
    [licenseId, deployment.id]
  )

  await tx.execute<ResultSetHeader>('DELETE FROM license_capabilities WHERE license_id = ?', [licenseId])

  for (const capability of capabilities) {
    await tx.execute<ResultSetHeader>(
      `INSERT INTO license_capabilities
        (license_id, capability_code, capability_value, created_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP())`,
      [licenseId, capability.capability_code, capability.capability_value]
    )
  }

  await tx.execute<ResultSetHeader>(
    `UPDATE deployments
     SET license_status = 'active', updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [deployment.id]
  )

  return {
    id: licenseId,
    license_code: licenseCode,
    tenant_code: tenant.tenant_code,
    subscription_id: deployment.subscription_id,
    plan_code: plan.plan_code,
    status: 'active',
    issued_at: issuedAt,
    expires_at: expiresAt,
    grace_until: graceUntil,
    payload_hash: payloadHash,
    signed_token: signed.token
  } as LicenseRow
}

async function hasActiveUserSubject(tenantCode: string) {
  const row = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM tenant_subjects
     WHERE tenant_code = ?
       AND subject_type = 'user'
       AND status = 'active'`,
    [tenantCode]
  )

  return Number(row?.total || 0) > 0
}

async function buildConsoleEnv(input: {
  tenantCode: string
  deploymentCode: string
  environment?: string | null
  runtimeToken?: string | null
  licenseToken?: string | null
  platformBaseUrl?: string | null
  deploymentPublicUrl?: string | null
  appBasePath?: string | null
  consoleVaultMasterKey?: string | null
}) {
  const pubkey = await exportPubkey()

  return [
    `HZY_PLATFORM_URL=${escapeEnvValue(getPlatformBaseUrl(input.platformBaseUrl))}`,
    `HZY_PLATFORM_TENANT_CODE=${escapeEnvValue(input.tenantCode)}`,
    `HZY_PLATFORM_DEPLOYMENT_CODE=${escapeEnvValue(input.deploymentCode)}`,
    `HZY_DEPLOYMENT_ENVIRONMENT=${escapeEnvValue(normalizeDeploymentEnvironment(input.environment))}`,
    `HZY_PLATFORM_RUNTIME_TOKEN=${escapeEnvValue(input.runtimeToken || '<rotate-runtime-token-to-display>')}`,
    `HZY_PLATFORM_SIGNING_KID=${escapeEnvValue(pubkey.kid)}`,
    `HZY_PLATFORM_SIGNING_PUBKEY=${escapeEnvValue(pubkey.publicKey)}`,
    `HZY_PLATFORM_LICENSE_TOKEN=${escapeEnvValue(input.licenseToken || '<platform-license-token>')}`,
    `HZY_DEPLOYMENT_PUBLIC_URL=${escapeEnvValue(input.deploymentPublicUrl || '<deployment-public-url>')}`,
    `HZY_APP_BASE_PATH=${escapeEnvValue(input.appBasePath || '/console/')}`,
    `NUXT_APP_BASE_URL=${escapeEnvValue(input.appBasePath || '/console/')}`,
    `HZY_CONSOLE_VAULT_MASTER_KEY=${escapeEnvValue(input.consoleVaultMasterKey || '<generated-console-vault-master-key>')}`
  ].join('\n')
}

async function loadSteps(tenantCode: string): Promise<OnboardingStep[]> {
  const rows = await queryRows<OnboardingStepRow[]>(
    `SELECT step_code, step_name, step_order, step_status, step_payload_json,
            blocker_reason, started_at, completed_at, updated_at
     FROM tenant_onboarding_steps
     WHERE tenant_code = ?
     ORDER BY step_order ASC, id ASC`,
    [tenantCode]
  )

  return rows.map(row => ({
    stepCode: row.step_code,
    stepName: row.step_name,
    stepOrder: row.step_order,
    stepStatus: row.step_status,
    payload: parseJsonPayload(row.step_payload_json),
    blockerReason: row.blocker_reason,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  }))
}

async function loadLatestConsoleDeployment(tenantCode: string, environment = DEFAULT_DEPLOYMENT_ENVIRONMENT) {
  const normalizedEnvironment = normalizeDeploymentEnvironment(environment)
  return queryRow<DeploymentRow>(
    `SELECT id, tenant_code, app_code, subscription_id, site_id, base_path, api_base, route_source,
            deployment_code, deployment_name,
            deployment_mode, environment, status, license_status, connectivity_status, created_at, updated_at
     FROM deployments
     WHERE tenant_code = ?
       AND app_code = ?
       AND environment = ?
     ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, updated_at DESC, id DESC
     LIMIT 1`,
    [tenantCode, CONSOLE_APP_CODE, normalizedEnvironment]
  )
}

async function loadLatestConsoleLicense(tenantCode: string, environment = DEFAULT_DEPLOYMENT_ENVIRONMENT) {
  const normalizedEnvironment = normalizeDeploymentEnvironment(environment)
  return queryRow<LicenseRow>(
    `SELECT l.id, l.license_code, l.tenant_code, l.subscription_id, l.plan_code, l.status,
            l.issued_at, l.expires_at, l.grace_until, l.payload_hash, l.signed_token
     FROM licenses l
     INNER JOIN deployments d ON d.subscription_id = l.subscription_id
     WHERE l.tenant_code = ?
       AND d.app_code = ?
       AND d.environment = ?
     ORDER BY l.issued_at DESC, l.id DESC
     LIMIT 1`,
    [tenantCode, CONSOLE_APP_CODE, normalizedEnvironment]
  )
}

async function loadTenantByCode(tenantCode: string) {
  return queryRow<TenantRow>(
    `SELECT id, tenant_code, tenant_name, display_name, tenant_type, primary_domain,
            status, default_auth_mode, default_deployment_mode, onboarding_stage
     FROM tenants
     WHERE tenant_code = ?
     LIMIT 1`,
    [tenantCode]
  )
}

export async function loadOnboardingStatus(tenantCodeInput: string, environmentInput?: unknown): Promise<OnboardingFlowResult> {
  const tenantCode = requireNonEmpty(tenantCodeInput, 'tenantCode')
  const environment = normalizeDeploymentEnvironment(environmentInput)
  const tenant = await loadTenantByCode(tenantCode)

  if (!tenant) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant not found: tenantCode=${tenantCode}`
    })
  }

  const deployment = await loadLatestConsoleDeployment(tenantCode, environment)
  const site = await findActiveDeploymentSite(tenantCode, null, environment)
  const license = await loadLatestConsoleLicense(tenantCode, environment)
  const steps = await loadSteps(tenantCode)
  const subjectReady = await hasActiveUserSubject(tenantCode)

  return {
    tenant: {
      tenantCode: tenant.tenant_code,
      tenantName: tenant.tenant_name,
      status: tenant.status,
      onboardingStage: tenant.onboarding_stage
    },
    plan: license
      ? {
          planCode: license.plan_code,
          planName: license.plan_code
        }
      : null,
    tenantSubscriptionId: null,
    subscriptions: [],
    deployment: deployment
      ? {
          id: deployment.id,
          deploymentCode: deployment.deployment_code,
          appCode: deployment.app_code,
          deploymentName: deployment.deployment_name,
          deploymentMode: deployment.deployment_mode,
          environment: deployment.environment,
          publicUrl: site?.public_url || null,
          rootAppCode: site?.root_app_code || null,
          basePath: deployment.base_path,
          apiBase: deployment.api_base,
          status: deployment.status
        }
      : null,
    license: license
      ? {
          id: license.id,
          licenseCode: license.license_code,
          status: license.status,
          signedToken: license.signed_token
        }
      : null,
    runtimeCredential: null,
    runtimeToken: null,
    bundle: null,
    subjectReady,
    consoleEnv: null,
    licenseArtifact: license?.signed_token || null,
    steps
  }
}

export async function startOnboarding(input: OnboardingInput): Promise<OnboardingFlowResult> {
  const planCode = requireNonEmpty(input.planCode, 'planCode')
  const environment = onboardingEnvironment(input)
  const generateBundleRequested = input.generateBundle !== false
  const requestedByUid = normalizeNullableString(input.requestedByUid)

  const prepared = await withTransaction(async (tx) => {
    const createdByAccountId = await findPlatformAccountId(tx, requestedByUid)
    const tenant = await createOrUpdateTenant(tx, input)
    await ensureOnboardingSteps(tx, tenant.tenant_code)
    await writeStep(tx, tenant.tenant_code, 'tenant', 'completed', { tenantCode: tenant.tenant_code })

    await requireConsoleApplicationRegistered(tx)
    await writeStep(tx, tenant.tenant_code, 'console_app', 'completed', { appCode: CONSOLE_APP_CODE })

    const plan = await loadPlan(tx, planCode)
    const apps = await loadPlanApps(tx, plan.id)
    const capabilities = await loadPlanCapabilities(tx, plan.id)
    const tenantSubscriptionId = await ensureTenantSubscription(tx, tenant.tenant_code, plan, createdByAccountId)
    const subscriptions = await ensureAppSubscriptions(tx, tenant.tenant_code, tenantSubscriptionId, plan, apps, createdByAccountId)
    const site = await findActiveDeploymentSite(tenant.tenant_code, tx, environment)
    if (!site) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `deployment site is not configured by tenant dashboard: tenantCode=${tenant.tenant_code}, environment=${environment}`
      })
    }

    await writeStep(tx, tenant.tenant_code, 'subscription', 'completed', {
      planCode: plan.plan_code,
      appCodes: subscriptions.map(item => item.app_code),
      environment,
      deploymentPublicUrl: site.public_url,
      rootAppCode: site.root_app_code
    })

    const consoleSubscription = subscriptions.find(item => item.app_code === CONSOLE_APP_CODE)
    if (!consoleSubscription) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: 'console subscription was not created'
      })
    }

    const deployment = await ensureConsoleDeployment(tx, tenant, consoleSubscription, site, input)
    await writeStep(tx, tenant.tenant_code, 'deployment', 'completed', {
      deploymentCode: deployment.deployment_code,
      environment: deployment.environment,
      basePath: deployment.base_path,
      apiBase: deployment.api_base
    })

    const consoleVaultMasterKey = await ensureConsoleVaultMasterKey({
      deploymentId: deployment.id,
      tenantCode: tenant.tenant_code,
      appCode: CONSOLE_APP_CODE,
      executor: tx
    })
    const license = await ensureConsoleLicense(tx, tenant, plan, deployment, capabilities, input, consoleVaultMasterKey)
    await writeStep(tx, tenant.tenant_code, 'license', 'completed', {
      licenseCode: license.license_code,
      capabilityCount: capabilities.length
    })
    await updateTenantStage(tx, tenant.tenant_code, 'runtime_token_pending')

    return {
      tenant,
      plan,
      tenantSubscriptionId,
      subscriptions,
      site,
      deployment,
      license
    }
  })

  const issued = await issueRuntimeToken({
    tenantCode: prepared.tenant.tenant_code,
    issuedByAccountId: null,
    expiresAt: toSqlDateTime(input.runtimeTokenExpiresAt)
  })

  await setStep(prepared.tenant.tenant_code, 'runtime_token', 'completed', {
    runtimeTokenLast4: issued.tokenLast4,
    expiresAt: issued.credential.expiresAt
  })

  let bundle: GeneratedPolicyBundle | null = null
  const subjectReady = await hasActiveUserSubject(prepared.tenant.tenant_code)

  if (subjectReady) {
    await setStep(prepared.tenant.tenant_code, 'subject_sync', 'completed', { subjectReady: true })
  } else {
    await setStep(
      prepared.tenant.tenant_code,
      'subject_sync',
      'blocked',
      { subjectReady: false },
      '需要先完成至少一次 subject_sync，并同步企业管理员 user subject'
    )
  }

  if (generateBundleRequested && (subjectReady || input.forceBundle)) {
    bundle = await generatePolicyBundle({
      tenantCode: prepared.tenant.tenant_code,
      environment,
      platformBaseUrl: input.platformBaseUrl
    })
    await setStep(prepared.tenant.tenant_code, 'bundle', 'completed', {
      bundleVersion: bundle.bundleVersion,
      bundleHash: bundle.bundleHash,
      forceBundle: Boolean(input.forceBundle)
    })
    await withTransaction(async (tx) => {
      await writeStep(tx, prepared.tenant.tenant_code, 'finalize', 'completed', {
        consoleEnvReady: true,
        licenseReady: Boolean(prepared.license.signed_token)
      })
      await updateTenantStage(tx, prepared.tenant.tenant_code, 'active', true)
    })
  } else if (generateBundleRequested) {
    await setStep(
      prepared.tenant.tenant_code,
      'bundle',
      'blocked',
      { subjectReady: false },
      'subject_sync 未完成，暂不生成首版 bundle'
    )
    await withTransaction(async (tx) => {
      await updateTenantStage(tx, prepared.tenant.tenant_code, 'awaiting_subject_sync')
    })
  }

  const consoleVaultMasterKey = await ensureConsoleVaultMasterKey({
    deploymentId: prepared.deployment.id,
    tenantCode: prepared.tenant.tenant_code,
    appCode: CONSOLE_APP_CODE
  })
  const consoleEnv = await buildConsoleEnv({
    tenantCode: prepared.tenant.tenant_code,
    deploymentCode: prepared.deployment.deployment_code,
    environment,
    runtimeToken: issued.token,
    licenseToken: prepared.license.signed_token,
    platformBaseUrl: input.platformBaseUrl,
    deploymentPublicUrl: prepared.site.public_url,
    appBasePath: prepared.deployment.base_path,
    consoleVaultMasterKey
  })
  const steps = await loadSteps(prepared.tenant.tenant_code)

  return {
    tenant: {
      tenantCode: prepared.tenant.tenant_code,
      tenantName: prepared.tenant.tenant_name,
      status: prepared.tenant.status,
      onboardingStage: bundle ? 'active' : 'awaiting_subject_sync'
    },
    plan: {
      planCode: prepared.plan.plan_code,
      planName: prepared.plan.plan_name
    },
    tenantSubscriptionId: prepared.tenantSubscriptionId,
    subscriptions: prepared.subscriptions.map(item => ({
      id: item.id,
      appCode: item.app_code,
      subscriptionNo: item.subscription_no
    })),
    deployment: {
      id: prepared.deployment.id,
      deploymentCode: prepared.deployment.deployment_code,
      appCode: prepared.deployment.app_code,
      deploymentName: prepared.deployment.deployment_name,
      deploymentMode: prepared.deployment.deployment_mode,
      environment: prepared.deployment.environment,
      publicUrl: prepared.site.public_url,
      rootAppCode: prepared.site.root_app_code,
      basePath: prepared.deployment.base_path,
      apiBase: prepared.deployment.api_base,
      status: prepared.deployment.status
    },
    license: {
      id: prepared.license.id,
      licenseCode: prepared.license.license_code,
      status: prepared.license.status,
      signedToken: prepared.license.signed_token
    },
    runtimeCredential: issued.credential,
    runtimeToken: issued.token,
    bundle,
    subjectReady,
    consoleEnv,
    licenseArtifact: prepared.license.signed_token,
    steps
  }
}

export async function finalizeOnboarding(input: {
  tenantCode: string
  environment?: string | null
  platformBaseUrl?: string | null
  rotateRuntimeToken?: boolean
  runtimeTokenExpiresAt?: string | null
  forceBundle?: boolean
}) {
  const tenantCode = requireNonEmpty(input.tenantCode, 'tenantCode')
  const environment = normalizeDeploymentEnvironment(input.environment)
  const tenant = await loadTenantByCode(tenantCode)
  const deployment = await loadLatestConsoleDeployment(tenantCode, environment)
  const license = await loadLatestConsoleLicense(tenantCode, environment)

  if (!tenant || !deployment || !license) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `onboarding prerequisites are missing: tenantCode=${tenantCode}`
    })
  }

  let runtimeToken: string | null = null
  let runtimeCredential: RuntimeCredentialSnapshot | null = null
  if (input.rotateRuntimeToken) {
    const issued = await issueRuntimeToken({
      tenantCode,
      issuedByAccountId: null,
      expiresAt: toSqlDateTime(input.runtimeTokenExpiresAt)
    })
    runtimeToken = issued.token
    runtimeCredential = issued.credential
    await setStep(tenantCode, 'runtime_token', 'completed', {
      runtimeTokenLast4: issued.tokenLast4,
      rotated: true
    })
  }

  const subjectReady = await hasActiveUserSubject(tenantCode)
  let bundle: GeneratedPolicyBundle | null = null

  if (subjectReady || input.forceBundle) {
    await setStep(tenantCode, 'subject_sync', subjectReady ? 'completed' : 'blocked', {
      subjectReady,
      forceBundle: Boolean(input.forceBundle)
    }, subjectReady ? null : 'forceBundle=true，subject_sync gate 被人工跳过')
    bundle = await generatePolicyBundle({
      tenantCode,
      environment,
      platformBaseUrl: input.platformBaseUrl
    })
    await withTransaction(async (tx) => {
      await writeStep(tx, tenantCode, 'bundle', 'completed', {
        bundleVersion: bundle!.bundleVersion,
        bundleHash: bundle!.bundleHash,
        forceBundle: Boolean(input.forceBundle)
      })
      await writeStep(tx, tenantCode, 'finalize', 'completed', {
        consoleEnvReady: Boolean(runtimeToken),
        licenseReady: Boolean(license.signed_token)
      })
      await updateTenantStage(tx, tenantCode, 'active', true)
    })
  } else {
    await withTransaction(async (tx) => {
      await writeStep(
        tx,
        tenantCode,
        'subject_sync',
        'blocked',
        { subjectReady: false },
        '需要先完成至少一次 subject_sync，并同步企业管理员 user subject'
      )
      await writeStep(
        tx,
        tenantCode,
        'bundle',
        'blocked',
        { subjectReady: false },
        'subject_sync 未完成，暂不生成首版 bundle'
      )
      await updateTenantStage(tx, tenantCode, 'awaiting_subject_sync')
    })
  }

  const consoleVaultMasterKey = await ensureConsoleVaultMasterKey({
    deploymentId: deployment.id,
    tenantCode,
    appCode: CONSOLE_APP_CODE
  })
  const site = await findActiveDeploymentSite(tenantCode, null, environment)
  const consoleEnv = await buildConsoleEnv({
    tenantCode,
    deploymentCode: deployment.deployment_code,
    environment,
    runtimeToken,
    licenseToken: license.signed_token,
    platformBaseUrl: input.platformBaseUrl,
    deploymentPublicUrl: site?.public_url,
    appBasePath: deployment.base_path,
    consoleVaultMasterKey
  })
  const status = await loadOnboardingStatus(tenantCode, environment)

  return {
    ...status,
    runtimeCredential,
    runtimeToken,
    bundle,
    subjectReady,
    consoleEnv,
    licenseArtifact: license.signed_token
  }
}

export async function runOnboardingStep(input: {
  tenantCode: string
  stepCode: string
  environment?: string | null
  platformBaseUrl?: string | null
  rotateRuntimeToken?: boolean
  runtimeTokenExpiresAt?: string | null
  forceBundle?: boolean
}) {
  const tenantCode = requireNonEmpty(input.tenantCode, 'tenantCode')
  const stepCode = requireNonEmpty(input.stepCode, 'stepCode')
  const environment = normalizeDeploymentEnvironment(input.environment)

  if (stepCode === 'console_app') {
    await withTransaction(async (tx) => {
      await requireConsoleApplicationRegistered(tx)
      await ensureOnboardingSteps(tx, tenantCode)
      await writeStep(tx, tenantCode, 'console_app', 'completed', { appCode: CONSOLE_APP_CODE })
    })
    return loadOnboardingStatus(tenantCode, environment)
  }

  if (stepCode === 'runtime_token') {
    const issued = await issueRuntimeToken({
      tenantCode,
      issuedByAccountId: null,
      expiresAt: toSqlDateTime(input.runtimeTokenExpiresAt)
    })
    await setStep(tenantCode, 'runtime_token', 'completed', {
      runtimeTokenLast4: issued.tokenLast4,
      rotated: true
    })
    const status = await loadOnboardingStatus(tenantCode, environment)
    const deployment = await loadLatestConsoleDeployment(tenantCode, environment)
    return {
      ...status,
      runtimeCredential: issued.credential,
      runtimeToken: issued.token,
      consoleEnv: deployment
        ? await buildConsoleEnv({
            tenantCode,
            deploymentCode: deployment.deployment_code,
            environment,
            runtimeToken: issued.token,
            licenseToken: (await loadLatestConsoleLicense(tenantCode, environment))?.signed_token || null,
            platformBaseUrl: input.platformBaseUrl,
            deploymentPublicUrl: (await findActiveDeploymentSite(tenantCode, null, environment))?.public_url,
            appBasePath: deployment.base_path,
            consoleVaultMasterKey: await ensureConsoleVaultMasterKey({
              deploymentId: deployment.id,
              tenantCode,
              appCode: CONSOLE_APP_CODE
            })
          })
        : null
    }
  }

  if (stepCode === 'bundle' || stepCode === 'finalize') {
    return finalizeOnboarding({
      tenantCode,
      environment,
      platformBaseUrl: input.platformBaseUrl,
      rotateRuntimeToken: input.rotateRuntimeToken,
      runtimeTokenExpiresAt: input.runtimeTokenExpiresAt,
      forceBundle: input.forceBundle
    })
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: `unsupported onboarding step: ${stepCode}`
  })
}

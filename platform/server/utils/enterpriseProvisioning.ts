import { createHash } from 'node:crypto'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import type { TransactionExecutor } from './db'
import type { EnterpriseEntitlement } from './enterpriseEntitlement.ts'
import { enterpriseStatusAt } from './enterpriseEntitlement.ts'
import type { EnterpriseProvisioningTenantRow as TenantRow, EnterpriseProvisioningPlanRow as PlanRow, EnterpriseProvisioningSubscriptionRow as SubscriptionRow, EnterpriseProvisioningDeploymentRow as DeploymentRow, EnterpriseProvisioningLicenseRow as LicenseRow, OnboardingInput } from './onboardingFlow'
import { buildDeploymentRouteDefaults, type DeploymentSiteRow } from './deploymentSites'
import { ensureConsoleVaultMasterKey, fingerprintConsoleVaultMasterKey } from './deploymentBootstrapSecrets'
import { sign } from './platformSigning'
import { parseManifestResources } from './appManifestResources'

type Row = RowDataPacket & Record<string, unknown>
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function parse(value: unknown) {
  return typeof value === 'string' ? JSON.parse(value) : value
}

/** Host composition is a technical dependency, never a substitute for registered logical permissions. */
export async function requireEnterpriseProvisioningManifests(tx: TransactionExecutor) {
  const host = await tx.queryRow<Row>('SELECT m.manifest_json FROM platform_applications a INNER JOIN platform_app_manifests m ON m.id = a.latest_manifest_id AND m.app_code = a.app_code WHERE a.app_code = \'enterprise\' AND a.status = \'active\' AND m.status = \'active\'')
  const manifest = parse(host?.manifest_json)
  const composition = manifest?.composition
  if (composition?.kind !== 'hzy-enterprise-composition' || !Array.isArray(composition.modules) || !composition.modules.length) throw new Error('enterprise_provisioning_manifest_required')
  for (const module of composition.modules) {
    if (!module.appCode || module.appCode === 'account' || module.appCode === 'platform' || module.manifest?.appCode !== module.appCode) throw new Error('enterprise_provisioning_manifest_invalid')
    const registered = await tx.queryRow<Row>('SELECT m.id, m.manifest_json FROM platform_applications a INNER JOIN platform_app_manifests m ON m.id = a.latest_manifest_id AND m.app_code = a.app_code WHERE a.app_code = ? AND a.status = \'active\' AND m.status = \'active\'', [module.appCode])
    const source = parse(registered?.manifest_json)
    const expectedHash = createHash('sha256').update(canonical(module.manifest)).digest('hex')
    if (!registered || expectedHash !== module.manifestHash || canonical(source) !== canonical(module.manifest)) throw new Error('enterprise_provisioning_logical_manifest_required')
    const actions = await tx.queryRows<Row[]>('SELECT resource_code, action FROM platform_app_manifest_resource_actions WHERE manifest_id = ? AND app_code = ? AND status = \'active\'', [registered.id, module.appCode])
    for (const resource of parseManifestResources(module.manifest)) {
      for (const action of resource.actions || []) {
        const code = action.action
        if (!actions.some(row => row.resource_code === resource.resourceCode && row.action === code)) throw new Error('enterprise_provisioning_logical_actions_required')
      }
    }
  }
}

/** Existing onboarding calls this instead of any legacy subscription/license upsert. */
export async function prepareEnterpriseProvisioning(tx: TransactionExecutor, input: { tenant: TenantRow, site: DeploymentSiteRow, environment: string, options: OnboardingInput, accountId: number | null }) {
  const { tenant, site, environment, options, accountId } = input
  const locked = await tx.queryRow<Row>('SELECT tenant_code, status FROM tenants WHERE tenant_code = ? FOR UPDATE', [tenant.tenant_code])
  const currentRow = await tx.queryRow<Row>('SELECT c.revision, e.entitlement_json FROM tenant_enterprise_entitlement_current c INNER JOIN tenant_enterprise_entitlements e ON e.tenant_code = c.tenant_code AND e.revision = c.revision WHERE c.tenant_code = ? FOR UPDATE', [tenant.tenant_code])
  const qualification = parse(currentRow?.entitlement_json) as EnterpriseEntitlement | undefined
  if (locked?.status !== 'active' || !qualification || qualification.tenantCode !== tenant.tenant_code || qualification.schemaVersion !== 'enterprise-entitlement.v1' || qualification.productCode !== 'enterprise-full' || qualification.revision !== Number(currentRow?.revision) || enterpriseStatusAt(qualification, new Date().toISOString()) !== 'active') throw new Error('enterprise_provisioning_qualification_inactive')
  if (options.licenseExpiresAt || options.runtimeTokenExpiresAt) throw new Error('enterprise_provisioning_period_override_forbidden')
  const runtimeCredential = await tx.queryRow<Row>('SELECT status,revoked_at,expires_at FROM tenant_runtime_credentials WHERE tenant_code = ? FOR UPDATE', [tenant.tenant_code])
  if (runtimeCredential && (runtimeCredential.status !== 'active' || runtimeCredential.revoked_at || (runtimeCredential.expires_at && new Date(String(runtimeCredential.expires_at).replace(' ', 'T') + (String(runtimeCredential.expires_at).endsWith('Z') ? '' : 'Z')).getTime() <= Date.now()))) throw new Error('enterprise_runtime_credential_inactive')
  const technicalKey = (kind: string) => `${kind}-${createHash('sha256').update(`${tenant.tenant_code}:${environment}:${qualification.revision}`).digest('hex').slice(0, 40)}`
  const confirmedOrder = await tx.queryRow<Row>('SELECT order_id FROM tenant_enterprise_order_fulfillments WHERE tenant_code = ? ORDER BY result_revision DESC LIMIT 1', [tenant.tenant_code])
  // Converted existing enterprises are also eligible; qualification's signed source is authoritative.
  await requireEnterpriseProvisioningManifests(tx)
  const from = qualification.effectiveFrom.replace('T', ' ').replace('Z', '')
  const until = qualification.end.kind === 'finite' ? qualification.end.effectiveUntil.replace('T', ' ').replace('Z', '') : null
  const parent = await tx.queryRow<Row>('SELECT id FROM tenant_subscriptions WHERE tenant_code = ? AND status = \'active\' LIMIT 1 FOR UPDATE', [tenant.tenant_code])
  const parentId = parent ? Number(parent.id) : (await tx.execute<ResultSetHeader>('INSERT INTO tenant_subscriptions (subscription_no,tenant_code,plan_code,status,source,started_at,ended_at,current_order_id,created_by_account_id,created_at,updated_at) VALUES (?,?,\'enterprise-full\',\'active\',\'enterprise_technical\',?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())', [technicalKey('ETSUB'), tenant.tenant_code, from, until, confirmedOrder?.order_id || null, accountId])).insertId
  const subscriptions: SubscriptionRow[] = []
  const deployments: DeploymentRow[] = []
  for (const appCode of ['console', 'enterprise']) {
    const registered = await tx.queryRow<Row>('SELECT app_code FROM platform_applications WHERE app_code = ? AND status = \'active\'', [appCode])
    if (!registered) throw new Error('enterprise_provisioning_application_required')
    let subscription = await tx.queryRow<SubscriptionRow>('SELECT id,app_code,subscription_no FROM subscriptions WHERE tenant_code = ? AND app_code = ? AND status = \'active\' LIMIT 1 FOR UPDATE', [tenant.tenant_code, appCode])
    if (!subscription) {
      const no = technicalKey(`ESUB-${appCode}`)
      const inserted = await tx.execute<ResultSetHeader>('INSERT INTO subscriptions (subscription_no,tenant_subscription_id,tenant_code,app_code,plan_code,status,source,started_at,ended_at,created_by_account_id,created_at,updated_at) VALUES (?,?,?,?,\'enterprise-full\',\'active\',\'enterprise_technical\',?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())', [no, parentId, tenant.tenant_code, appCode, from, until, accountId])
      subscription = { id: inserted.insertId, app_code: appCode, subscription_no: no } as SubscriptionRow
    }
    subscriptions.push(subscription)
    const deploymentCode = appCode === 'console' && options.deploymentCode ? options.deploymentCode : `${tenant.tenant_code}-${environment}-${appCode}`
    const route = buildDeploymentRouteDefaults({ appCode, site, ...(appCode === 'console' && options.consoleBasePath ? { basePath: options.consoleBasePath } : {}) })
    let deployment = await tx.queryRow<DeploymentRow>('SELECT * FROM deployments WHERE tenant_code = ? AND app_code = ? AND environment = ? ORDER BY id DESC LIMIT 1 FOR UPDATE', [tenant.tenant_code, appCode, environment])
    if (deployment) {
      if (deployment.status !== 'active' || ['suspended', 'disabled', 'revoked'].includes(deployment.license_status)) throw new Error('enterprise_provisioning_deployment_inactive')
      if (deployment.site_id !== site.id || deployment.base_path !== route.basePath || deployment.api_base !== route.apiBase || (appCode === 'console' && options.deploymentCode && deployment.deployment_code !== options.deploymentCode)) throw new Error('enterprise_provisioning_deployment_conflict')
    } else {
      const inserted = await tx.execute<ResultSetHeader>('INSERT INTO deployments (deployment_code,tenant_code,app_code,subscription_id,site_id,base_path,api_base,route_source,deployment_name,deployment_mode,environment,region,status,license_status,connectivity_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,\'active\',\'pending\',\'pending\',UTC_TIMESTAMP(),UTC_TIMESTAMP())', [deploymentCode, tenant.tenant_code, appCode, subscription.id, route.siteId, route.basePath, route.apiBase, route.routeSource, `${tenant.tenant_name} · ${appCode}`, options.deploymentMode || tenant.default_deployment_mode || 'customer-hosted', environment, options.region || null])
      deployment = await tx.queryRow<DeploymentRow>('SELECT * FROM deployments WHERE id = ?', [inserted.insertId])
    }
    if (!deployment) throw new Error('enterprise_provisioning_deployment_missing')
    deployments.push(deployment)
  }
  const deployment = deployments.find(row => row.app_code === 'console')!
  const priorLicense = await tx.queryRow<Row>('SELECT l.status FROM licenses l INNER JOIN license_deployments ld ON ld.license_id = l.id WHERE ld.deployment_id = ? AND l.tenant_code = ? ORDER BY l.issued_at DESC, l.id DESC LIMIT 1 FOR UPDATE', [deployment.id, tenant.tenant_code])
  if (priorLicense && ['revoked', 'suspended', 'disabled'].includes(String(priorLicense.status))) throw new Error('enterprise_provisioning_license_inactive')
  const licenseCode = `ELIC-${tenant.tenant_code}-${environment}-${qualification.revision}`
  const masterKey = await ensureConsoleVaultMasterKey({ deploymentId: deployment.id, tenantCode: tenant.tenant_code, appCode: 'console', executor: tx })
  let license = await tx.queryRow<LicenseRow>('SELECT * FROM licenses WHERE tenant_code = ? AND license_code = ? FOR UPDATE', [tenant.tenant_code, licenseCode])
  if (license) {
    if (license.status !== 'active' || license.subscription_id !== deployment.subscription_id) throw new Error('enterprise_provisioning_license_inactive')
  } else {
    const issuedAt = new Date().toISOString()
    const payload = { schemaVersion: 'license.v1', licenseCode, tenantCode: tenant.tenant_code, planCode: 'enterprise-full', appCode: 'console', deploymentId: deployment.id, deploymentCode: deployment.deployment_code, issuedAt, expiresAt: qualification.end.kind === 'finite' ? qualification.end.effectiveUntil : null, graceUntil: null, enterpriseRevision: qualification.revision, vault: { masterKeyRequired: true, masterKeyFingerprint: fingerprintConsoleVaultMasterKey(masterKey), algorithm: 'aes-256-gcm' }, capabilities: [] }
    const serialized = JSON.stringify(payload)
    const signed = await sign(serialized)
    const token = JSON.stringify({ schemaVersion: 'license-token.v1', payload, signature: signed.signature, kid: signed.kid, alg: signed.alg, signedAt: issuedAt })
    const inserted = await tx.execute<ResultSetHeader>('INSERT INTO licenses (license_code,subscription_id,tenant_code,plan_code,status,issued_at,expires_at,grace_until,payload_hash,signed_token,created_at,updated_at) VALUES (?,?,?,\'enterprise-full\',\'active\',?,?,NULL,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())', [licenseCode, deployment.subscription_id, tenant.tenant_code, issuedAt.replace('T', ' ').replace('Z', ''), until, `sha256_${createHash('sha256').update(serialized).digest('hex')}`, token])
    await tx.execute<ResultSetHeader>('INSERT INTO license_deployments (license_id,deployment_id,effective_from,effective_until,status,created_at) VALUES (?,?,?,?, \'active\',UTC_TIMESTAMP())', [inserted.insertId, deployment.id, from, until])
    license = await tx.queryRow<LicenseRow>('SELECT * FROM licenses WHERE id = ?', [inserted.insertId])
  }
  if (!license) throw new Error('enterprise_provisioning_license_missing')
  await tx.execute<ResultSetHeader>('UPDATE deployments SET license_status = \'active\', updated_at = UTC_TIMESTAMP() WHERE id = ? AND license_status IN (\'pending\',\'expired\')', [deployment.id])
  deployment.license_status = 'active'
  const plan = { id: 0, plan_code: 'enterprise-full', plan_name: '汇智云企业全量功能', plan_tier: 'unified', status: 'active' } as PlanRow
  return { tenant, plan, tenantSubscriptionId: parentId, subscriptions, site, deployment, license, technicalDeployments: deployments }
}

import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { queryRow, queryRows, withTransaction } from '~~/server/utils/db'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { buildLicensePayload, buildSignedLicenseToken, hashLicensePayload, normalizeLicenseCapabilities } from '~~/server/utils/licenseArtifacts'
import { CONSOLE_APP_CODE } from '~~/server/utils/consoleApp'
import { ensureConsoleVaultMasterKey, fingerprintConsoleVaultMasterKey } from '~~/server/utils/deploymentBootstrapSecrets'

interface LicenseRow extends RowDataPacket {
  id: number
  tenant_code: string
  deployment_id: number | null
  app_code: string | null
  deployment_code: string | null
  license_code: string
  plan_code: string
  status: string
  issued_at: string
  expires_at: string | null
  grace_until: string | null
  payload_hash: string
  created_at: string
  updated_at: string
}

interface CapabilityRow extends RowDataPacket {
  capability_code: string
  capability_value: string | null
}

const ALLOWED_LICENSE_STATUSES = new Set(['active', 'grace', 'expired', 'suspended', 'disabled'])

function requireAllowed(value: string, field: string, allowed: Set<string>) {
  if (!allowed.has(value)) throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `${field} must be one of: ${Array.from(allowed).join(', ')}` })
  return value
}

async function loadLicense(id: number) {
  const license = await queryRow<LicenseRow>(
    `SELECT l.id, l.tenant_code, ld.deployment_id, d.app_code, d.deployment_code,
            l.license_code, l.plan_code, l.status,
            l.issued_at, l.expires_at, l.grace_until, l.payload_hash, l.created_at, l.updated_at
     FROM licenses l
     LEFT JOIN license_deployments ld
       ON ld.id = (
         SELECT ld2.id
         FROM license_deployments ld2
         WHERE ld2.license_id = l.id
         ORDER BY CASE WHEN ld2.status = 'active' THEN 0 ELSE 1 END, ld2.effective_from DESC, ld2.id DESC
         LIMIT 1
       )
     LEFT JOIN deployments d ON d.id = ld.deployment_id
     WHERE l.id = ?`,
    [id]
  )

  if (!license) return null

  const capabilities = await queryRows<CapabilityRow[]>(
    `SELECT capability_code, capability_value
     FROM license_capabilities
     WHERE license_id = ?
     ORDER BY capability_code ASC`,
    [id]
  )

  return {
    ...license,
    capabilities
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const deploymentId = Number(body.deploymentId)
  const licenseCode = requireString(body.licenseCode, 'licenseCode')
  const planCode = requireString(body.planCode, 'planCode')
  const status = requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ALLOWED_LICENSE_STATUSES)
  const issuedAt = requireString(body.issuedAt, 'issuedAt')
  const expiresAt = normalizeNullableString(body.expiresAt)
  const graceUntil = normalizeNullableString(body.graceUntil)
  const capabilityPayload = normalizeLicenseCapabilities(Array.isArray(body.capabilities) ? body.capabilities : [])

  if (Number.isNaN(deploymentId) || deploymentId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'deploymentId is invalid' })
  }

  const deployment = await queryRow<RowDataPacket & { app_code: string, deployment_code: string, subscription_id: number }>(
    `SELECT id, app_code, deployment_code, subscription_id
     FROM deployments
     WHERE id = ?
       AND tenant_code = ?
     LIMIT 1`,
    [deploymentId, tenantCode]
  )

  if (!deployment) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `deployment not found: deploymentId=${deploymentId}` })
  }

  const appCode = String(deployment.app_code)
  const consoleVaultMasterKey = appCode === CONSOLE_APP_CODE
    ? await ensureConsoleVaultMasterKey({
        deploymentId,
        tenantCode,
        appCode
      })
    : null

  const licensePayload = buildLicensePayload({
    tenantCode,
    appCode,
    deploymentId,
    deploymentCode: String(deployment.deployment_code),
    licenseCode,
    planCode,
    issuedAt,
    expiresAt,
    graceUntil,
    capabilities: capabilityPayload,
    vault: consoleVaultMasterKey
      ? {
          masterKeyRequired: true,
          masterKeyFingerprint: fingerprintConsoleVaultMasterKey(consoleVaultMasterKey),
          algorithm: 'aes-256-gcm'
        }
      : null
  })
  const payloadHash = hashLicensePayload(licensePayload)
  const signed = await buildSignedLicenseToken(licensePayload)

  const result = await withTransaction(async (tx) => {
    const existing = await tx.queryRow<RowDataPacket>(
      `SELECT id
       FROM licenses
       WHERE tenant_code = ?
         AND license_code = ?
       LIMIT 1`,
      [tenantCode, licenseCode]
    )

    let licenseId: number

    if (existing) {
      await tx.execute<ResultSetHeader>(
        `UPDATE licenses
         SET subscription_id = ?, plan_code = ?, status = ?, issued_at = ?, expires_at = ?, grace_until = ?,
             payload_hash = ?, signed_token = ?, updated_at = NOW()
         WHERE id = ?`,
        [deployment.subscription_id, planCode, status, issuedAt, expiresAt, graceUntil, payloadHash, signed.token, existing.id]
      )
      licenseId = Number(existing.id)
    } else {
      const insertResult = await tx.execute<ResultSetHeader>(
        `INSERT INTO licenses
          (license_code, subscription_id, tenant_code, plan_code, status, issued_at, expires_at, grace_until, payload_hash, signed_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [licenseCode, deployment.subscription_id, tenantCode, planCode, status, issuedAt, expiresAt, graceUntil, payloadHash, signed.token]
      )
      licenseId = insertResult.insertId
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE license_deployments
       SET status = 'inactive', effective_until = COALESCE(effective_until, NOW())
       WHERE license_id = ?
         AND deployment_id <> ?
         AND status = 'active'`,
      [licenseId, deploymentId]
    )

    const mapping = await tx.queryRow<RowDataPacket>(
      `SELECT id
       FROM license_deployments
       WHERE license_id = ?
         AND deployment_id = ?
       LIMIT 1`,
      [licenseId, deploymentId]
    )

    if (mapping) {
      await tx.execute<ResultSetHeader>(
        `UPDATE license_deployments
         SET status = 'active', effective_from = COALESCE(effective_from, NOW()), effective_until = NULL
         WHERE id = ?`,
        [mapping.id]
      )
    } else {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO license_deployments
          (license_id, deployment_id, effective_from, status, created_at)
         VALUES (?, ?, NOW(), 'active', NOW())`,
        [licenseId, deploymentId]
      )
    }

    await tx.execute<ResultSetHeader>('DELETE FROM license_capabilities WHERE license_id = ?', [licenseId])

    for (const capability of capabilityPayload) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO license_capabilities
          (license_id, capability_code, capability_value, created_at)
         VALUES (?, ?, ?, NOW())`,
        [licenseId, capability.capabilityCode, capability.capabilityValue]
      )
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE deployments
       SET license_status = ?, updated_at = NOW()
       WHERE id = ?`,
      [status, deploymentId]
    )

    return licenseId
  })

  const license = await loadLicense(result)
  if (!license) throw createError({ statusCode: 500, statusMessage: 'Internal Server Error', message: 'failed to load saved license' })

  return ok({
    id: license.id,
    tenantCode: license.tenant_code,
    deploymentId: license.deployment_id,
    appCode: license.app_code,
    deploymentCode: license.deployment_code,
    licenseCode: license.license_code,
    planCode: license.plan_code,
    status: license.status,
    issuedAt: license.issued_at,
    expiresAt: license.expires_at,
    graceUntil: license.grace_until,
    payloadHash: license.payload_hash,
    capabilities: license.capabilities.map(item => ({
      capabilityCode: item.capability_code,
      capabilityValue: item.capability_value
    })),
    createdAt: license.created_at,
    updatedAt: license.updated_at
  })
})

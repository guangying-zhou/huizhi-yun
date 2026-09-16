import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface LicenseRow extends RowDataPacket {
  id: number
  tenant_code: string
  deployment_id: number | null
  app_code: string | null
  deployment_code: string | null
  license_deployment_status: string | null
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

  const license = await queryRow<LicenseRow>(
    `SELECT l.id, l.tenant_code, ld.deployment_id, d.app_code, d.deployment_code, ld.status AS license_deployment_status,
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

  if (!license) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `license not found: id=${id}` })
  }

  const capabilities = await queryRows<CapabilityRow[]>(
    `SELECT capability_code, capability_value
     FROM license_capabilities
     WHERE license_id = ?
     ORDER BY capability_code ASC`,
    [id]
  )

  return ok({
    id: license.id,
    tenantCode: license.tenant_code,
    deploymentId: license.deployment_id,
    appCode: license.app_code,
    deploymentCode: license.deployment_code,
    deploymentBindingStatus: license.license_deployment_status,
    licenseCode: license.license_code,
    planCode: license.plan_code,
    status: license.status,
    issuedAt: license.issued_at,
    expiresAt: license.expires_at,
    graceUntil: license.grace_until,
    payloadHash: license.payload_hash,
    capabilities: capabilities.map(item => ({
      capabilityCode: item.capability_code,
      capabilityValue: item.capability_value
    })),
    createdAt: license.created_at,
    updatedAt: license.updated_at
  })
})

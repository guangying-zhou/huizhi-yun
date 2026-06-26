import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'
import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

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

interface CountRow extends RowDataPacket {
  total: number
}

function joinsSql() {
  return `FROM licenses l
      LEFT JOIN license_deployments ld
        ON ld.id = (
          SELECT ld2.id
          FROM license_deployments ld2
          WHERE ld2.license_id = l.id
          ORDER BY CASE WHEN ld2.status = 'active' THEN 0 ELSE 1 END, ld2.effective_from DESC, ld2.id DESC
          LIMIT 1
        )
      LEFT JOIN deployments d ON d.id = ld.deployment_id`
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const status = normalizeNullableString(query.status)
  const deploymentCode = normalizeNullableString(query.deploymentCode)
  const environment = normalizeNullableString(query.environment)
  const { page, pageSize, offset } = parsePagination(query)

  const where = ['l.tenant_code = ?']
  const params: Array<string | number> = [tenantCode]

  if (status) {
    where.push('l.status = ?')
    params.push(status)
  }
  if (deploymentCode) {
    where.push('d.deployment_code = ?')
    params.push(deploymentCode)
  }
  if (environment) {
    where.push('d.environment = ?')
    params.push(normalizeDeploymentEnvironment(environment))
  }

  const whereSql = `WHERE ${where.join(' AND ')}`
  const joins = joinsSql()

  const items = await queryRows<LicenseRow[]>(
    `SELECT l.id, l.tenant_code, ld.deployment_id, d.app_code, d.deployment_code, ld.status AS license_deployment_status,
            l.license_code, l.plan_code, l.status,
            l.issued_at, l.expires_at, l.grace_until, l.payload_hash, l.created_at, l.updated_at
     ${joins}
     ${whereSql}
     ORDER BY l.issued_at DESC, l.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     ${joins}
     ${whereSql}`,
    params
  )

  return ok({
    items: items.map(item => ({
      id: item.id,
      tenantCode: item.tenant_code,
      deploymentId: item.deployment_id,
      appCode: item.app_code,
      deploymentCode: item.deployment_code,
      deploymentBindingStatus: item.license_deployment_status,
      licenseCode: item.license_code,
      planCode: item.plan_code,
      status: item.status,
      issuedAt: item.issued_at,
      expiresAt: item.expires_at,
      graceUntil: item.grace_until,
      payloadHash: item.payload_hash,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})

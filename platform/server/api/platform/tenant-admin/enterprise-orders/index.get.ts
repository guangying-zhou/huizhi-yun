import { defineEventHandler } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { queryRow, queryRows } from '~~/server/utils/db'
import { requireEnterpriseOrderTenant } from '~~/server/utils/enterpriseOrderTenantAccess'
import { loadBundleEnterpriseEntitlement } from '~~/server/utils/enterpriseEntitlementBundle'

export default defineEventHandler(async (event) => {
  const { tenantCode } = requireEnterpriseOrderTenant(event)
  const tenant = await queryRow<RowDataPacket & { status: string }>('SELECT status FROM tenants WHERE tenant_code=?', [tenantCode])
  const entitlement = await loadBundleEnterpriseEntitlement(queryRow, tenantCode, tenant?.status || 'suspended', new Date().toISOString())
  const orders = await queryRows<RowDataPacket[]>(`SELECT o.order_no AS orderNo,o.status,JSON_UNQUOTE(JSON_EXTRACT(a.approved_json,'$.amount')) AS amount,JSON_UNQUOTE(JSON_EXTRACT(a.approved_json,'$.currency')) AS currency,JSON_UNQUOTE(JSON_EXTRACT(a.approved_json,'$.effectiveFrom')) AS effectiveFrom,JSON_UNQUOTE(JSON_EXTRACT(a.approved_json,'$.effectiveUntil')) AS effectiveUntil,a.approval_reference AS approvalReference,a.approved_at AS approvedAt,c.accepted_at AS acceptedAt
    FROM enterprise_order_approvals a INNER JOIN platform_orders o ON o.id=a.order_id AND o.tenant_code=a.tenant_code
    LEFT JOIN enterprise_order_acceptances c ON c.order_id=o.id AND c.tenant_code=o.tenant_code
    WHERE a.tenant_code=? ORDER BY o.id DESC LIMIT 50`, [tenantCode])
  const legacySubscription = !entitlement ? await queryRow<RowDataPacket>('SELECT status, started_at AS effectiveFrom, ended_at AS effectiveUntil FROM tenant_subscriptions WHERE tenant_code=? ORDER BY id DESC LIMIT 1', [tenantCode]) : null
  return { success: true, data: { entitlement, legacySubscription, orders } }
})

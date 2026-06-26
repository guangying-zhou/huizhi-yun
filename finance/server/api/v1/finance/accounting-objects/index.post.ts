import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { FINANCE_ACCOUNTING_OBJECT_TYPES, assertAllowed, cleanString, requiredString, type SqlParam } from '../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = requiredString(body.code, 'code')
  const objectType = assertAllowed(
    requiredString(body.objectType ?? body.object_type, 'objectType'),
    'objectType',
    [...FINANCE_ACCOUNTING_OBJECT_TYPES]
  )

  await execute(`
    INSERT INTO finance_accounting_object (
      code,
      name,
      object_type,
      source_app,
      source_code,
      legacy_source,
      legacy_id,
      customer_code,
      contract_code,
      project_code,
      department_code,
      sales_region_code,
      owner_uid,
      status,
      remark
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    code,
    requiredString(body.name, 'name'),
    objectType,
    cleanString(body.sourceApp ?? body.source_app),
    cleanString(body.sourceCode ?? body.source_code),
    cleanString(body.legacySource ?? body.legacy_source),
    cleanString(body.legacyId ?? body.legacy_id),
    cleanString(body.customerCode ?? body.customer_code),
    cleanString(body.contractCode ?? body.contract_code),
    cleanString(body.projectCode ?? body.project_code),
    cleanString(body.departmentCode ?? body.department_code),
    cleanString(body.salesRegionCode ?? body.sales_region_code),
    cleanString(body.ownerUid ?? body.owner_uid),
    assertAllowed(cleanString(body.status) || 'active', 'status', ['active', 'inactive']),
    cleanString(body.remark)
  ] satisfies SqlParam[])

  const data = await queryRow<RowDataPacket>('SELECT * FROM finance_accounting_object WHERE code = ?', [code])
  return { data }
})

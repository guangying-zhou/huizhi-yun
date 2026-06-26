import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { execute, queryRow } from '../../../../../utils/db'
import { FINANCE_ACCOUNTING_OBJECT_TYPES, assertAllowed, cleanString, type SqlParam } from '../../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const body = await readBody<Record<string, unknown>>(event)
  const objectType = assertAllowed(cleanString(body.objectType ?? body.object_type), 'objectType', [...FINANCE_ACCOUNTING_OBJECT_TYPES])

  await execute(`
    UPDATE finance_accounting_object
    SET
      name = COALESCE(?, name),
      object_type = COALESCE(?, object_type),
      source_app = COALESCE(?, source_app),
      source_code = COALESCE(?, source_code),
      customer_code = COALESCE(?, customer_code),
      contract_code = COALESCE(?, contract_code),
      project_code = COALESCE(?, project_code),
      department_code = COALESCE(?, department_code),
      sales_region_code = COALESCE(?, sales_region_code),
      owner_uid = COALESCE(?, owner_uid),
      status = COALESCE(?, status),
      remark = COALESCE(?, remark),
      updated_at = CURRENT_TIMESTAMP
    WHERE code = ?
  `, [
    cleanString(body.name),
    objectType,
    cleanString(body.sourceApp ?? body.source_app),
    cleanString(body.sourceCode ?? body.source_code),
    cleanString(body.customerCode ?? body.customer_code),
    cleanString(body.contractCode ?? body.contract_code),
    cleanString(body.projectCode ?? body.project_code),
    cleanString(body.departmentCode ?? body.department_code),
    cleanString(body.salesRegionCode ?? body.sales_region_code),
    cleanString(body.ownerUid ?? body.owner_uid),
    assertAllowed(cleanString(body.status), 'status', ['active', 'inactive']),
    cleanString(body.remark),
    code
  ] satisfies SqlParam[])

  const data = await queryRow<RowDataPacket>('SELECT * FROM finance_accounting_object WHERE code = ?', [code])
  if (!data) throw createError({ statusCode: 404, statusMessage: 'accounting object not found' })
  return { data }
})

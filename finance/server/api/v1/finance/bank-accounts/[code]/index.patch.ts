import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { execute, queryRow } from '../../../../../utils/db'
import { assertAllowed, cleanString, optionalDate, type SqlParam } from '../../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const body = await readBody<Record<string, unknown>>(event)
  const status = assertAllowed(cleanString(body.status), 'status', ['active', 'inactive', 'closed'])

  await execute(`
    UPDATE finance_bank_account
    SET
      account_name = COALESCE(?, account_name),
      bank_name = COALESCE(?, bank_name),
      account_no_masked = COALESCE(?, account_no_masked),
      account_no_secret_ref = COALESCE(?, account_no_secret_ref),
      account_type = COALESCE(?, account_type),
      currency_code = COALESCE(?, currency_code),
      owner_dept_code = COALESCE(?, owner_dept_code),
      status = COALESCE(?, status),
      opened_at = COALESCE(?, opened_at),
      closed_at = COALESCE(?, closed_at),
      remark = COALESCE(?, remark),
      updated_by = COALESCE(?, updated_by),
      updated_at = CURRENT_TIMESTAMP
    WHERE code = ? AND deleted_at IS NULL
  `, [
    cleanString(body.accountName ?? body.account_name),
    cleanString(body.bankName ?? body.bank_name),
    cleanString(body.accountNoMasked ?? body.account_no_masked),
    cleanString(body.accountNoSecretRef ?? body.account_no_secret_ref),
    cleanString(body.accountType ?? body.account_type),
    cleanString(body.currencyCode ?? body.currency_code),
    cleanString(body.ownerDeptCode ?? body.owner_dept_code),
    status,
    optionalDate(body.openedAt ?? body.opened_at),
    optionalDate(body.closedAt ?? body.closed_at),
    cleanString(body.remark),
    cleanString(body.updatedBy ?? body.updated_by),
    code
  ] satisfies SqlParam[])

  const row = await queryRow<RowDataPacket>('SELECT * FROM finance_bank_account WHERE code = ? AND deleted_at IS NULL', [code])
  if (!row) throw createError({ statusCode: 404, statusMessage: 'bank account not found' })
  return { data: row }
})

import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { assertAllowed, cleanString, generateFinanceCode, optionalDate, requiredString, type SqlParam } from '../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = cleanString(body.code) || generateFinanceCode('BA')
  const status = assertAllowed(cleanString(body.status) || 'active', 'status', ['active', 'inactive', 'closed'])

  await execute(`
    INSERT INTO finance_bank_account (
      code,
      account_name,
      bank_name,
      account_no_masked,
      account_no_secret_ref,
      account_type,
      currency_code,
      owner_dept_code,
      status,
      opened_at,
      closed_at,
      remark,
      created_by,
      updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    code,
    requiredString(body.accountName ?? body.account_name, 'accountName'),
    cleanString(body.bankName ?? body.bank_name),
    cleanString(body.accountNoMasked ?? body.account_no_masked),
    cleanString(body.accountNoSecretRef ?? body.account_no_secret_ref),
    cleanString(body.accountType ?? body.account_type) || 'bank',
    cleanString(body.currencyCode ?? body.currency_code) || 'CNY',
    cleanString(body.ownerDeptCode ?? body.owner_dept_code),
    status,
    optionalDate(body.openedAt ?? body.opened_at),
    optionalDate(body.closedAt ?? body.closed_at),
    cleanString(body.remark),
    cleanString(body.createdBy ?? body.created_by),
    cleanString(body.updatedBy ?? body.updated_by)
  ] satisfies SqlParam[])

  const row = await queryRow<RowDataPacket>('SELECT * FROM finance_bank_account WHERE code = ?', [code])
  return { data: row }
})

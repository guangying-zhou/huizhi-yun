import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, readBody } from 'h3'
import { queryRow, useDbPool } from '../../../../utils/db'
import { assertAllowed, cleanString, generateFinanceCode, moneyString, numberOrNull, optionalDate, type SqlParam } from '../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = cleanString(body.code) || generateFinanceCode('CLM')
  const status = assertAllowed(cleanString(body.status) || 'draft', 'status', ['draft', 'pending_approval', 'approved', 'rejected', 'paid', 'canceled'])
  const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : []

  const pool = useDbPool()
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.execute<ResultSetHeader>(`
      INSERT INTO expense_claim (
        code,
        title,
        applicant_user_id,
        applicant_dept_code,
        project_code,
        contract_code,
        customer_code,
        total_amount,
        currency_code,
        cost_bearer_type,
        cost_bearer_code,
        status,
        remark,
        created_by,
        updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      code,
      cleanString(body.title) || '费用报销',
      cleanString(body.applicantUserId ?? body.applicant_user_id) || cleanString(body.createdBy ?? body.created_by) || 'unknown',
      cleanString(body.applicantDeptCode ?? body.applicant_dept_code),
      cleanString(body.projectCode ?? body.project_code),
      cleanString(body.contractCode ?? body.contract_code),
      cleanString(body.customerCode ?? body.customer_code),
      moneyString(body.totalAmount ?? body.total_amount, 'totalAmount', { required: true, positive: true }),
      cleanString(body.currencyCode ?? body.currency_code) || 'CNY',
      cleanString(body.costBearerType ?? body.cost_bearer_type),
      cleanString(body.costBearerCode ?? body.cost_bearer_code),
      status,
      cleanString(body.remark),
      cleanString(body.createdBy ?? body.created_by),
      cleanString(body.updatedBy ?? body.updated_by)
    ] satisfies SqlParam[])

    for (const [index, item] of items.entries()) {
      await connection.execute(`
        INSERT INTO expense_claim_item (
          claim_id,
          expense_type_id,
          subject_id,
          occurred_at,
          amount,
          tax_amount,
          invoice_no,
          description,
          sort_no
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        result.insertId,
        numberOrNull(item.expenseTypeId ?? item.expense_type_id, 'expenseTypeId'),
        numberOrNull(item.subjectId ?? item.subject_id, 'subjectId'),
        optionalDate(item.occurredAt ?? item.occurred_at),
        moneyString(item.amount, 'item.amount', { required: true, positive: true }),
        moneyString(item.taxAmount ?? item.tax_amount, 'item.taxAmount'),
        cleanString(item.invoiceNo ?? item.invoice_no),
        cleanString(item.description),
        index
      ] satisfies SqlParam[])
    }

    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  const row = await queryRow<RowDataPacket>('SELECT * FROM expense_claim WHERE code = ?', [code])
  return { data: row }
})

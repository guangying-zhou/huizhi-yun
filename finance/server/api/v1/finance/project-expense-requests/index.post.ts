import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, readBody } from 'h3'
import { queryRow, useDbPool } from '../../../../utils/db'
import { assertAllowed, cleanString, generateFinanceCode, moneyString, numberOrNull, type SqlParam } from '../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const code = cleanString(body.code) || generateFinanceCode('PER')
  const status = assertAllowed(cleanString(body.status) || 'draft', 'status', ['draft', 'pending_approval', 'approved', 'rejected', 'paid', 'canceled'])
  const items = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : []

  const connection = await useDbPool().getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.execute<ResultSetHeader>(`
      INSERT INTO project_expense_request (
        code,
        title,
        applicant_user_id,
        applicant_dept_code,
        project_code,
        contract_code,
        customer_code,
        supplier_code,
        total_amount,
        status,
        remark,
        created_by,
        updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      code,
      cleanString(body.title) || '项目支出申请',
      cleanString(body.applicantUserId ?? body.applicant_user_id) || cleanString(body.createdBy ?? body.created_by) || 'unknown',
      cleanString(body.applicantDeptCode ?? body.applicant_dept_code),
      cleanString(body.projectCode ?? body.project_code) || 'UNKNOWN',
      cleanString(body.contractCode ?? body.contract_code),
      cleanString(body.customerCode ?? body.customer_code),
      cleanString(body.supplierCode ?? body.supplier_code),
      moneyString(body.totalAmount ?? body.total_amount, 'totalAmount', { required: true, positive: true }),
      status,
      cleanString(body.remark),
      cleanString(body.createdBy ?? body.created_by),
      cleanString(body.updatedBy ?? body.updated_by)
    ] satisfies SqlParam[])

    for (const [index, item] of items.entries()) {
      await connection.execute(`
        INSERT INTO project_expense_request_item (
          request_id,
          expense_type_id,
          subject_id,
          item_name,
          amount,
          quantity,
          unit_price,
          description,
          sort_no
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        result.insertId,
        numberOrNull(item.expenseTypeId ?? item.expense_type_id, 'expenseTypeId'),
        numberOrNull(item.subjectId ?? item.subject_id, 'subjectId'),
        cleanString(item.itemName ?? item.item_name) || cleanString(body.title) || '项目支出',
        moneyString(item.amount, 'item.amount', { required: true, positive: true }),
        numberOrNull(item.quantity, 'item.quantity'),
        moneyString(item.unitPrice ?? item.unit_price, 'item.unitPrice'),
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

  const row = await queryRow<RowDataPacket>('SELECT * FROM project_expense_request WHERE code = ?', [code])
  return { data: row }
})

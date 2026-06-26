import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { queryRow, useDbPool } from '../../../../../utils/db'
import { recalculateContractSummary } from '../../../../../utils/financeSummary'
import { assertAllowed, cleanString, generateFinanceCode, jsonOrNull, numberOrNull, type SqlParam } from '../../../../../utils/financeWrite'

type ReceiptRow = RowDataPacket & {
  id: number
  code: string
  customer_code: string | null
  customer_name: string | null
  contract_code: string | null
  project_code: string | null
  bank_account_id: number | null
  income_type_id: number | null
  received_at: string
  received_amount: string
  channel: string | null
  payer_name: string | null
  handler_user_id: string | null
}

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const body = await readBody<Record<string, unknown>>(event)
  const resolutionStatus = assertAllowed(
    cleanString(body.resolutionStatus ?? body.resolution_status) || 'classified',
    'resolutionStatus',
    ['pending', 'linked_to_contract', 'classified', 'ignored']
  )

  const connection = await useDbPool().getConnection()
  try {
    await connection.beginTransaction()

    const [rows] = await connection.query<ReceiptRow[]>(
      'SELECT * FROM finance_receipt WHERE code = ? AND deleted_at IS NULL FOR UPDATE',
      [code]
    )
    const receipt = rows[0]
    if (!receipt) throw createError({ statusCode: 404, statusMessage: 'receipt not found' })

    const contractCode = cleanString(body.contractCode ?? body.contract_code)
    const projectCode = cleanString(body.projectCode ?? body.project_code)
    const incomeTypeId = numberOrNull(body.incomeTypeId ?? body.income_type_id, 'incomeTypeId')
    const subjectId = numberOrNull(body.subjectId ?? body.subject_id, 'subjectId')

    await connection.execute(`
      UPDATE finance_receipt
      SET
        contract_code = COALESCE(?, contract_code),
        project_code = COALESCE(?, project_code),
        receivable_plan_code = COALESCE(?, receivable_plan_code),
        income_type_id = COALESCE(?, income_type_id),
        source_refs_json = COALESCE(?, source_refs_json),
        note = COALESCE(?, note),
        updated_by = COALESCE(?, updated_by),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      contractCode,
      projectCode,
      cleanString(body.receivablePlanCode ?? body.receivable_plan_code),
      incomeTypeId,
      jsonOrNull(body.sourceRefs ?? body.source_refs_json),
      cleanString(body.note),
      cleanString(body.updatedBy ?? body.updated_by),
      receipt.id
    ] satisfies SqlParam[])

    if (resolutionStatus !== 'linked_to_contract') {
      const [existingRows] = await connection.query<(RowDataPacket & { id: number })[]>(
        'SELECT id FROM finance_unclassified_income WHERE linked_receipt_id = ? LIMIT 1',
        [receipt.id]
      )
      const existing = existingRows[0]

      if (existing) {
        await connection.execute(`
          UPDATE finance_unclassified_income
          SET
            project_code = COALESCE(?, project_code),
            income_type_id = COALESCE(?, income_type_id),
            resolution_status = ?,
            classified_subject_id = COALESCE(?, classified_subject_id),
            source_refs_json = COALESCE(?, source_refs_json),
            updated_by = COALESCE(?, updated_by),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          projectCode || receipt.project_code,
          incomeTypeId || receipt.income_type_id,
          resolutionStatus,
          subjectId,
          jsonOrNull(body.sourceRefs ?? body.source_refs_json),
          cleanString(body.updatedBy ?? body.updated_by),
          existing.id
        ] satisfies SqlParam[])
      } else {
        await connection.execute(`
          INSERT INTO finance_unclassified_income (
            code,
            project_code,
            bank_account_id,
            income_type_id,
            received_at,
            amount,
            channel,
            payer_name,
            handler_user_id,
            description,
            resolution_status,
            linked_receipt_id,
            classified_subject_id,
            source_refs_json,
            created_by,
            updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          generateFinanceCode('UCI'),
          projectCode || receipt.project_code,
          receipt.bank_account_id,
          incomeTypeId || receipt.income_type_id,
          receipt.received_at,
          receipt.received_amount,
          receipt.channel,
          receipt.payer_name,
          receipt.handler_user_id,
          cleanString(body.description) || receipt.customer_name || receipt.payer_name,
          resolutionStatus,
          receipt.id,
          subjectId,
          jsonOrNull(body.sourceRefs ?? body.source_refs_json),
          cleanString(body.createdBy ?? body.created_by),
          cleanString(body.updatedBy ?? body.updated_by)
        ] satisfies SqlParam[])
      }
    }

    await recalculateContractSummary(receipt.contract_code, connection)
    await recalculateContractSummary(contractCode, connection)
    await connection.commit()

    const data = await queryRow<RowDataPacket>('SELECT * FROM finance_receipt WHERE code = ? AND deleted_at IS NULL', [code])
    return { data }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
})

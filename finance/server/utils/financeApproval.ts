import type { PoolConnection, RowDataPacket } from '~~/server/utils/db'
import type { H3Event } from 'h3'
import { createError } from 'h3'
import { execute, queryRow, useDbPool } from './db'
import { recalculateContractSummary } from './financeSummary'
import { createLocalWorkflowFallback, createWorkflowApprovalInstance, type WorkflowSubmissionResult } from './financeWorkflow'
import { cleanString, generateFinanceCode, moneyString, optionalDate, type SqlParam } from './financeWrite'

export type ApprovalBizType = 'invoice_request' | 'expense_claim' | 'project_expense_request' | 'payment_request'

export interface ApprovalTargetConfig {
  bizType: ApprovalBizType
  table: string
  codePrefix: string
  notFoundMessage: string
}

export const approvalTargets: Record<ApprovalBizType, ApprovalTargetConfig> = {
  invoice_request: {
    bizType: 'invoice_request',
    table: 'invoice_request',
    codePrefix: 'IR',
    notFoundMessage: 'invoice request not found'
  },
  expense_claim: {
    bizType: 'expense_claim',
    table: 'expense_claim',
    codePrefix: 'CLM',
    notFoundMessage: 'expense claim not found'
  },
  project_expense_request: {
    bizType: 'project_expense_request',
    table: 'project_expense_request',
    codePrefix: 'PER',
    notFoundMessage: 'project expense request not found'
  },
  payment_request: {
    bizType: 'payment_request',
    table: 'payment_request',
    codePrefix: 'PAY',
    notFoundMessage: 'payment request not found'
  }
}

export type ApprovalRow = RowDataPacket & {
  id: number
  code: string
  status: string
  workflow_instance_id: string | null
  generated_expense_id?: number | null
  issued_invoice_id?: number | null
}

export function resolveApprovalTarget(bizType: string): ApprovalTargetConfig {
  const target = approvalTargets[bizType as ApprovalBizType]
  if (!target) {
    throw createError({ statusCode: 400, statusMessage: 'unsupported bizType' })
  }
  return target
}

export async function getApprovalRow(target: ApprovalTargetConfig, code: string): Promise<ApprovalRow> {
  const row = await queryRow<ApprovalRow>(
    `SELECT * FROM ${target.table} WHERE code = ? AND deleted_at IS NULL`,
    [code]
  )
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: target.notFoundMessage })
  }
  return row
}

export async function submitApproval(
  target: ApprovalTargetConfig,
  code: string,
  body: Record<string, unknown>,
  event?: H3Event
) {
  const row = await getApprovalRow(target, code)
  if (!['draft', 'rejected'].includes(row.status)) {
    throw createError({ statusCode: 409, statusMessage: 'only draft or rejected documents can be submitted' })
  }

  const submission = await resolveWorkflowSubmission(event, target, row, body)
  const submittedBy = cleanString(body.submittedBy ?? body.submitted_by)

  await execute(`
    UPDATE ${target.table}
    SET status = 'pending_approval',
        workflow_instance_id = ?,
        submitted_at = NOW(),
        updated_by = COALESCE(?, updated_by),
        updated_at = CURRENT_TIMESTAMP
    WHERE code = ? AND deleted_at IS NULL
  `, [submission.workflowInstanceId, submittedBy, code])

  await execute(`
    INSERT INTO external_approval_instance (
      biz_type,
      biz_code,
      workflow_instance_id,
      external_platform,
      external_instance_id,
      status,
      submitted_by,
      submitted_at,
      last_synced_at,
      error_message
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, NOW(), NOW(), ?)
    ON DUPLICATE KEY UPDATE
      workflow_instance_id = VALUES(workflow_instance_id),
      external_platform = VALUES(external_platform),
      external_instance_id = VALUES(external_instance_id),
      status = 'pending',
      submitted_by = VALUES(submitted_by),
      submitted_at = NOW(),
      last_synced_at = NOW(),
      error_message = VALUES(error_message)
  `, [
    target.bizType,
    code,
    submission.workflowInstanceId,
    submission.platform,
    submission.externalInstanceId,
    submittedBy,
    submission.errorMessage
  ])

  if (submission.status === 'approved') {
    return applyApprovalResult(target, code, 'approved', {
      workflowInstanceId: submission.workflowInstanceId,
      operator: submittedBy
    })
  }

  return getApprovalRow(target, code)
}

async function resolveWorkflowSubmission(
  event: H3Event | undefined,
  target: ApprovalTargetConfig,
  row: ApprovalRow,
  body: Record<string, unknown>
): Promise<WorkflowSubmissionResult> {
  const manualWorkflowInstanceId = cleanString(body.workflowInstanceId ?? body.workflow_instance_id)
  if (manualWorkflowInstanceId) {
    return {
      workflowInstanceId: manualWorkflowInstanceId,
      externalInstanceId: cleanString(body.externalInstanceId ?? body.external_instance_id),
      platform: 'workflow',
      status: 'running',
      errorMessage: null
    }
  }

  if (event && body.skipWorkflow !== true) {
    try {
      return await createWorkflowApprovalInstance(event, target, row, body)
    } catch (error) {
      console.warn('[Finance] Workflow submit failed, fallback to local pending:', error)
      return createLocalWorkflowFallback(target, row.code, error)
    }
  }

  return createLocalWorkflowFallback(target, row.code, 'Workflow event context unavailable')
}

export async function applyApprovalResult(
  target: ApprovalTargetConfig,
  code: string,
  result: 'approved' | 'rejected' | 'canceled',
  options: {
    workflowInstanceId?: string | null
    approvedAmount?: string | null
    rejectReason?: string | null
    operator?: string | null
  } = {}
) {
  const pool = useDbPool()
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const row = await getApprovalRowForUpdate(connection, target, code)

    if (result === 'approved') {
      await markApproved(connection, target, row, options)
    } else if (result === 'rejected') {
      await connection.execute(`
        UPDATE ${target.table}
        SET status = 'rejected',
            workflow_instance_id = COALESCE(?, workflow_instance_id),
            rejected_at = NOW(),
            reject_reason = ?,
            updated_by = COALESCE(?, updated_by),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [options.workflowInstanceId || null, options.rejectReason || null, options.operator || null, row.id])
    } else {
      await connection.execute(`
        UPDATE ${target.table}
        SET status = 'canceled',
            workflow_instance_id = COALESCE(?, workflow_instance_id),
            updated_by = COALESCE(?, updated_by),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [options.workflowInstanceId || null, options.operator || null, row.id])
    }

    await connection.execute(`
      UPDATE external_approval_instance
      SET status = ?,
          workflow_instance_id = COALESCE(?, workflow_instance_id),
          completed_at = CASE WHEN ? IN ('approved', 'rejected', 'canceled') THEN NOW() ELSE completed_at END,
          last_synced_at = NOW()
      WHERE biz_type = ? AND biz_code = ?
    `, [result, options.workflowInstanceId || null, result, target.bizType, code])

    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  return getApprovalRow(target, code)
}

async function getApprovalRowForUpdate(connection: PoolConnection, target: ApprovalTargetConfig, code: string): Promise<ApprovalRow> {
  const [rows] = await connection.query<ApprovalRow[]>(
    `SELECT * FROM ${target.table} WHERE code = ? AND deleted_at IS NULL FOR UPDATE`,
    [code]
  )
  const row = rows[0]
  if (!row) throw createError({ statusCode: 404, statusMessage: target.notFoundMessage })
  return row
}

async function markApproved(
  connection: PoolConnection,
  target: ApprovalTargetConfig,
  row: ApprovalRow,
  options: {
    workflowInstanceId?: string | null
    approvedAmount?: string | null
    operator?: string | null
  }
) {
  if (target.bizType === 'invoice_request') {
    await approveInvoiceRequest(connection, row, options)
    return
  }

  await approveExpenseLikeRequest(connection, target, row, options)
}

async function approveInvoiceRequest(
  connection: PoolConnection,
  row: ApprovalRow,
  options: {
    workflowInstanceId?: string | null
    approvedAmount?: string | null
    operator?: string | null
  }
) {
  if (!row.issued_invoice_id) {
    const invoiceCode = generateFinanceCode('INV')
    const amount = moneyString(options.approvedAmount || row.requested_amount, 'approvedAmount', { required: true, positive: true })
    const [result] = await connection.execute(`
      INSERT INTO finance_invoice (
        code,
        invoice_request_id,
        customer_code,
        customer_name,
        contract_code,
        receivable_plan_code,
        invoice_type,
        invoice_item,
        invoice_amount,
        tax_rate,
        taxpayer_name,
        taxpayer_no,
        status,
        created_by,
        updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?)
    `, [
      invoiceCode,
      row.id,
      row.customer_code || null,
      row.customer_name || null,
      row.contract_code || null,
      row.receivable_plan_code || null,
      row.invoice_type || null,
      row.invoice_item || null,
      amount,
      row.tax_rate || null,
      row.taxpayer_name || null,
      row.taxpayer_no || null,
      options.operator || null,
      options.operator || null
    ] satisfies SqlParam[]) as [{ insertId: number }, unknown]

    await connection.execute(`
      UPDATE invoice_request
      SET issued_invoice_id = ?, status = 'issued'
      WHERE id = ?
    `, [result.insertId, row.id])
  }

  await connection.execute(`
    UPDATE invoice_request
    SET status = CASE WHEN issued_invoice_id IS NULL THEN 'approved' ELSE 'issued' END,
        workflow_instance_id = COALESCE(?, workflow_instance_id),
        approved_at = COALESCE(approved_at, NOW()),
        updated_by = COALESCE(?, updated_by),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [options.workflowInstanceId || null, options.operator || null, row.id])

  await recalculateContractSummary(cleanString(row.contract_code), connection)
}

async function approveExpenseLikeRequest(
  connection: PoolConnection,
  target: ApprovalTargetConfig,
  row: ApprovalRow,
  options: {
    workflowInstanceId?: string | null
    approvedAmount?: string | null
    operator?: string | null
  }
) {
  if (!row.generated_expense_id) {
    const expenseCode = generateFinanceCode('EXP')
    const amount = moneyString(
      options.approvedAmount || row.approved_amount || row.total_amount || row.requested_amount,
      'approvedAmount',
      { required: true, positive: true }
    )
    const [result] = await connection.execute(`
      INSERT INTO finance_expense (
        code,
        expense_date,
        expense_amount,
        currency_code,
        project_code,
        contract_code,
        customer_code,
        department_code,
        handler_user_id,
        payee_name,
        payee_account_masked,
        payee_bank,
        source_request_type,
        source_request_code,
        status,
        description,
        created_by,
        updated_by
      ) VALUES (?, CURRENT_DATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)
    `, [
      expenseCode,
      amount,
      row.currency_code || 'CNY',
      row.project_code || null,
      row.contract_code || null,
      row.customer_code || null,
      row.applicant_dept_code || null,
      row.applicant_user_id || null,
      row.payee_name || null,
      row.payee_account_masked || null,
      row.payee_bank || null,
      target.bizType,
      row.code,
      row.title || row.remark || null,
      options.operator || null,
      options.operator || null
    ] satisfies SqlParam[]) as [{ insertId: number }, unknown]

    await connection.execute(
      `UPDATE ${target.table} SET generated_expense_id = ? WHERE id = ?`,
      [result.insertId, row.id]
    )
  }

  if (target.bizType === 'payment_request') {
    await connection.execute(`
      UPDATE payment_request
      SET status = 'approved',
          approved_amount = COALESCE(?, approved_amount, requested_amount),
          workflow_instance_id = COALESCE(?, workflow_instance_id),
          approved_at = COALESCE(approved_at, NOW()),
          updated_by = COALESCE(?, updated_by),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [options.approvedAmount || null, options.workflowInstanceId || null, options.operator || null, row.id])
  } else {
    await connection.execute(`
      UPDATE ${target.table}
      SET status = 'approved',
          approved_amount = COALESCE(?, approved_amount, total_amount),
          workflow_instance_id = COALESCE(?, workflow_instance_id),
          approved_at = COALESCE(approved_at, NOW()),
          updated_by = COALESCE(?, updated_by),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [options.approvedAmount || null, options.workflowInstanceId || null, options.operator || null, row.id])
  }
}

export function normalizeApprovalResult(value: unknown): 'approved' | 'rejected' | 'canceled' {
  const status = cleanString(value)?.toLowerCase()
  if (status === 'approved' || status === 'approve' || status === 'passed') return 'approved'
  if (status === 'rejected' || status === 'reject' || status === 'failed') return 'rejected'
  if (status === 'canceled' || status === 'cancelled' || status === 'withdrawn') return 'canceled'
  throw createError({ statusCode: 400, statusMessage: 'unsupported approval result' })
}

export function approvalCodePrefix(target: ApprovalTargetConfig): string {
  return target.codePrefix
}

export function requestDate(value: unknown): string {
  return optionalDate(value) || new Date().toISOString().slice(0, 10)
}

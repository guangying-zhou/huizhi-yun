import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler, readBody } from 'h3'
import { execute, queryRow } from '../../../../utils/db'
import { applyApprovalResult, normalizeApprovalResult, resolveApprovalTarget } from '../../../../utils/financeApproval'
import { resolveApprovalBizTypeByWorkflow } from '../../../../utils/financeWorkflow'
import { cleanString, jsonOrNull, moneyString, type SqlParam } from '../../../../utils/financeWrite'

type ApprovalInstanceRow = RowDataPacket & {
  id: number
  biz_type: string
  biz_code: string
  workflow_instance_id: string | null
}

type CallbackLogRow = RowDataPacket & {
  id: number
  process_status: string
}

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const workflowInstanceId = cleanString(body.workflowInstanceId ?? body.workflow_instance_id ?? body.instance_id)
  const workflowBizType = resolveApprovalBizTypeByWorkflow(
    cleanString(body.resourceCode ?? body.resource_code),
    cleanString(body.actionCode ?? body.action_code)
  )
  const bizType = cleanString(body.bizType ?? body.biz_type) || workflowBizType
  const bizCode = cleanString(body.bizCode ?? body.biz_code ?? body.bizId ?? body.biz_id)
  const externalPlatform = cleanString(body.externalPlatform ?? body.external_platform) || 'workflow'
  const requestId = cleanString(body.requestId ?? body.request_id)
    || cleanString(body.eventId ?? body.event_id)
    || `${workflowInstanceId || bizType}-${bizCode}-${cleanString(body.event ?? body.status ?? body.result) || 'event'}`
  const eventType = cleanString(body.eventType ?? body.event_type ?? body.event) || 'approval_result'

  const approvalInstance = await findApprovalInstance(workflowInstanceId, bizType, bizCode)
  const target = resolveApprovalTarget(approvalInstance?.biz_type || bizType || '')
  const code = approvalInstance?.biz_code || bizCode || ''

  const existingLog = await queryRow<CallbackLogRow>(
    'SELECT id, process_status FROM approval_callback_log WHERE external_platform = ? AND request_id = ?',
    [externalPlatform, requestId]
  )
  if (existingLog?.process_status === 'processed') {
    return {
      data: {
        ignored: true,
        reason: 'duplicate callback',
        requestId
      }
    }
  }

  await execute(`
    INSERT INTO approval_callback_log (
      approval_instance_id,
      workflow_instance_id,
      external_platform,
      event_type,
      request_id,
      payload_json,
      process_status,
      received_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'received', NOW())
    ON DUPLICATE KEY UPDATE
      approval_instance_id = VALUES(approval_instance_id),
      workflow_instance_id = VALUES(workflow_instance_id),
      payload_json = VALUES(payload_json),
      process_status = 'received',
      error_message = NULL
  `, [
    approvalInstance?.id || null,
    workflowInstanceId || approvalInstance?.workflow_instance_id || null,
    externalPlatform,
    eventType,
    requestId,
    jsonOrNull(body)
  ] satisfies SqlParam[])

  try {
    const result = normalizeApprovalResult(body.status ?? body.result ?? body.approvalStatus ?? body.approval_status)
    const approvedAmount = moneyString(body.approvedAmount ?? body.approved_amount, 'approvedAmount')
    const data = await applyApprovalResult(target, code, result, {
      workflowInstanceId: workflowInstanceId || approvalInstance?.workflow_instance_id || null,
      approvedAmount,
      rejectReason: cleanString(body.rejectReason ?? body.reject_reason ?? body.reason),
      operator: cleanString(body.operator ?? body.updatedBy ?? body.updated_by)
    })

    await execute(`
      UPDATE approval_callback_log
      SET process_status = 'processed',
          processed_at = NOW(),
          error_message = NULL
      WHERE external_platform = ? AND request_id = ?
    `, [externalPlatform, requestId])

    return { data }
  } catch (error) {
    await execute(`
      UPDATE approval_callback_log
      SET process_status = 'failed',
          processed_at = NOW(),
          error_message = ?
      WHERE external_platform = ? AND request_id = ?
    `, [error instanceof Error ? error.message : 'callback failed', externalPlatform, requestId])
    throw error
  }
})

async function findApprovalInstance(
  workflowInstanceId: string | null,
  bizType: string | null,
  bizCode: string | null
): Promise<ApprovalInstanceRow | null> {
  if (workflowInstanceId) {
    const row = await queryRow<ApprovalInstanceRow>(
      'SELECT * FROM external_approval_instance WHERE workflow_instance_id = ? LIMIT 1',
      [workflowInstanceId]
    )
    if (row) return row
  }

  if (bizType && bizCode) {
    return queryRow<ApprovalInstanceRow>(
      'SELECT * FROM external_approval_instance WHERE biz_type = ? AND biz_code = ? LIMIT 1',
      [bizType, bizCode]
    )
  }

  return null
}

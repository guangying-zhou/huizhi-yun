/**
 * 回调服务
 * 流程到达终态时向业务模块发送回调通知
 * 支持日志记录和失败补偿
 */
import type { ResultSetHeader } from '~~/server/utils/db'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { execute } from './db'

interface CallbackPayload {
  event: string
  instance_id: number
  instance_no: string
  app_code: string
  resource_code: string
  action_code: string
  biz_id: string
  status: string
  form_data: Record<string, unknown>
  completed_at: string
  initiator_uid: string
  approval_actor_uids?: string[]
  approval_operator_uid?: string
  non_self_approval_actor_uids?: string[]
  has_non_self_approval?: boolean
}

/**
 * 记录回调日志
 */
async function logCallback(
  instanceId: number,
  callbackUrl: string,
  event: string,
  status: 'success' | 'failed',
  payload: CallbackPayload,
  error?: string
) {
  try {
    await execute<ResultSetHeader>(
      `INSERT INTO flow_callback_logs (instance_id, callback_url, event, status, attempts, last_error, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, NOW(), NOW())`,
      [instanceId, callbackUrl, event, status, error || null, JSON.stringify(payload)]
    )
  } catch (err) {
    console.error('[CallbackService] Failed to log callback:', err)
  }
}

/**
 * 执行回调：向业务模块发送 POST 请求
 */
export async function executeCallback(
  callbackUrl: string,
  payload: CallbackPayload
): Promise<void> {
  console.log(`[CallbackService] Sending callback to ${callbackUrl}`, {
    event: payload.event,
    instance_no: payload.instance_no,
    status: payload.status
  })

  try {
    const accessToken = await requestServiceAccessToken({
      audience: payload.app_code,
      scope: 'workflow:callback'
    })

    await $fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Workflow-Event': payload.event
      },
      body: payload,
      timeout: 10000
    })

    console.log('[CallbackService] Callback success')
    await logCallback(payload.instance_id, callbackUrl, payload.event, 'success', payload)
  } catch (err) {
    const error = err as { message?: string, statusCode?: number, status?: number }
    const errorMsg = error.message || String(err)
    console.error('[CallbackService] Callback failed:', {
      url: callbackUrl,
      error: errorMsg,
      statusCode: error.statusCode || error.status
    })

    await logCallback(payload.instance_id, callbackUrl, payload.event, 'failed', payload, errorMsg)
    // 不抛出异常，回调失败不影响主流程
  }
}

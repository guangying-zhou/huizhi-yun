/**
 * 服务启动时自动同步审批动作定义到 Workflow
 */
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { resolveWorkflowApiUrl } from '@hzy/foundation/server/utils/workflowRuntime'
import { appCode, approvalActions } from '~~/app/config/permissions'

export default defineNitroPlugin(() => {
  if (process.env.HZY_CLOUDFLARE_BUILD === 'true' || process.env.HZY_SYNC_APPROVAL_ACTIONS_ON_STARTUP === 'false') {
    console.log('[SyncApprovalActions] Startup sync disabled')
    return
  }

  setTimeout(async () => {
    // 只同步 enabled 的动作
    const enabledActions = approvalActions.filter(a => a.enabled !== false)
    if (enabledActions.length === 0) {
      console.log('[SyncApprovalActions] No enabled approval actions to sync')
      return
    }

    try {
      const workflowApiUrl = await resolveWorkflowApiUrl()
      const url = `${workflowApiUrl}/api/v1/action-defs/sync`
      console.log(`[SyncApprovalActions] POST ${url} appCode=${appCode} actions=${enabledActions.length}`)
      const accessToken = await requestServiceAccessToken({
        audience: 'workflow',
        scope: 'workflow:action_defs:sync'
      })

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          appCode,
          actions: approvalActions // 全量发送，包括 enabled=false 的（由 Workflow 标记停用）
        }),
        signal: AbortSignal.timeout(10000)
      })

      if (response.ok) {
        const result = await response.json()
        if (result.code === 0) {
          const d = result.data
          console.log(`[SyncApprovalActions] Synced to Workflow: ${d.created} new, ${d.updated} updated, ${d.deprecated} deprecated`)
          if (d.errors?.length) {
            console.warn('[SyncApprovalActions] Errors:', d.errors)
          }
        } else {
          console.warn('[SyncApprovalActions] Sync response:', result.message)
        }
      } else {
        const errorBody = await response.text().catch(() => '')
        console.log(`[SyncApprovalActions] Sync skipped: HTTP ${response.status} body=${errorBody}`)
      }
    } catch {
      console.log('[SyncApprovalActions] Workflow不可达，跳过审批动作同步')
    }
  }, 5000) // 延迟执行，避免开发环境 Workflow 尚未启动完成。
})

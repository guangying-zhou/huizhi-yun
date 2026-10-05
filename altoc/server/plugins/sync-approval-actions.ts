/**
 * 服务启动时自动同步审批动作定义到 Workflow
 */
import { syncApprovalActionsToWorkflow } from '@hzy/foundation/server/utils/syncApprovalActions'
import { appCode, approvalActions } from '~~/app/config/permissions'

export default defineNitroPlugin(() => {
  if (process.env.HZY_SYNC_APPROVAL_ACTIONS_ON_STARTUP === 'false') {
    return
  }

  setTimeout(async () => {
    const enabledActions = approvalActions.filter(a => a.enabled !== false)
    if (enabledActions.length === 0) {
      console.log('[SyncApprovalActions] No enabled approval actions to sync')
      return
    }

    try {
      const result = await syncApprovalActionsToWorkflow(appCode, approvalActions)
      console.log(`[SyncApprovalActions] Synced to Workflow: ${result.created} new, ${result.updated} updated, ${result.deprecated} deprecated`)
      if (result.errors?.length) {
        console.warn('[SyncApprovalActions] Errors:', result.errors)
      }
    } catch {
      console.log('[SyncApprovalActions] Workflow 不可达，跳过审批动作同步')
    }
  }, 5000) // 比资源同步晚 2 秒，确保 Workflow 服务已就绪
})

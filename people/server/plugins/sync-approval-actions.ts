import { syncApprovalActionsToWorkflow } from '@hzy/foundation/server/utils/syncApprovalActions'
import { appCode, approvalActions } from '~~/app/config/permissions'

export default defineNitroPlugin(() => {
  if (process.env.HZY_SYNC_APPROVAL_ACTIONS_ON_STARTUP === 'false') {
    return
  }

  setTimeout(async () => {
    const enabledActions = approvalActions.filter(action => action.enabled !== false)
    if (enabledActions.length === 0) return

    try {
      const result = await syncApprovalActionsToWorkflow(appCode, approvalActions)
      console.log(`[People SyncApprovalActions] Synced to Workflow: ${result.created} new, ${result.updated} updated, ${result.deprecated} deprecated`)
      if (result.errors?.length) {
        console.warn('[People SyncApprovalActions] Errors:', result.errors)
      }
    } catch {
      console.log('[People SyncApprovalActions] Workflow 不可达，跳过审批动作同步')
    }
  }, 5000)
})

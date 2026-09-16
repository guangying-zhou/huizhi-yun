/**
 * 服务启动时同步 Codocs 审批动作定义到 Workflow
 */
import { syncApprovalActionsToWorkflow } from '@hzy/foundation/server/utils/syncApprovalActions'
import { appCode, approvalActions } from '~~/app/config/permissions'

export default defineNitroPlugin(() => {
  const syncOnStartup = process.env.HZY_SYNC_APPROVAL_ACTIONS_ON_STARTUP !== 'false'
    && process.env.HZY_CLOUDFLARE_BUILD !== 'true'

  if (!syncOnStartup) return

  setTimeout(async () => {
    try {
      await syncApprovalActionsToWorkflow(appCode, approvalActions)
      console.log(`[SyncApprovalActions] Synced Codocs approval actions: ${approvalActions.length}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('Console service client is not configured')) {
        console.log('[SyncApprovalActions] Console service client 未配置，跳过 Codocs 审批动作同步。请确认 license bootstrap 可访问 Console，且 Console 侧已为 codocs 授予 workflow:action_defs:sync。')
        return
      }
      console.log(`[SyncApprovalActions] Workflow不可达或审批动作同步失败，跳过 Codocs 审批动作同步: ${message}`)
    }
  }, 5000)
})

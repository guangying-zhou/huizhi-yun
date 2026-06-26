/**
 * 审批动作同步工具
 *
 * 将业务模块的 approvalActions manifest 同步到 Workflow 服务。
 * 由各模块的 server/plugins/sync-approval-actions.ts 调用。
 */
import { requestServiceAccessToken } from './serviceOidc'
import { resolveWorkflowApiUrl } from './workflowRuntime'

interface ApprovalActionItem {
  resourceCode: string
  actionCode: string
  name: string
  description?: string
  formSchemaCode?: string
  icon?: string
  embedUrlPattern?: string
  sortOrder?: number
  enabled?: boolean
}

interface SyncResult {
  created: number
  updated: number
  deprecated: number
  errors: string[]
}

/**
 * 同步审批动作到 Workflow 服务
 *
 * @param appCode 应用编码
 * @param actions 审批动作清单
 * @param workflowApiUrl Workflow 服务地址
 */
export async function syncApprovalActionsToWorkflow(
  appCode: string,
  actions: ApprovalActionItem[],
  workflowApiUrl?: string
): Promise<SyncResult> {
  const baseUrl = workflowApiUrl || await resolveWorkflowApiUrl()
  const accessToken = await requestServiceAccessToken({
    audience: 'workflow',
    scope: 'workflow:action_defs:sync'
  })

  const response = await $fetch<{ code: number, data: SyncResult }>(
    `${baseUrl}/api/v1/action-defs/sync`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      body: {
        appCode,
        actions
      },
      timeout: 10000
    }
  )

  if (response.code !== 0) {
    throw new Error(`同步审批动作失败: code=${response.code}`)
  }

  return response.data
}

import { defineEventHandler } from 'h3'
import { syncApprovalActionsToWorkflow } from '@hzy/foundation/server/utils/syncApprovalActions'
import { appCode, approvalActions } from '~~/app/config/permissions'

export default defineEventHandler(async () => {
  const enabledActions = approvalActions.filter(action => action.enabled !== false)
  const data = await syncApprovalActionsToWorkflow(appCode, enabledActions)
  return { data }
})

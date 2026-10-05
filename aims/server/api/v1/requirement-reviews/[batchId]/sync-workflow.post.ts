import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { resolveWorkflowApiUrl } from '@hzy/foundation/server/utils/workflowRuntime'
import { buildAimsProjectListRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'
import { callAimsRuntime } from '~~/server/utils/projectDocumentAccess'

interface WorkflowSyncState {
  alreadySynced?: boolean
  workflowInstanceId?: string
  actionCode?: string
  synced?: boolean
  reason?: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const batchId = Number(getRouterParam(event, 'batchId'))
  if (!batchId || Number.isNaN(batchId)) {
    throw createError({ statusCode: 400, message: '无效的批次ID' })
  }

  const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery(event, {
    uid,
    baseQuery: { operator_uid: uid }
  })
  const prepare = await callAimsRuntime<WorkflowSyncState>(
    event,
    `/v1/aims/requirement-reviews/${encodeURIComponent(String(batchId))}/sync-workflow`,
    {
      method: 'POST',
      query: runtimeQuery,
      scope: 'aims.write'
    }
  )
  if (prepare.alreadySynced) {
    return { code: 0, data: prepare }
  }

  try {
    const workflowApiUrl = await resolveWorkflowApiUrl()
    const actionCode = stringValue(prepare.actionCode) || 'requirement_change'
    const url = `${workflowApiUrl}/api/v1/instances/by-biz?app_code=aims&resource_code=requirements&biz_id=${batchId}&action_code=${actionCode}`
    const accessToken = await requestServiceAccessToken({
      audience: 'workflow',
      scope: 'workflow:instances:read'
    })
    const res = await $fetch<{ code: number, data: { id: number } | null }, string>(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (res.code === 0 && res.data?.id) {
      const instanceId = String(res.data.id)
      const synced = await callAimsRuntime<WorkflowSyncState>(
        event,
        `/v1/aims/requirement-reviews/${encodeURIComponent(String(batchId))}/sync-workflow`,
        {
          method: 'POST',
          query: runtimeQuery,
          body: { workflowInstanceId: instanceId },
          scope: 'aims.write'
        }
      )
      return { code: 0, data: synced }
    }
    return { code: 0, data: { synced: false, reason: 'instance not found' } }
  } catch (err) {
    console.warn('[sync-workflow] failed:', (err as Error)?.message)
    return { code: 0, data: { synced: false, reason: 'workflow error' } }
  }
})

function stringValue(value: unknown) {
  return String(value || '').trim()
}

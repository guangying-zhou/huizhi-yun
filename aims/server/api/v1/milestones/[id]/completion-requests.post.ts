import { getRequestUid } from '~~/server/utils/authIdentity'
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'
import { requirePermission } from '~~/server/utils/checkPermission'
import { resolveProjectGovernanceRoleHolder } from '~~/server/utils/projectGovernanceRoleHolder'

interface CompletionRequest {
  id: number
  requestId: number
  requestNo: string
  requestVersion: number
  milestoneId: number
  projectId: number
  projectCode: string
  requestedBy: string
  projectDirectorUid: string
  projectDirectorRevision: number
  status: 'pending'
  snapshotSha256: string
  existing: boolean
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })
  const milestoneId = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(milestoneId) || milestoneId <= 0) {
    throw createError({ statusCode: 400, message: '无效的里程碑ID' })
  }
  await requirePermission(event, 'projects', 'edit', '需要项目维护权限才可以申请完成里程碑')
  const body = await readBody<{ comment?: unknown }>(event).catch((): { comment?: unknown } => ({}))
  const director = await resolveProjectGovernanceRoleHolder(event, 'project_director')
  const data = await forwardAimsRuntimePost<CompletionRequest>(
    event,
    `/v1/aims/milestones/${milestoneId}/completion-requests`,
    {
      uid,
      query: {
        current_user_completion_request_authorized: '1',
        trusted_project_director_uid: director.uid,
        trusted_project_director_revision: String(director.revision)
      },
      body: {
        comment: String(body.comment || '').trim(),
        projectDirectorUid: director.uid,
        projectDirectorRevision: director.revision
      }
    }
  )
  return { code: 0, data }
})

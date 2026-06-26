/**
 * 获取项目集（portfolio）对应 GitLab 群组下的 Codocs 文档列表
 * 用于任务执行页面「提交成果」时选择项目集文档
 *
 * 映射关系：
 *   aims_projects.portfolio_id → project_portfolios.git_group → codocs.documents.project_code
 *   条件：doc_type=project AND project_code=<git_group>
 */
import { searchProjectDocuments } from '~~/server/utils/codocsApi'
import { forwardAimsRuntimeGet } from '~~/server/utils/aimsRuntimeForward'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const query = getQuery(event)
  const aimsProjectId = Number(query.aimsProjectId || 0)
  if (!aimsProjectId) {
    throw createError({ statusCode: 400, message: 'aimsProjectId 不能为空' })
  }

  const context = await forwardAimsRuntimeGet<{ gitGroup: string | null }>(
    event,
    `/v1/aims/projects/${encodeURIComponent(String(aimsProjectId))}/codocs-project-documents-context`,
    { uid, query: await buildAimsProjectRuntimeAccessQuery(event, { projectId: aimsProjectId, uid }) }
  )

  if (!context.gitGroup) {
    // 未绑定项目集或项目集未设置 git 群组：返回空列表，前端友好提示
    return {
      code: 0,
      data: { folders: [], items: [], gitGroup: null }
    }
  }

  const res = await searchProjectDocuments({ event, projectCode: context.gitGroup, actorUid: uid })

  return {
    code: 0,
    data: {
      gitGroup: context.gitGroup,
      folders: (res.data?.folders || []).map(folder => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parent_id,
        updatedAt: folder.updated_at
      })),
      items: res.data?.items || []
    }
  }
})

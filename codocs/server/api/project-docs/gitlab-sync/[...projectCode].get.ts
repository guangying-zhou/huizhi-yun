/**
 * 从 GitLab 同步项目文档到项目 OSS。
 * DB 元数据由 tenant-runtime 合同负责；Codocs server 不直连数据库。
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { syncProjectDocsFromGitLab } from '~~/server/utils/gitProjectIntegration'

export default defineEventHandler(async (event) => {
  const rawProjectCode = getRouterParam(event, 'projectCode')
  if (!rawProjectCode) {
    throw createError({ statusCode: 400, message: '缺少项目ID' })
  }

  requireRequestUid(event, '未登录或会话已过期')
  const projectCode = decodeURIComponent(rawProjectCode)
  const data = await syncProjectDocsFromGitLab(projectCode)

  return {
    code: 0,
    message: 'success',
    data
  }
})

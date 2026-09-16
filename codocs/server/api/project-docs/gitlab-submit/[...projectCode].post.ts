/**
 * 提交项目文档到 GitLab。
 * Codocs server 只编排 OSS -> GitLab，不直连数据库写 committed_at。
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { submitProjectDocsToGitLab } from '~~/server/utils/gitProjectIntegration'
import { requirePermission } from '~~/server/utils/checkPermission'

interface SubmitDocItem {
  oss_path?: string
  gitlab_path?: string
}

interface SubmitRequestBody {
  docs?: SubmitDocItem[]
}

export default defineEventHandler(async (event) => {
  const rawProjectCode = getRouterParam(event, 'projectCode')
  if (!rawProjectCode) {
    throw createError({ statusCode: 400, message: '缺少项目ID' })
  }

  const uid = requireRequestUid(event, '未登录或会话已过期')
  await requirePermission(event, 'projects', 'edit', '缺少项目文档提交权限')

  const body = await readBody<SubmitRequestBody>(event)
  const docs = body.docs || []
  if (!Array.isArray(docs)) {
    throw createError({ statusCode: 400, message: '参数错误' })
  }

  const data = await submitProjectDocsToGitLab({
    projectCode: decodeURIComponent(rawProjectCode),
    uid,
    authorName: uid,
    authorEmail: `${uid}@wiztek.cn`,
    docs
  })

  return {
    code: 0,
    message: 'success',
    data
  }
})

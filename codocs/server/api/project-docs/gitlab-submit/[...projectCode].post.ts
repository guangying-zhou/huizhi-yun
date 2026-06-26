/**
 * 提交项目文档到 GitLab。
 * Codocs server 只编排 OSS -> GitLab，不直连数据库写 committed_at。
 */
import { submitProjectDocsToGitLab } from '~~/server/utils/gitProjectIntegration'

interface SubmitDocItem {
  oss_path?: string
  gitlab_path?: string
}

interface SubmitRequestBody {
  uid?: string
  docs?: SubmitDocItem[]
}

export default defineEventHandler(async (event) => {
  const rawProjectCode = getRouterParam(event, 'projectCode')
  if (!rawProjectCode) {
    throw createError({ statusCode: 400, message: '缺少项目ID' })
  }

  const body = await readBody<SubmitRequestBody>(event)
  const uid = String(body.uid || '').trim()
  const docs = body.docs || []
  if (!uid || !Array.isArray(docs)) {
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

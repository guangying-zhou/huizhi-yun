import { createHash } from 'node:crypto'
import { getGitRepositoryFile } from '@hzy/foundation/server/utils/gitIntegration'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { checkPermission } from '~~/server/utils/checkPermission'
import { getCodocsProjectDocumentReviewContent } from '~~/server/utils/codocsApi'
import { callAimsRuntime } from '~~/server/utils/projectDocumentAccess'
import { resolveProjectGovernanceRoleHolder } from '~~/server/utils/projectGovernanceRoleHolder'

interface QueueItem {
  submissionId: number
  submissionNo: string
  documentSource: 'codocs' | 'repo'
  documentUuid: string | null
  documentVersionId: number | null
  documentVersionNum: number | null
  contentSha256: string
  repoProjectCode: string | null
  repoFilePath: string | null
  repoCommitId: string | null
  deliverableName: string
  reviewRole: 'qa' | 'project_director'
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })
  const submissionId = Number(getRouterParam(event, 'submissionId'))
  if (!Number.isSafeInteger(submissionId) || submissionId <= 0) {
    throw createError({ statusCode: 400, message: '质量检查提交编号无效' })
  }
  const [canReview, canWaive] = await Promise.all([
    checkPermission(event, 'quality_reviews', 'review'),
    checkPermission(event, 'quality_reviews', 'waive')
  ])
  const qa = canReview ? await resolveProjectGovernanceRoleHolder(event, 'qa') : null
  const isQA = qa?.uid === uid
  const director = !isQA && canWaive
    ? await resolveProjectGovernanceRoleHolder(event, 'project_director')
    : null
  const isDirector = director?.uid === uid
  if (!isQA && !isDirector) {
    throw createError({ statusCode: 403, message: '仅当前 QA 或冲突转交后的项目总监可以读取确定文档版本' })
  }
  const queue = await callAimsRuntime<{ items?: QueueItem[] }>(
    event,
    '/v1/aims/quality-reviews/queue',
    {
      query: {
        current_user: uid,
        current_user_can_review_quality_reviews: '1',
        current_user_is_qa: isQA ? '1' : '0',
        current_user_qa_revision: isQA ? String(qa?.revision) : '0',
        current_user_is_project_director: isDirector ? '1' : '0',
        current_user_project_director_revision: isDirector ? String(director?.revision) : '0'
      },
      scope: 'aims.read'
    }
  )
  const item = (queue.items || []).find(entry => Number(entry.submissionId) === submissionId)
  if (!item?.submissionNo) {
    throw createError({ statusCode: 404, message: '该质量检查任务不存在或当前不可处理' })
  }
  if (item.documentSource === 'repo') {
    if (!item.repoProjectCode || !item.repoFilePath || !item.repoCommitId || !item.contentSha256) {
      throw createError({ statusCode: 409, message: '仓库质量检查任务缺少不可变快照信息' })
    }
    const file = await getGitRepositoryFile({
      repoPath: item.repoProjectCode,
      path: item.repoFilePath,
      commitId: item.repoCommitId
    })
    const contentSha256 = createHash('sha256').update(file.content, 'utf8').digest('hex')
    if (String(file.commitId || '').trim() !== item.repoCommitId || contentSha256 !== item.contentSha256) {
      throw createError({ statusCode: 409, message: '仓库文档快照校验失败，内容与送检证据不一致' })
    }
    return {
      code: 0,
      data: {
        documentSource: 'repo',
        documentUuid: null,
        versionId: null,
        versionNum: null,
        repoProjectCode: item.repoProjectCode,
        repoFilePath: file.path,
        repoCommitId: item.repoCommitId,
        title: file.name || item.deliverableName,
        contentSize: Buffer.byteLength(file.content, 'utf8'),
        contentSha256,
        content: file.content
      }
    }
  }
  if (!item.documentUuid || !item.documentVersionId) {
    throw createError({ statusCode: 409, message: 'Codocs 质量检查任务缺少确定版本' })
  }
  const data = await getCodocsProjectDocumentReviewContent({
    event,
    actorUid: uid,
    documentUuid: item.documentUuid,
    versionId: item.documentVersionId,
    submissionNo: item.submissionNo,
    roleCode: item.reviewRole
  })
  return { code: 0, data }
})

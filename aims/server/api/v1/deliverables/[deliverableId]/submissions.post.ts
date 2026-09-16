import { createHash } from 'node:crypto'
import { getGitRepositoryFile } from '@hzy/foundation/server/utils/gitIntegration'
import { getRequestUid } from '~~/server/utils/authIdentity'
import {
  createCodocsProjectDocumentReviewGrant,
  resolveCodocsProjectDocumentVersion
} from '~~/server/utils/codocsApi'
import { buildAimsProjectListRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'
import { callAimsRuntime } from '~~/server/utils/projectDocumentAccess'
import { resolveProjectGovernanceRoleHolder } from '~~/server/utils/projectGovernanceRoleHolder'

interface Deliverable {
  id: number
  projectId?: number
  project_id?: number
  projectCode?: string
  project_code?: string
  deliverableType?: string
  deliverable_type?: string
  documentSource?: string
  document_source?: string
  documentUuid?: string | null
  document_uuid?: string | null
  repoProjectCode?: string | null
  repo_project_code?: string | null
  repoFilePath?: string | null
  repo_file_path?: string | null
  repoCommitId?: string | null
  repo_commit_id?: string | null
}

interface Submission {
  id: number
  submissionNo: string
  documentSource: 'codocs' | 'repo'
  documentUuid: string | null
  documentVersionId: number | null
  repoProjectCode: string | null
  repoFilePath: string | null
  repoCommitId: string | null
  reviewRoute: 'qa' | 'pm_completeness_then_director_quality'
  status: string
  submittedBy: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })
  const deliverableId = Number(getRouterParam(event, 'deliverableId'))
  if (!Number.isSafeInteger(deliverableId) || deliverableId <= 0) {
    throw createError({ statusCode: 400, message: '交付物编号无效' })
  }
  const body = await readBody<{ documentVersionId?: number }>(event)

  const accessQuery = await buildAimsProjectListRuntimeAccessQuery(event, {
    uid,
    baseQuery: { deliverable_id: deliverableId }
  })
  const deliverables = await callAimsRuntime<Deliverable[]>(
    event,
    '/v1/aims/deliverables',
    { query: accessQuery, scope: 'aims.read' }
  )
  const deliverable = deliverables.find(item => Number(item.id) === deliverableId)
  if (!deliverable) throw createError({ statusCode: 404, message: '交付物不存在或无权访问' })
  const projectId = Number(deliverable.projectId ?? deliverable.project_id)
  const projectCode = text(deliverable.projectCode ?? deliverable.project_code)
  const documentUuid = text(deliverable.documentUuid ?? deliverable.document_uuid)
  const documentType = text(deliverable.deliverableType ?? deliverable.deliverable_type)
  const documentSource = text(deliverable.documentSource ?? deliverable.document_source) || 'codocs'
  const repoProjectCode = text(deliverable.repoProjectCode ?? deliverable.repo_project_code)
  const repoFilePath = text(deliverable.repoFilePath ?? deliverable.repo_file_path)
  const repoCommitId = text(deliverable.repoCommitId ?? deliverable.repo_commit_id)
  if (!projectId || !projectCode || documentType !== 'document') {
    throw createError({ statusCode: 409, message: '该交付物未绑定可供 QA 检查的文档' })
  }

  const resolveDocumentSnapshot = async (): Promise<Record<string, unknown>> => {
    if (documentSource === 'codocs') {
      if (!documentUuid) {
        throw createError({ statusCode: 409, message: '该交付物未绑定可供 QA 检查的 Codocs 文档' })
      }
      const documentVersionId = body?.documentVersionId === undefined
        ? 'latest'
        : Number(body.documentVersionId)
      if (documentVersionId !== 'latest' && (!Number.isSafeInteger(documentVersionId) || documentVersionId <= 0)) {
        throw createError({ statusCode: 400, message: '请选择确定的 Codocs 文档版本' })
      }
      const resolvedVersion = await resolveCodocsProjectDocumentVersion({
        event,
        actorUid: uid,
        projectCode,
        documentUuid,
        versionId: documentVersionId
      })
      return {
        documentSource,
        documentUuid,
        documentVersionId: resolvedVersion.versionId,
        documentVersionNum: resolvedVersion.versionNum,
        contentSha256: resolvedVersion.contentSha256
      }
    }
    if (documentSource === 'repo') {
      if (!repoProjectCode || !repoFilePath || !repoCommitId) {
        throw createError({ statusCode: 409, message: '仓库交付物必须绑定确定的提交快照后才能送检' })
      }
      const resolvedFile = await getGitRepositoryFile({
        repoPath: repoProjectCode,
        path: repoFilePath,
        commitId: repoCommitId
      })
      if (text(resolvedFile.commitId) !== repoCommitId) {
        throw createError({ statusCode: 409, message: '仓库返回的提交版本与交付物快照不一致' })
      }
      return {
        documentSource,
        repoProjectCode,
        repoFilePath,
        repoCommitId,
        contentSha256: createHash('sha256').update(resolvedFile.content, 'utf8').digest('hex')
      }
    }
    throw createError({ statusCode: 409, message: '该交付物的文档来源暂不支持质量检查' })
  }

  const [resolvedBody, qaHolder] = await Promise.all([
    resolveDocumentSnapshot(),
    resolveProjectGovernanceRoleHolder(event, 'qa')
  ])
  const createQuery = await buildAimsProjectListRuntimeAccessQuery(event, {
    uid,
    baseQuery: {
      deliverable_id: deliverableId,
      current_user_document_version_resolved: '1',
      current_user_is_qa: qaHolder.uid === uid ? '1' : '0',
      current_user_qa_revision: qaHolder.uid === uid ? String(qaHolder.revision) : '0'
    }
  })
  const submission = await callAimsRuntime<Submission>(
    event,
    `/v1/aims/deliverables/${deliverableId}/submissions`,
    {
      method: 'POST',
      query: createQuery,
      body: {
        ...resolvedBody
      },
      scope: 'aims.write'
    }
  )
  if (submission.submittedBy !== uid) {
    throw createError({ statusCode: 409, message: '该文档版本已由其他人员提交检查' })
  }
  let activationQuery: Record<string, string>
  let activationBody: Record<string, unknown>
  if (submission.documentSource === 'codocs') {
    if (!submission.documentUuid || !submission.documentVersionId) {
      throw createError({ statusCode: 409, message: 'Codocs 质量检查提交缺少确定版本' })
    }
    const granteeRoleCode = submission.reviewRoute === 'qa' ? 'qa' : 'project_director'
    const grant = await createCodocsProjectDocumentReviewGrant({
      event,
      actorUid: uid,
      documentUuid: submission.documentUuid,
      versionId: submission.documentVersionId,
      submissionNo: submission.submissionNo,
      granteeRoleCode
    })
    activationQuery = {
      current_user: uid,
      current_user_document_review_grant_created: '1'
    }
    activationBody = { reviewGrantId: grant.grantId }
  } else {
    activationQuery = {
      current_user: uid,
      current_user_repository_review_snapshot_resolved: '1'
    }
    activationBody = {}
  }
  const activated = await callAimsRuntime<Submission>(
    event,
    `/v1/aims/deliverable-submissions/${submission.id}:activate-review`,
    {
      method: 'POST',
      query: activationQuery,
      body: activationBody,
      scope: 'aims.write'
    }
  )
  return { code: 0, data: activated }
})

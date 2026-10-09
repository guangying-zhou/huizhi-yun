import { owningCreateError as createError, type OwningH3Event as H3Event } from '@hzy/foundation/server/utils/owningModuleHttp'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadProjectCommandAuthorization } from '@hzy/foundation/server/utils/projectCommandAuthorization'

export type QualityAction = 'submission' | 'completeness' | 'waiver'
type Submission = { id: number, documentSource: 'codocs' | 'repo', documentUuid: string | null, documentVersionId: number | null, contentSha256: string, submissionNo: string, reviewRoute: 'qa' | 'pm_completeness_then_director_quality', submittedBy: string }
type Deliverable = { id: number, projectId: number, projectCode: string, deliverableType: string, documentSource: string, documentUuid?: string, repoProjectCode?: string, repoFilePath?: string, repoCommitId?: string }
const validID = (v: string) => /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v))
const fields = { submission: [], completeness: ['action', 'comment'], waiver: ['reason'] }
export async function writeHostDeliverableQuality(event: H3Event, action: QualityAction, projectId: string, objectId: string, input: Record<string, unknown>, key: string, projectScope: Record<string, string>) {
  if (!validID(projectId) || !validID(objectId) || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,170}$/.test(key) || Object.keys(input).some(k => !fields[action].includes(k as never))) throw createError({ statusCode: 400, message: '质量动作参数无效' })
  if (action === 'completeness' && !['pass', 'return'].includes(String(input.action))) throw createError({ statusCode: 400, message: '完整性操作无效' })
  for (const k of ['comment', 'reason']) if (k in input && (typeof input[k] !== 'string' || input[k].length > (k === 'reason' ? 1000 : 4000))) throw createError({ statusCode: 400, message: '质量说明无效' })
  if ((action === 'waiver' && !String(input.reason || '').trim()) || (action === 'completeness' && input.action === 'return' && !String(input.comment || '').trim())) throw createError({ statusCode: 400, message: '请填写原因或缺失项' })
  const user = await requireEnterpriseUser(event)
  const resource = action === 'waiver' ? 'quality_reviews' : 'projects'
  const permitAction = action === 'waiver' ? 'waive' : 'view'
  const permit = await loadProjectCommandAuthorization(event, user, { resource, action: permitAction, projectId, workItemId: '' })
  let facts: Record<string, unknown> = {}
  const { resolveProjectGovernanceRoleHolder, requireCurrentProjectGovernanceRoleHolder } = await import('@hzy/foundation/server/utils/projectGovernanceRoleHolder')
  if (action === 'waiver') {
    const director = await requireCurrentProjectGovernanceRoleHolder(event, 'project_director', user.uid)
    facts = { directorUid: director.uid, directorRevision: director.revision }
  }
  const call = async <T>(operation: 'aims.quality-submission-resume' | 'aims.quality-submission-create' | 'aims.quality-submission-activate' | 'aims.quality-completeness' | 'aims.quality-waiver', target: string, payload: Record<string, unknown>, phase: string) => {
    // External source resolution/grant may take time. Refresh the authorization
    // immediately before each fixed U write; never reuse a stale 15s permit.
    const current = await loadProjectCommandAuthorization(event, user, { resource, action: permitAction, projectId, workItemId: '' })
    if (operation === 'aims.quality-submission-create') {
      const holder = await resolveProjectGovernanceRoleHolder(event, 'qa')
      facts = { qaUid: holder.uid, qaRevision: holder.revision }
    }
    if (operation === 'aims.quality-waiver') {
      const holder = await requireCurrentProjectGovernanceRoleHolder(event, 'project_director', user.uid)
      facts = { directorUid: holder.uid, directorRevision: holder.revision }
    }
    await prepareEnterpriseRuntime(event, operation)
    return await callEnterpriseRuntime<{ code: number, data: T }>(event, operation, {
      tenant: user.tenant, deployment: user.deployment, projectId, objectId: target, input: payload, projectScope, facts,
      authorization: { ...current, objectId: target, subId: '' }
    }, { idempotencyKey: `${key}:${phase}` })
  }
  if (action !== 'submission') return await call(action === 'waiver' ? 'aims.quality-waiver' : 'aims.quality-completeness', objectId, input, action)
  const qa = await resolveProjectGovernanceRoleHolder(event, 'qa')
  facts = { qaUid: qa.uid, qaRevision: qa.revision }
  await prepareEnterpriseRuntime(event, 'aims.project-deliverable-list')
  const list = await callEnterpriseRuntime<{ code: number, data: Deliverable[] | { items: Deliverable[] } }>(event, 'aims.project-deliverable-list', {
    tenant: user.tenant, deployment: user.deployment, query: { ...projectScope, project_id: projectId, deliverable_id: objectId },
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'project-deliverables', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
  const rows = Array.isArray(list.data) ? list.data : list.data?.items
  const d = rows?.find(row => String(row.id) === objectId && String(row.projectId) === projectId)
  if (list.code !== 0 || !d || d.deliverableType !== 'document' || !d.projectCode) throw createError({ statusCode: 404, message: '项目交付文档不存在或不可访问' })
  // The initial scoped permit was checked before any source service IO.
  if (!permit.allowed) throw createError({ statusCode: 403, message: '无项目质量提交权限' })
  const resumed = await call<{ submission: Submission | null }>('aims.quality-submission-resume', objectId, {}, 'create')
  if (resumed.code !== 0 || !resumed.data || !('submission' in resumed.data)) throw createError({ statusCode: 503, message: '送检恢复响应无效' })
  const previous = resumed.data.submission
  if (previous && (previous.submittedBy !== user.uid || previous.documentSource !== d.documentSource || !Number.isSafeInteger(previous.id))) throw createError({ statusCode: 409, message: '送检恢复绑定无效' })
  let snapshot: Record<string, unknown>
  if (d.documentSource === 'codocs' && d.documentUuid) {
    const { resolveCodocsProjectDocumentVersion } = await import('../../../server/utils/codocsApi')
    const version = await resolveCodocsProjectDocumentVersion({ event, actorUid: user.uid, projectCode: d.projectCode, documentUuid: d.documentUuid, versionId: previous?.documentVersionId || 'latest' })
    if (version.documentUuid !== d.documentUuid || (previous && (version.versionId !== previous.documentVersionId || version.contentSha256 !== previous.contentSha256))) throw createError({ statusCode: 409, message: '受检文档版本绑定不一致' })
    snapshot = { documentSource: 'codocs', documentUuid: d.documentUuid, documentVersionId: version.versionId, documentVersionNum: version.versionNum, contentSha256: version.contentSha256 }
  } else if (d.documentSource === 'repo' && d.repoProjectCode && d.repoFilePath && d.repoCommitId) {
    const { getGitRepositoryFile } = await import('@hzy/foundation/server/utils/gitIntegration')
    const file = await getGitRepositoryFile({ repoPath: d.repoProjectCode, path: d.repoFilePath, commitId: d.repoCommitId })
    if (file.commitId !== d.repoCommitId) throw createError({ statusCode: 409, message: '仓库受检提交版本不一致' })
    snapshot = { documentSource: 'repo', repoProjectCode: d.repoProjectCode, repoFilePath: d.repoFilePath, repoCommitId: d.repoCommitId, contentSha256: await sha256Hex(file.content) }
  } else throw createError({ statusCode: 409, message: '交付文档须绑定确定版本才能送检' })
  const created = await call<Submission>('aims.quality-submission-create', objectId, snapshot, 'create')
  const s = created.data
  if (created.code !== 0 || !s || !Number.isSafeInteger(s.id) || s.id <= 0 || s.submittedBy !== user.uid || !['qa', 'pm_completeness_then_director_quality'].includes(s.reviewRoute) || !s.submissionNo) throw createError({ statusCode: 503, message: '质量提交响应无效' })
  let activation: Record<string, unknown> = {}
  if (s.documentSource === 'codocs') {
    if (s.documentUuid !== d.documentUuid || !s.documentVersionId) throw createError({ statusCode: 409, message: '质量提交文档绑定不一致' })
    const { createCodocsProjectDocumentReviewGrant } = await import('../../../server/utils/codocsApi')
    const grant = await createCodocsProjectDocumentReviewGrant({ event, actorUid: user.uid, documentUuid: s.documentUuid, versionId: s.documentVersionId, submissionNo: s.submissionNo, granteeRoleCode: s.reviewRoute === 'qa' ? 'qa' : 'project_director' })
    if (grant.documentUuid !== s.documentUuid || grant.versionId !== s.documentVersionId || grant.submissionNo !== s.submissionNo || grant.granteeRoleCode !== (s.reviewRoute === 'qa' ? 'qa' : 'project_director') || !Number.isSafeInteger(grant.grantId) || grant.grantId <= 0) throw createError({ statusCode: 409, message: '受检访问授权绑定不一致' })
    activation = { reviewGrantId: grant.grantId }
  } else if (s.documentSource !== 'repo') throw createError({ statusCode: 503, message: '质量提交来源无效' })
  return await call<Submission>('aims.quality-submission-activate', String(s.id), activation, 'activate')
}

async function sha256Hex(content: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

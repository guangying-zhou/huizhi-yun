import { owningCreateError as createError, type OwningH3Event as H3Event } from '@hzy/foundation/server/utils/owningModuleHttp'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { loadProjectCommandAuthorization } from '@hzy/foundation/server/utils/projectCommandAuthorization'
import { getCodocsProjectDocumentContent } from '../../../server/utils/codocsApi'
import { hostProjectDocumentContext, type DocumentReadPermitProvider } from './projectDocumentPorts'
import { readHostProjectDocumentSource } from './projectDocumentSources'

export type RequirementReadAction = 'list' | 'view' | 'spec' | 'targets' | 'versions' | 'change-diff' | 'change-impact' | 'review-list' | 'review-resolve'
export type RequirementWriteAction = 'create' | 'content-create' | 'import' | 'update' | 'delete' | 'content-update' | 'content-delete' | 'content-restore' | 'change-create' | 'task-create' | 'review-create' | 'review-append' | 'review-withdraw' | 'review-sync' | 'review-create-tasks'
const numeric = /^[1-9]\d*$/
const validID = (value: string) => numeric.test(value) && Number.isSafeInteger(Number(value))
const fields: Record<RequirementWriteAction, string[]> = {
  'create': ['title', 'type', 'category', 'priority', 'source', 'milestoneId', 'workItemId', 'scopeNote', 'contentIds', 'content'],
  'content-create': ['kind', 'title', 'parentId', 'headingDepth', 'contentMd'],
  'import': ['source', 'docName', 'codocsUuid', 'repoProjectCode', 'repoFilePath', 'repoCommitId', 'mode', 'headingLevels', 'forceOverwrite', 'workItemId', 'items'],
  'update': ['title', 'type', 'category', 'priority', 'source', 'milestoneId'],
  'delete': [],
  'content-update': ['title', 'contentMd'],
  'content-delete': [],
  'content-restore': [],
  'change-create': ['reason', 'workItemId', 'contents'],
  'task-create': ['title', 'description', 'milestoneId', 'assigneeUid', 'estimatedHours', 'priority', 'startDate', 'dueDate', 'reviewLevel', 'deliverables'],
  'review-create': ['title', 'description', 'batchType', 'requirementIds'],
  'review-append': ['requirementIds'], 'review-withdraw': [], 'review-sync': [], 'review-create-tasks': []
}
export async function readHostProjectRequirements(event: H3Event, provider: DocumentReadPermitProvider, action: RequirementReadAction, projectId: string, objectId = '', query: Record<string, string> = {}) {
  if (!validID(projectId) || (objectId && !validID(objectId))) throw createError({ statusCode: 400, message: '项目或需求标识无效' })
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'requirements', 'view', snapshot.actionPolicies?.requirements)) throw createError({ statusCode: 403, message: '无项目需求查看权限' })
  const scope = await provider(projectId)
  const extendedReads = { 'versions': 'aims.project-requirement-versions', 'change-diff': 'aims.project-requirement-change-diff', 'change-impact': 'aims.project-requirement-change-impact', 'review-list': 'aims.project-requirement-review-list', 'review-resolve': 'aims.project-requirement-review-resolve' } as const
  const operation = action in extendedReads ? extendedReads[action as keyof typeof extendedReads] : action === 'list' ? 'aims.project-requirement-list' : action === 'view' ? 'aims.project-requirement-view' : action === 'spec' ? 'aims.project-requirement-spec-view' : 'aims.project-requirement-target-list'
  await prepareEnterpriseRuntime(event, operation)
  return await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment, projectId, ...(objectId ? { requirementId: objectId } : {}),
    projectReadAuthorization: scope.authorization, query: { ...query, ...scope.query },
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'requirements', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
}
export async function writeHostProjectRequirement(event: H3Event, provider: DocumentReadPermitProvider, action: RequirementWriteAction, projectId: string, objectId: string, payload: Record<string, unknown>, key: string, projectScope: Record<string, string>) {
  if (!validID(projectId) || (objectId && !validID(objectId)) || !key || key.length > 191 || !fields[action] || Object.keys(payload).some(field => !fields[action].includes(field))) throw createError({ statusCode: 400, message: '需求操作参数无效' })
  const user = await requireEnterpriseUser(event)
  const authorization = await loadProjectCommandAuthorization(event, user, { resource: 'requirements', action: 'edit', projectId, workItemId: '' })
  // Source access is rechecked on every attempt, including receipt replay. Do not
  // trust a browser's UUID, repository path or claimed preview success.
  if (action === 'import') {
    if (payload.source === 'codocs') {
      const uuid = String(payload.codocsUuid || '')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) throw createError({ statusCode: 400, message: '规格书文档标识无效' })
      const context = await hostProjectDocumentContext(event, provider, projectId)
      if (!context.isMember || !context.projectCode) throw createError({ statusCode: 403, message: '无项目规格书来源权限' })
      await getCodocsProjectDocumentContent({ event, actorUid: user.uid, projectCode: context.projectCode, documentUuid: uuid, sourceApp: 'enterprise' })
    } else if (payload.source === 'repo') {
      if (!payload.repoCommitId) throw createError({ statusCode: 400, message: '请选择仓库文档的固定提交版本' })
      await readHostProjectDocumentSource(event, provider, 'repo-doc', {
        projectId, repoProjectCode: String(payload.repoProjectCode || ''), path: String(payload.repoFilePath || ''), commitId: String(payload.repoCommitId)
      })
    } else throw createError({ statusCode: 400, message: '规格书来源无效' })
  }
  const extendedWrites = { 'review-sync': 'aims.project-requirement-review-sync', 'review-create-tasks': 'aims.project-requirement-review-create-tasks', 'change-create': 'aims.project-requirement-change-create', 'task-create': 'aims.project-requirement-task-create', 'review-create': 'aims.project-requirement-review-create', 'review-append': 'aims.project-requirement-review-append', 'review-withdraw': 'aims.project-requirement-review-withdraw' } as const
  const operation = action in extendedWrites ? extendedWrites[action as keyof typeof extendedWrites] : action === 'create' ? 'aims.project-requirement-create' : action === 'content-create' ? 'aims.project-requirement-content-create' : action === 'import' ? 'aims.project-requirement-import' : action === 'update' ? 'aims.project-requirement-update' : action === 'delete' ? 'aims.project-requirement-delete' : action === 'content-update' ? 'aims.project-requirement-content-update' : action === 'content-delete' ? 'aims.project-requirement-content-delete' : 'aims.project-requirement-content-restore'
  await prepareEnterpriseRuntime(event, operation)
  return await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment, projectId, objectId, input: payload, projectScope,
    authorization: { ...authorization, objectId, subId: '' }
  }, { idempotencyKey: key })
}

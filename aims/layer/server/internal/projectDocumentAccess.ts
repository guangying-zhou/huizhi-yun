/**
 * 项目文档访问策略的单一事实源。
 *
 * 独立 Aims 路由与企业宿主的 service 端点都调用这里，区别只在 actor uid 的
 * 来源。策略判定（项目成员、项目经理）都在函数内部完成，两条路径不可能走岔。
 */
import { owningCreateError as createError, type OwningH3Event as H3Event } from '@hzy/foundation/server/utils/owningModuleHttp'
import {
  checkCodocsDocumentAccess,
  getCodocsDocumentAccessPolicy,
  listCodocsDocumentAccessAuditLogs,
  updateCodocsDocumentAccessPolicy
} from '../../../server/utils/codocsApi'
import { buildAccessSummary } from '../../../server/utils/projectDocumentAccessSummary'
import { hostProjectDocumentContext, hostDocumentOwner, hostDocumentWrite, documentActor, type DocumentReadPermitProvider } from './projectDocumentPorts'

export type DocumentAccessAction = 'view' | 'download' | 'edit'

export interface AccessPolicyBody {
  lifecycleStage: 'draft' | 'formal' | 'archived'
  confidentialityLevel: 'L0' | 'L1' | 'L2' | 'L3'
  defaultPermission: 'none' | 'view' | 'download'
  allowInternalAccess: boolean
  allowCrossProject: boolean
  grants: Array<{
    subjectType: 'project' | 'dept' | 'user' | 'role'
    subjectCode: string
    permission: 'view' | 'download' | 'edit'
    expiresAt?: string | null
  }>
}

export function normalizeDocumentAccessAction(value: unknown): DocumentAccessAction {
  const action = String(value || 'view').trim()
  if (action === 'view' || action === 'download' || action === 'edit') return action
  throw createError({ statusCode: 400, message: '无效的文档权限动作' })
}

function requireIds(projectId: number, documentId: number) {
  if (!projectId || Number.isNaN(projectId) || !documentId || Number.isNaN(documentId)) {
    throw createError({ statusCode: 400, message: '无效的项目或文档 ID' })
  }
}

/** GET .../access-policy */
export async function readProjectDocumentAccessPolicy(event: H3Event, provider: DocumentReadPermitProvider, projectId: number, documentId: number) {
  requireIds(projectId, documentId)
  const { uid } = await documentActor(event, 'view')
  const context = await hostProjectDocumentContext(event, provider, String(projectId), String(documentId))
  const policy = await getCodocsDocumentAccessPolicy({
    event,
    documentUuid: context.documentUuid!,
    documentRefType: context.documentRefType!,
    sourceProjectCode: context.projectCode,
    operatorUid: uid
  })
  return { code: 0, data: policy }
}

/** POST .../access-check —— 只做判定，不写审计以外的任何状态。 */
export async function checkProjectDocumentAccess(event: H3Event, provider: DocumentReadPermitProvider, projectId: number, documentId: number, action: DocumentAccessAction) {
  requireIds(projectId, documentId)
  const { uid } = await documentActor(event, 'view')
  const context = await hostProjectDocumentContext(event, provider, String(projectId), String(documentId))
  const result = await checkCodocsDocumentAccess({
    event,
    documentUuid: context.documentUuid!,
    documentRefType: context.documentRefType!,
    sourceProjectCode: context.projectCode,
    action,
    actorUid: uid,
    actorProjectCodes: context.actorProjectCodes,
    actorDeptCodes: context.actorDeptCodes,
    actorRoles: context.actorRoles
  })
  return { code: 0, data: result }
}

/** GET .../access-audit —— 仅项目成员可读。 */
export async function listProjectDocumentAccessAudit(event: H3Event, provider: DocumentReadPermitProvider, projectId: number, documentId: number, page: number, pageSize: number) {
  requireIds(projectId, documentId)
  await documentActor(event, 'view')
  const context = await hostProjectDocumentContext(event, provider, String(projectId), String(documentId))
  if (!context.isMember) throw createError({ statusCode: 403, message: '仅项目成员可查看访问审计' })
  const result = await listCodocsDocumentAccessAuditLogs({
    event,
    documentUuid: context.documentUuid!,
    documentRefType: context.documentRefType!,
    sourceProjectCode: context.projectCode,
    page: Math.max(1, Number(page) || 1),
    pageSize: Math.min(100, Math.max(1, Number(pageSize) || 20))
  })
  return { code: 0, data: result }
}

/** PUT .../access-policy —— 仅项目经理或负责人可改。 */
export async function updateProjectDocumentAccessPolicy(event: H3Event, provider: DocumentReadPermitProvider, projectId: number, documentId: number, body: AccessPolicyBody) {
  requireIds(projectId, documentId)
  const { uid } = await documentActor(event, 'view')
  await documentActor(event, 'edit')
  const owner = await hostDocumentOwner(event, {}, String(documentId))
  if (owner !== String(projectId)) throw createError({ statusCode: 403, message: '文档不属于当前项目' })
  const context = await hostProjectDocumentContext(event, provider, String(projectId), String(documentId))
  if (!context.isManager) throw createError({ statusCode: 403, message: '仅项目经理或负责人可修改访问策略' })
  // Managing the project's relation does not override the independent Codocs
  // ACL. Check the current document before changing its policy or Aims summary.
  const access = await checkCodocsDocumentAccess({
    event,
    documentUuid: context.documentUuid!,
    documentRefType: context.documentRefType!,
    sourceProjectCode: context.projectCode,
    action: 'edit',
    actorUid: uid,
    actorProjectCodes: context.actorProjectCodes,
    actorDeptCodes: context.actorDeptCodes,
    actorRoles: context.actorRoles
  })
  if (!access.allowed) throw createError({ statusCode: 403, message: '无当前文档的 Codocs 编辑权限' })
  if (!body?.lifecycleStage || !body?.confidentialityLevel || !body?.defaultPermission) {
    throw createError({ statusCode: 400, message: '缺少访问策略关键字段' })
  }

  const validSubjectTypes = new Set(['project', 'dept', 'user', 'role'])
  const validPermissions = new Set(['view', 'download', 'edit'])
  const grants = Array.isArray(body.grants)
    ? body.grants.filter((item) => {
        const subjectType = String(item?.subjectType || '').trim()
        const subjectCode = String(item?.subjectCode || '').trim()
        const permission = String(item?.permission || '').trim()
        return validSubjectTypes.has(subjectType) && Boolean(subjectCode) && validPermissions.has(permission)
      })
    : []

  const policy = await updateCodocsDocumentAccessPolicy({
    event,
    documentUuid: context.documentUuid!,
    documentRefType: context.documentRefType!,
    sourceProjectCode: context.projectCode,
    lifecycleStage: body.lifecycleStage,
    confidentialityLevel: body.confidentialityLevel,
    defaultPermission: body.defaultPermission,
    allowInternalAccess: Boolean(body.allowInternalAccess),
    allowCrossProject: Boolean(body.allowCrossProject),
    readonly: body.lifecycleStage === 'archived',
    grants,
    operatorUid: uid
  })

  const summary = buildAccessSummary({
    lifecycleStage: policy.lifecycleStage,
    confidentialityLevel: policy.confidentialityLevel,
    allowInternalAccess: policy.allowInternalAccess,
    allowCrossProject: policy.allowCrossProject,
    grantCount: Array.isArray(policy.grants) ? policy.grants.length : 0
  })

  await hostDocumentWrite(event, 'summary', context, {
    accessLifecycleStage: policy.lifecycleStage,
    accessConfidentialityLevel: policy.confidentialityLevel,
    accessSummary: summary
  }, String(documentId))

  return { code: 0, data: { ...policy, accessSummary: summary } }
}

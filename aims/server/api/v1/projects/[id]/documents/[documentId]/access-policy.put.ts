import { updateCodocsDocumentAccessPolicy } from '~~/server/utils/codocsApi'
import { buildAccessSummary, callAimsRuntime, getProjectDocumentContext } from '~~/server/utils/projectDocumentAccess'

interface AccessPolicyBody {
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

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  const documentId = Number(getRouterParam(event, 'documentId'))
  if (!projectId || Number.isNaN(projectId) || !documentId || Number.isNaN(documentId)) {
    throw createError({ statusCode: 400, message: '无效的项目或文档 ID' })
  }

  const context = await getProjectDocumentContext(event, projectId, documentId, uid)
  if (!context.isManager) {
    throw createError({ statusCode: 403, message: '仅项目经理或负责人可修改访问策略' })
  }

  const body = await readBody<AccessPolicyBody>(event)
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
    documentUuid: context.documentUuid,
    documentRefType: context.documentRefType,
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

  await callAimsRuntime(event, `/v1/aims/documents/${encodeURIComponent(String(documentId))}`, {
    method: 'PATCH',
    scope: 'aims.write',
    body: {
      accessLifecycleStage: policy.lifecycleStage,
      accessConfidentialityLevel: policy.confidentialityLevel,
      accessSummary: summary,
      operator_uid: uid,
      current_user: uid
    }
  })

  return {
    code: 0,
    data: {
      ...policy,
      accessSummary: summary
    }
  }
})

import { getQuery } from 'h3'
import { signCollaborationToken } from '~~/server/utils/collaborationAuth'
import { resolveCodocsCollaborationContext } from '~~/server/utils/codocsRuntime'
import { getRequestDisplayName, requireRequestUid } from '~~/server/utils/authIdentity'
import { requireDepartmentReadAccess } from '~~/server/utils/departmentAccess'

const DOCUMENT_NAME_PATTERN = /^doc:([0-9a-fA-F-]{36})$/
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12

export default defineEventHandler(async (event) => {
  const actorUid = requireRequestUid(event)
  const actorName = getRequestDisplayName(event)
  const query = getQuery(event)
  const documentName = String(query.documentName || '').trim()
  const departmentReadDeptCode = String(query.dept_code || query.deptCode || '').trim()
  const match = DOCUMENT_NAME_PATTERN.exec(documentName)

  if (!match?.[1]) {
    throw createError({
      statusCode: 400,
      message: '无效的协同文档标识'
    })
  }

  if (departmentReadDeptCode) {
    await requireDepartmentReadAccess(event, actorUid, departmentReadDeptCode)
  }

  const context = await resolveCodocsCollaborationContext(event, {
    documentName,
    actorUid,
    actorName,
    deptCode: departmentReadDeptCode
  })

  if (!context.handled) {
    throw createError({
      statusCode: 503,
      message: 'Codocs tenant-runtime is required for collaboration context.'
    })
  }

  const now = Date.now()

  return {
    success: true,
    data: {
      token: signCollaborationToken({
        uid: actorUid,
        name: actorName,
        documentName,
        issuedAt: now,
        expiresAt: now + TOKEN_TTL_MS,
        document: {
          docId: context.data.docId,
          docUuid: context.data.docUuid,
          docType: context.data.docType,
          ossPath: context.data.ossPath,
          ownerUid: context.data.ownerUid,
          sharePermission: context.data.sharePermission,
          readonly: context.data.readonly
        }
      }),
      expiresAt: now + TOKEN_TTL_MS
    }
  }
})

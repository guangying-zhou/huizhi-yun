/**
 * 删除文档 API（移至回收站）
 * DELETE /api/documents/:uuid
 */

import { requireDepartmentManagerAccess } from '~~/server/utils/departmentAccess'
import { getCodocsDocumentMetadata, callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { moveToRecycleBin } from '~~/server/utils/oss'
import { requireRequestUid } from '~~/server/utils/authIdentity'

export default defineEventHandler(async (event) => {
  try {
    const uuid = getRouterParam(event, 'uuid')

    if (!uuid) {
      throw createError({
        statusCode: 400,
        message: '文档UUID不能为空'
      })
    }

    const actorUid = requireRequestUid(event)
    const doc = await getCodocsDocumentMetadata(event, uuid, { actorUid })

    if (doc.doc_type === 'department' && doc.dept_code) {
      await requireDepartmentManagerAccess(actorUid, doc.dept_code, '仅部门经理可删除部门文档')
    } else if (doc.readonly) {
      throw createError({
        statusCode: 403,
        message: doc.readonly_flag === 1 ? '当前文档为只读状态，无法删除' : '当前文档为只读共享，无法删除'
      })
    }

    let recyclePath = doc.oss_path || ''
    if (doc.oss_path) {
      recyclePath = doc.oss_path.replace(/^codocs\//, 'recycle.bin/')
      try {
        await moveToRecycleBin(doc.oss_path, doc.doc_type)
      } catch (ossError) {
        console.error('Failed to move OSS file to recycle bin:', ossError)
        recyclePath = doc.oss_path
      }
    }

    const data = await callCodocsTenantRuntime<{ uuid: string, deleted: boolean }>(
      event,
      `/v1/codocs/documents/${encodeURIComponent(uuid)}`,
      {
        method: 'DELETE',
        scope: 'codocs.write',
        body: {
          actorUid,
          serverAuthorized: true,
          recyclePath
        }
      }
    )

    return {
      success: true,
      data
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    console.error('Failed to delete document:', error)
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.message || '删除文档失败'
    })
  }
})

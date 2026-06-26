/**
 * 创建文档 API
 * POST /api/documents
 */

import { requireDepartmentWriteAccess } from '../../utils/departmentAccess'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { createCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import { uploadDocument } from '~~/server/utils/oss'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { title, content, doc_type, owner_uid, dept_code, project_code, folder_id } = body
    const operatorUid = requireRequestUid(event)
    const normalizedContent = typeof content === 'string' ? content : ''

    if (doc_type === 'department') {
      if (!dept_code) {
        throw createError({
          statusCode: 400,
          message: '创建部门文档时必须指定 dept_code'
        })
      }

      await requireDepartmentWriteAccess(operatorUid, String(dept_code))
    }

    const doc = await createCodocsDocumentMetadata(event, {
      title,
      docType: doc_type,
      ownerUid: owner_uid || operatorUid,
      operatorUid,
      deptCode: dept_code,
      projectCode: project_code,
      folderId: folder_id,
      contentSize: Buffer.byteLength(normalizedContent, 'utf-8')
    })

    if (doc.oss_path) {
      await uploadDocument(doc.oss_path, normalizedContent, doc.doc_type)
    }

    return {
      success: true,
      data: doc
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    console.error('Failed to create document:', error)
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.message || '创建文档失败'
    })
  }
})

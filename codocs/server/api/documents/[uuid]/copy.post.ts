/**
 * 复制文档
 * POST /api/documents/:uuid/copy
 */
import { downloadDocument, uploadDocument } from '../../../utils/oss'
import { requireDepartmentWriteAccess } from '../../../utils/departmentAccess'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { createCodocsDocumentMetadata, getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'

interface DocumentCopySourceRow {
  title: string
  doc_type: string
  oss_path: string
  owner_uid: string
  dept_code: string | null
  project_code: string | null
  folder_id: number | null
  content_size: number | null
  status: number
  readonly_flag: number
  publish_info: string | null
  sharePermission?: 'read' | 'write' | null
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

const isPublishedDepartmentDocument = (doc: DocumentCopySourceRow) => {
  return doc.doc_type === 'department'
    && Boolean(doc.dept_code)
    && (doc.status === 2 || Boolean(doc.publish_info))
}

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')

  const uuid = getRouterParam(event, 'uuid')
  if (!uuid) {
    throw createError({ statusCode: 400, message: '缺少文档UUID' })
  }

  const body = await readBody(event)
  const { title } = body

  if (!title || !title.trim()) {
    throw createError({ statusCode: 400, message: '文件名不能为空' })
  }

  try {
    const doc = await getCodocsDocumentMetadata(event, uuid, { actorUid: uid }) as DocumentCopySourceRow

    if (isPublishedDepartmentDocument(doc)) {
      await requireDepartmentWriteAccess(uid, String(doc.dept_code))
    } else if (doc.owner_uid !== uid && doc.sharePermission !== 'write') {
      throw createError({
        statusCode: 403,
        message: doc.readonly_flag === 1
          ? '当前文档为只读状态，无法编辑'
          : '当前文档为只读共享，无法编辑'
      })
    }

    // 2. 复制 OSS 文件
    const content = await downloadDocument(doc.oss_path, doc.doc_type)
    if (!content) {
      throw createError({ statusCode: 404, message: '文档内容不存在' })
    }

    const copied = await createCodocsDocumentMetadata(event, {
      title: title.trim(),
      docType: doc.doc_type,
      ownerUid: uid,
      operatorUid: uid,
      deptCode: doc.dept_code || null,
      projectCode: doc.project_code || null,
      folderId: doc.folder_id || null,
      contentSize: Buffer.byteLength(content, 'utf-8')
    })

    if (copied.oss_path) {
      await uploadDocument(copied.oss_path, content, copied.doc_type)
    }

    return {
      success: true,
      data: {
        uuid: copied.uuid,
        title: title.trim()
      }
    }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) throw error
    console.error('[Documents] Failed to copy document:', error)
    throw createError({
      statusCode: 500,
      message: getErrorMessage(error, '复制文档失败')
    })
  }
})

import { getCookie } from 'h3'
import { requireDepartmentWriteAccess } from '../../utils/departmentAccess'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { createCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import { uploadDocument } from '~~/server/utils/oss'

export default defineEventHandler(async (event) => {
  try {
    const multipart = await readMultipartFormData(event)
    const sessionId = getCookie(event, 'token') || null
    if (!multipart) {
      throw createError({
        statusCode: 400,
        message: '没有上传文件'
      })
    }

    const docType = multipart.find(x => x.name === 'doc_type')?.data.toString() || 'private'
    const ownerUid = multipart.find(x => x.name === 'owner_uid')?.data.toString()
    const operatorUid = requireRequestUid(event)
    const folderIdStr = multipart.find(x => x.name === 'folder_id')?.data.toString()
    const parsedFolderId = folderIdStr && folderIdStr !== 'null' ? parseInt(folderIdStr) : 0
    const folderId = Number.isFinite(parsedFolderId) && parsedFolderId > 0 ? parsedFolderId : null
    const deptCodeStr = multipart.find(x => x.name === 'dept_code')?.data.toString()
    const deptCode = deptCodeStr || null
    const projectCodeStr = multipart.find(x => x.name === 'project_code')?.data.toString()
    const projectCode = projectCodeStr || null

    console.log('[Upload] Received request:', {
      docType,
      ownerUid,
      folderId,
      projectCode,
      filesCount: multipart.filter(x => x.filename).length
    })

    if (docType === 'department') {
      if (!deptCode) {
        throw createError({
          statusCode: 400,
          message: '上传部门文档时必须指定 dept_code'
        })
      }

      await requireDepartmentWriteAccess(operatorUid, deptCode)
    }

    const results = {
      success: 0,
      failed: 0,
      items: [] as ({ filename: string, status: string, id?: number, message?: string })[]
    }

    const files = multipart.filter(x => x.filename && x.filename.toLowerCase().endsWith('.md'))

    if (files.length === 0) {
      throw createError({
        statusCode: 400,
        message: '请选择 .md 文件'
      })
    }

    for (const file of files) {
      const filename = file.filename || 'Untitled.md'
      const title = filename.replace(/\.md$/i, '')
      const content = file.data.toString('utf-8')

      try {
        const doc = await createCodocsDocumentMetadata(event, {
          title,
          docType,
          ownerUid: ownerUid || operatorUid,
          operatorUid,
          folderId,
          deptCode,
          projectCode,
          contentSize: Buffer.byteLength(content, 'utf-8')
        })
        if (doc.oss_path) {
          await uploadDocument(doc.oss_path, content, doc.doc_type)
        }
        await reportOperationAudit({
          sourceApp: 'codocs',
          sessionId,
          operatorUid,
          action: 'document.upload',
          targetType: 'document',
          targetId: doc.id,
          detail: {
            uuid: doc.uuid,
            title,
            docType,
            ownerUid: ownerUid || operatorUid,
            deptCode,
            projectCode,
            folderId
          }
        })
        results.success++
        results.items.push({ filename, status: 'success', id: doc.id })
      } catch (err: unknown) {
        results.failed++
        const error = err as { message?: string }
        const errorMsg = error.message || 'Unknown error'
        console.error(`[Upload] Failed to process file ${filename}:`, err)
        results.items.push({ filename, status: 'error', message: errorMsg })
      }
    }

    return results
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    console.error('Upload failed:', error)
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.message || '上传文件失败'
    })
  }
})

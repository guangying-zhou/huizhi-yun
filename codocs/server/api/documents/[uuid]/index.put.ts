/**
 * 更新文档 API
 * PUT /api/documents/:id
 */

import { uploadDocument } from '~~/server/utils/oss'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { createCodocsDocumentVersion, getCodocsDocumentMetadata, updateCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  try {
    const uuid = getRouterParam(event, 'uuid')
    const body = await readBody(event)
    const { title, content, saveMode } = body as {
      title?: string
      content?: string
      saveMode?: 'metadata' | 'overwrite' | 'recovery' | 'import'
    }
    const actorUid = requireRequestUid(event)
    const sessionId = getCookie(event, 'token') || null

    if (!uuid) {
      throw createError({
        statusCode: 400,
        message: '文档UUID不能为空'
      })
    }

    const doc = await getCodocsDocumentMetadata(event, uuid, { actorUid })
    if (doc.readonly) {
      throw createError({
        statusCode: 403,
        message: doc.readonly_flag === 1 ? '当前文档为只读状态，无法编辑' : '当前文档为只读共享，无法编辑'
      })
    }

    // 更新数据库记录
    const updateBody: Record<string, unknown> = {
      actorUid,
      serverAuthorized: true
    }
    const normalizedSaveMode = String(saveMode || (content !== undefined ? 'overwrite' : 'metadata'))
    let uploadVersionId = ''
    let contentSize = 0

    if (
      content !== undefined
      && !['overwrite', 'recovery', 'import'].includes(normalizedSaveMode)
    ) {
      throw createError({
        statusCode: 400,
        message: '当前保存模式不允许直接覆盖文档内容'
      })
    }

    if (title !== undefined) {
      updateBody.title = title
    }

    if (content !== undefined) {
      contentSize = Buffer.from(content, 'utf-8').length
      updateBody.contentSize = contentSize

      // 上传新内容到 OSS（保留上传结果用于版本记录）
      if (doc.oss_path) {
        const uploadResult = await uploadDocument(doc.oss_path, content, doc.doc_type)
        uploadVersionId = uploadResult.versionId || ''
      }
    }

    if (actorUid) {
      updateBody.lastEditorUid = actorUid
    }

    await updateCodocsDocumentMetadata(event, uuid, updateBody)

    // 创建版本记录
    if (content !== undefined && doc.oss_path) {
      await createCodocsDocumentVersion(event, uuid, {
        actorUid,
        editorUid: actorUid,
        ossVersionId: uploadVersionId,
        contentSize
      })
    }

    if (actorUid) {
      await reportOperationAudit({
        sourceApp: 'codocs',
        sessionId,
        operatorUid: actorUid,
        action: 'document.update',
        targetType: 'document',
        targetId: doc.id,
        detail: {
          uuid,
          title: title || doc.title,
          contentUpdated: content !== undefined,
          editorUid: actorUid,
          saveMode: normalizedSaveMode
        }
      })
    }

    return {
      success: true,
      data: {
        uuid,
        updated: true
      }
    }
  } catch (error: unknown) {
    console.error('Failed to update document:', error)
    const err = error as Record<string, unknown>
    throw createError({
      statusCode: (err.statusCode as number) || 500,
      message: (err.message as string) || '更新文档失败'
    })
  }
})

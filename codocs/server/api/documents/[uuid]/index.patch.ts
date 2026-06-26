/**
 * 更新文档 API
 * PATCH /api/documents/:id
 */

import type { H3Event } from 'h3'
import { requireDepartmentManagerAccess } from '~~/server/utils/departmentAccess'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime, getCodocsDocumentMetadata, updateCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import { getDocumentPath, renameDocument } from '~~/server/utils/oss'

interface FolderRuntimeRow {
  id: number
  name: string
  parent_id: number | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function numberOrNull(value: unknown) {
  if (value === undefined || value === null || value === '' || value === 'null') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function isChangedFolder(next: unknown, current: unknown) {
  return numberOrNull(next) !== numberOrNull(current)
}

async function resolveFolderPath(event: H3Event, folderId: number | null): Promise<string> {
  if (!folderId) return ''

  const folder = await callCodocsTenantRuntime<FolderRuntimeRow>(event, `/v1/codocs/folders/${folderId}`, {
    scope: 'codocs.read'
  })
  const name = stringValue(folder.name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')

  if (folder.parent_id) {
    const parentPath = await resolveFolderPath(event, Number(folder.parent_id))
    return parentPath ? `${parentPath}/${name}` : name
  }

  return name
}

export default defineEventHandler(async (event) => {
  try {
    const uuid = getRouterParam(event, 'uuid')
    const body = await readBody<Record<string, unknown>>(event)

    if (!uuid) {
      throw createError({
        statusCode: 400,
        message: '文档UUID不能为空'
      })
    }

    const actorUid = requireRequestUid(event)
    const doc = await getCodocsDocumentMetadata(event, uuid, { actorUid })
    const requiresContentWriteAccess = body.title !== undefined
      || body.folder_id !== undefined
      || body.star_flag !== undefined
      || body.home_flag !== undefined
      || body.doc_type !== undefined
      || body.dept_code !== undefined

    if (body.readonly_flag !== undefined) {
      if (doc.doc_type === 'department' && doc.dept_code) {
        await requireDepartmentManagerAccess(actorUid, doc.dept_code, '仅部门经理可修改部门文档只读状态')
      } else if (actorUid !== doc.owner_uid) {
        throw createError({ statusCode: 403, message: '仅文档所有者可修改只读状态' })
      }
    }

    if (requiresContentWriteAccess && doc.readonly) {
      throw createError({
        statusCode: 403,
        message: doc.readonly_flag === 1 ? '当前文档为只读状态，无法编辑' : '当前文档为只读共享，无法编辑'
      })
    }

    const updateBody: Record<string, unknown> = {
      ...body,
      actorUid,
      serverAuthorized: true
    }
    const targetFolderId = body.folder_id !== undefined ? numberOrNull(body.folder_id) : numberOrNull(doc.folder_id)
    const targetTitle = body.title !== undefined ? stringValue(body.title) : doc.title

    // 标题是业务元数据，不再驱动物理 OSS 路径变化；只有移动文件夹时才移动对象路径。
    if (body.folder_id !== undefined && isChangedFolder(body.folder_id, doc.folder_id)) {
      const folderPath = await resolveFolderPath(event, targetFolderId)
      const newOssPath = getDocumentPath(
        doc.doc_type,
        doc.owner_uid,
        doc.project_code || '',
        doc.dept_code || '',
        targetTitle,
        folderPath || undefined
      )

      if (doc.oss_path && newOssPath !== doc.oss_path) {
        await renameDocument(doc.oss_path, newOssPath, doc.doc_type)
        updateBody.ossPath = newOssPath
      }
    }

    const data = await updateCodocsDocumentMetadata(event, uuid, updateBody)

    return {
      success: true,
      data: {
        uuid,
        updated: data.updated !== false
      }
    }
  } catch (error: unknown) {
    const err = error as { statusCode?: number, message?: string }
    console.error('Failed to update document:', error)
    throw createError({
      statusCode: err.statusCode || 500,
      message: err.message || '更新文档失败'
    })
  }
})

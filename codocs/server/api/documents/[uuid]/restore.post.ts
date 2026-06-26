/**
 * 恢复已删除文档 API
 * POST /api/documents/:uuid/restore
 * Body: { new_title?: string } - 可选的新标题（用于文件名冲突时）
 */

import type { H3Event } from 'h3'
import { requireDepartmentManagerAccess } from '~~/server/utils/departmentAccess'
import { callCodocsTenantRuntime, getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import { moveOSSFile, getDocumentPath } from '~~/server/utils/oss'
import { requireRequestUid } from '~~/server/utils/authIdentity'

interface FolderRuntimeRow {
  id: number
  name: string
  parent_id: number | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

async function resolveFolderPath(event: H3Event, folderId: number | null | undefined): Promise<string> {
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
    if (!uuid) {
      throw createError({ statusCode: 400, message: '文档UUID不能为空' })
    }

    const body = await readBody<Record<string, unknown>>(event)
    const newTitle = stringValue(body?.new_title)
    const actorUid = requireRequestUid(event)
    const doc = await getCodocsDocumentMetadata(event, uuid, {
      actorUid,
      include_deleted: '1'
    })

    if (doc.status !== 0) {
      throw createError({ statusCode: 400, message: '文档不存在或未处于删除状态' })
    }

    if (doc.doc_type === 'department' && doc.dept_code) {
      await requireDepartmentManagerAccess(actorUid, doc.dept_code, '仅部门经理可恢复已删除文档')
    } else if (doc.readonly) {
      throw createError({ statusCode: 403, message: '无权恢复该文档' })
    }

    const recyclePath = doc.oss_path || ''
    const originalOssPath = recyclePath.replace(/^recycle\.bin\//, 'codocs/')
    let finalOssPath = originalOssPath
    let finalTitle = doc.title

    if (newTitle && newTitle !== doc.title) {
      finalTitle = newTitle
      const folderPath = await resolveFolderPath(event, doc.folder_id)
      finalOssPath = getDocumentPath(
        doc.doc_type,
        doc.owner_uid,
        doc.project_code || '',
        doc.dept_code || '',
        newTitle,
        folderPath || undefined
      )
    }

    if (recyclePath) {
      await moveOSSFile(recyclePath, finalOssPath, doc.doc_type)
    }

    const data = await callCodocsTenantRuntime<{ uuid: string, title: string, restored: boolean }>(
      event,
      `/v1/codocs/documents/${encodeURIComponent(uuid)}/restore`,
      {
        method: 'POST',
        scope: 'codocs.write',
        body: {
          actorUid,
          serverAuthorized: true,
          title: finalTitle,
          ossPath: finalOssPath
        }
      }
    )

    return {
      success: true,
      data
    }
  } catch (error: unknown) {
    console.error('Failed to restore document:', error)
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : '恢复文档失败'
    throw createError({
      statusCode,
      message
    })
  }
})

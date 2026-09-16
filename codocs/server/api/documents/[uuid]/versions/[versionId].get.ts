/**
 * 获取指定版本的文档内容
 * GET /api/documents/:uuid/versions/:versionId
 */

import { createOSSClient, createProjectsOSSClient } from '../../../../utils/oss'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { getCodocsDocumentMetadata, callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface DocumentRow {
  oss_path: string | null
  doc_type: string
}

interface VersionRow {
  oss_version_id: string | null
  version_num: number
  editor_uid: string | null
  created_at: string
}

export default defineEventHandler(async (event) => {
  try {
    const uuid = getRouterParam(event, 'uuid')
    const versionId = getRouterParam(event, 'versionId')

    if (!uuid || !versionId) {
      throw createError({
        statusCode: 400,
        message: '参数不完整'
      })
    }

    const actorUid = requireRequestUid(event)
    const doc = await getCodocsDocumentMetadata(event, uuid, { actorUid }) as DocumentRow
    const page = await callCodocsTenantRuntime<{ items?: (VersionRow & { id: number })[] }>(event, `/v1/codocs/documents/${encodeURIComponent(uuid)}/versions`, {
      scope: 'codocs.read'
    })
    const version = (page.items || []).find(item => String(item.id) === String(versionId))
    if (!version) {
      throw createError({
        statusCode: 404,
        message: '版本不存在'
      })
    }

    if (!doc.oss_path || !version.oss_version_id) {
      throw createError({
        statusCode: 400,
        message: '版本数据不完整，该版本可能是在开启 OSS 版本控制之前创建的'
      })
    }

    // 通过 OSS versionId 获取历史版本内容
    const useProjectsBucket = doc.doc_type === 'git-project'
    const client = useProjectsBucket ? createProjectsOSSClient() : createOSSClient()

    const result = await client.get(doc.oss_path, {
      versionId: version.oss_version_id
    })

    const content = result.content.toString('utf-8')

    return {
      success: true,
      data: {
        content,
        versionNum: version.version_num,
        editorUid: version.editor_uid,
        createdAt: version.created_at
      }
    }
  } catch (error: unknown) {
    console.error('Failed to get version content:', error)
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : '获取版本内容失败'
    throw createError({
      statusCode,
      message
    })
  }
})

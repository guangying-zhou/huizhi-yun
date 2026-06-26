/**
 * 获取文档版本历史
 * GET /api/documents/:uuid/versions
 */

import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { fetchDirectoryResponse } from '~~/server/utils/directoryCompat'

interface VersionRow {
  id: number
  version_num: number
  oss_version_id: string
  editor_uid: string | null
  content_size: number
  created_at: string
}

interface AccountUser {
  uid: string
  realName: string | null
}

const resolveEditorNames = async (uids: string[]): Promise<Record<string, string>> => {
  const unique = [...new Set(uids.filter(Boolean))]
  if (unique.length === 0) return {}

  try {
    const response = await fetchDirectoryResponse<AccountUser[]>('/users/batch', {
      method: 'POST',
      body: { uids: unique }
    })
    const users = response.data || []
    return users.reduce<Record<string, string>>((acc, u) => {
      if (u.uid && u.realName) acc[u.uid] = u.realName
      return acc
    }, {})
  } catch (error) {
    console.error('Failed to fetch editor names from Console Directory:', error)
    return {}
  }
}

export default defineEventHandler(async (event) => {
  try {
    const uuid = getRouterParam(event, 'uuid')

    if (!uuid) {
      throw createError({
        statusCode: 400,
        message: '文档 UUID 不能为空'
      })
    }

    const page = await callCodocsTenantRuntime<{ items?: VersionRow[] }>(event, `/v1/codocs/documents/${encodeURIComponent(uuid)}/versions`, {
      scope: 'codocs.read'
    })
    const rows = page.items || []
    const nameMap = await resolveEditorNames(rows.map(v => v.editor_uid || ''))

    const versions = rows.map(v => ({
      id: v.id,
      versionNum: v.version_num,
      ossVersionId: v.oss_version_id,
      editorUid: v.editor_uid,
      editorName: (v.editor_uid && nameMap[v.editor_uid]) || v.editor_uid || '未知用户',
      editorAvatar: null,
      contentSize: v.content_size,
      createdAt: v.created_at
    }))

    return {
      success: true,
      data: versions
    }
  } catch (error: unknown) {
    console.error('Failed to get document versions:', error)
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode) || 500
      : 500
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : '获取版本历史失败'
    throw createError({
      statusCode,
      message
    })
  }
})

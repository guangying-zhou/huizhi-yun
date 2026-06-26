import { createError, getRouterParam } from 'h3'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { downloadDocument } from '~~/server/utils/oss'
import { rewriteCurrentAppAssetUrls, withCurrentAppBase } from '~~/server/utils/appPath'
import { getRequestDisplayName, getRequestUid } from '~~/server/utils/authIdentity'

interface ViewerEntry {
  uid: string
  realName: string
}

interface InfoItem {
  id: number
  oss_path?: string | null
  cover_image?: string | null
  viewers?: ViewerEntry[]
  view_count?: number
  [key: string]: unknown
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '缺少资讯 ID' })
  }

  const item = await callCodocsTenantRuntime<InfoItem>(event, `/v1/codocs/info/items/${encodeURIComponent(id)}`, {
    query: {
      actorUid: getRequestUid(event),
      actorName: getRequestDisplayName(event)
    },
    scope: 'codocs.read'
  })

  let content = ''
  if (item.oss_path) {
    try {
      content = await downloadDocument(item.oss_path) || ''
    } catch (error: unknown) {
      const errorCode = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : ''
      if (errorCode === 'NoSuchKey') {
        throw createError({ statusCode: 404, message: '资讯内容文件不存在' })
      }
      throw error
    }
  }

  const frontmatterRegex = /^---\n[\s\S]*?\n---\n/
  return {
    success: true,
    data: {
      ...item,
      cover_image: withCurrentAppBase(event, item.cover_image),
      content: rewriteCurrentAppAssetUrls(event, content.replace(frontmatterRegex, '')).trim()
    }
  }
})

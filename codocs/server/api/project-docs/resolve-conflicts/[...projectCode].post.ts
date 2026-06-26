/**
 * 解决项目文档冲突。
 * 只处理项目 OSS 文件与元数据；Codocs server 不直连数据库。
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { createProjectsOSSClient } from '~~/server/utils/oss'

type OSSUserMeta = Record<string, string | number>

interface ResolveDocItem {
  oss_path?: string
  use_gitlab?: boolean
  delete?: boolean
}

const tempPathsFor = (projectCode: string, ossPath: string) => {
  const parts = ossPath.split('/')
  let projectPathFromOss: string
  let relativePath: string
  if (parts.length >= 3) {
    projectPathFromOss = `${parts[0] ?? ''}/${parts[1] ?? ''}`
    relativePath = parts.slice(2).join('/')
  } else if (parts.length === 2) {
    projectPathFromOss = parts[0] ?? projectCode
    relativePath = parts[1] ?? ''
  } else {
    projectPathFromOss = projectCode
    relativePath = parts[0] ?? ''
  }
  const tempPath = `${projectPathFromOss}/temp/${relativePath}`
  return { tempPath, diffPath: `${tempPath}.diff` }
}

export default defineEventHandler(async (event) => {
  const rawProjectCode = getRouterParam(event, 'projectCode')
  if (!rawProjectCode) {
    throw createError({ statusCode: 400, message: '缺少项目ID' })
  }

  requireRequestUid(event, '未登录或会话已过期')
  const projectCode = decodeURIComponent(rawProjectCode)
  const body = await readBody<{ docs?: ResolveDocItem[] }>(event)
  const docs = body.docs || []
  if (!Array.isArray(docs) || docs.length === 0) {
    throw createError({ statusCode: 400, message: '缺少 docs 参数或格式错误' })
  }

  const client = createProjectsOSSClient()
  const results: Array<Record<string, unknown>> = []

  for (const doc of docs) {
    const ossPath = String(doc.oss_path || '').trim()
    if (!ossPath) continue

    try {
      if (doc.delete) {
        await client.delete(ossPath)
        results.push({ oss_path: ossPath, action: 'deleted', success: true })
        continue
      }

      const currentMeta = await client.head(ossPath)
      const latestCommitId = currentMeta.meta?.['gitlab-latest-commit-id']
      const latestSize = currentMeta.meta?.['gitlab-latest-size']
      const headers = currentMeta.res.headers as Record<string, string | undefined>
      if (!latestCommitId) {
        throw new Error('文件没有冲突信息')
      }

      const { tempPath, diffPath } = tempPathsFor(projectCode, ossPath)
      let contentSize = parseInt(headers['content-length'] || '0', 10)
      let lastModified = headers['last-modified'] || ''
      let action = 'ignore'

      if (doc.use_gitlab) {
        await client.copy(ossPath, tempPath)
        const newMeta = await client.head(ossPath)
        const newHeaders = newMeta.res.headers as Record<string, string | undefined>
        contentSize = parseInt(newHeaders['content-length'] || '0', 10)
        lastModified = newHeaders['last-modified'] || ''
        action = 'use_gitlab'
      }

      await client.putMeta(ossPath, {
        'gitlab-commit-id': latestCommitId,
        'gitlab-latest-commit-id': latestCommitId,
        'gitlab-latest-size': doc.use_gitlab ? String(contentSize) : (latestSize || '0'),
        'synced-last-modified': lastModified,
        'synced-at': new Date().toISOString(),
        'conflict-status': '0'
      } as OSSUserMeta, {})

      try {
        await client.delete(tempPath)
        await client.delete(diffPath)
      } catch (error) {
        console.warn('[ResolveConflicts] Failed to delete temp files:', error)
      }

      results.push({
        oss_path: ossPath,
        action,
        success: true,
        content_size: contentSize
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[ResolveConflicts] Failed to process ${ossPath}:`, error)
      results.push({ oss_path: ossPath, success: false, error: message })
    }
  }

  return {
    code: 0,
    message: 'success',
    data: { docs: results }
  }
})

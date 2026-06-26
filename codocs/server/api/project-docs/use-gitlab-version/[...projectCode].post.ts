/**
 * 使用 GitLab 版本覆盖项目文档。
 * 只处理项目 OSS 文件与元数据；Codocs server 不直连数据库。
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { createProjectsOSSClient } from '~~/server/utils/oss'

type OSSUserMeta = Record<string, string | number>

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
  const body = await readBody<{ oss_path?: string }>(event)
  const ossPath = String(body.oss_path || '').trim()
  if (!ossPath) {
    throw createError({ statusCode: 400, message: '缺少 oss_path 参数' })
  }

  const client = createProjectsOSSClient()
  const currentMeta = await client.head(ossPath)
  const latestCommitId = currentMeta.meta?.['gitlab-latest-commit-id']
  if (!latestCommitId) {
    throw createError({ statusCode: 400, message: '文件没有冲突信息' })
  }

  const { tempPath, diffPath } = tempPathsFor(projectCode, ossPath)
  await client.head(tempPath)
  await client.copy(ossPath, tempPath)

  const newMeta = await client.head(ossPath)
  const headers = newMeta.res.headers as Record<string, string | undefined>
  const contentSize = parseInt(headers['content-length'] || '0', 10)
  const lastModified = headers['last-modified'] || ''

  await client.putMeta(ossPath, {
    'gitlab-commit-id': latestCommitId,
    'gitlab-latest-commit-id': latestCommitId,
    'gitlab-latest-size': String(contentSize),
    'synced-last-modified': lastModified,
    'synced-at': new Date().toISOString(),
    'conflict-status': '0'
  } as OSSUserMeta, {})

  try {
    await client.delete(tempPath)
    await client.delete(diffPath)
  } catch (error) {
    console.warn('[UseGitLabVersion] Failed to delete temp files:', error)
  }

  return {
    code: 0,
    message: 'success',
    data: {
      oss_path: ossPath,
      content_size: contentSize,
      conflict_status: '0'
    }
  }
})

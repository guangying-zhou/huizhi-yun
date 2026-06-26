/**
 * 忽略文档冲突
 * POST /api/project-docs/:projectCode/ignore-conflict
 *
 * 本地实现（不调用 Account API）
 */

import { createProjectsOSSClient } from '../../../utils/oss'
import { requireRequestUid } from '~~/server/utils/authIdentity'

type OSSUserMeta = Record<string, string | number>

export default defineEventHandler(async (event) => {
  const rawProjectCode = getRouterParam(event, 'projectCode')

  if (!rawProjectCode) {
    throw createError({
      statusCode: 400,
      message: '缺少项目ID'
    })
  }

  const projectCode = decodeURIComponent(rawProjectCode)

  try {
    requireRequestUid(event, '未登录或会话已过期')

    const body = await readBody(event)
    const { oss_path } = body

    if (!oss_path) {
      throw createError({
        statusCode: 400,
        message: '缺少 oss_path 参数'
      })
    }

    // 项目文档使用专用的 OSS Bucket
    const client = createProjectsOSSClient()

    // 1. 读取当前 OSS 文件元数据
    const currentMeta = await client.head(oss_path)
    const headers = currentMeta.res.headers as Record<string, string | undefined>
    const gitlabLatestCommitId = currentMeta.meta?.['gitlab-latest-commit-id']
    const gitlabLatestSize = currentMeta.meta?.['gitlab-latest-size']
    const currentLastModified = headers['last-modified'] ?? ''

    if (!gitlabLatestCommitId) {
      throw createError({
        statusCode: 400,
        message: '文件没有冲突信息'
      })
    }

    // 2. 计算 temp 文件路径
    // Account API 存储格式: {gitlabProjectPath}/temp/{relativePath}
    const pathSegments = oss_path.split('/')

    let projectPathFromOss: string
    let relativePath: string
    if (pathSegments.length >= 3) {
      projectPathFromOss = `${pathSegments[0] ?? ''}/${pathSegments[1] ?? ''}`
      relativePath = pathSegments.slice(2).join('/')
    } else if (pathSegments.length === 2) {
      projectPathFromOss = pathSegments[0] ?? projectCode
      relativePath = pathSegments[1] ?? ''
    } else {
      projectPathFromOss = projectCode
      relativePath = pathSegments[0] ?? ''
    }

    const tempPath = `${projectPathFromOss}/temp/${relativePath}`
    const diffPath = `${tempPath}.diff`

    // 3. OSS 文件保持不变，只更新元数据
    // 标记为已忽略：gitlab-commit-id = gitlab-latest-commit-id
    await client.putMeta(oss_path, {
      'gitlab-commit-id': gitlabLatestCommitId,
      'gitlab-latest-commit-id': gitlabLatestCommitId,
      'gitlab-latest-size': gitlabLatestSize || '0',
      'synced-last-modified': currentLastModified,
      'synced-at': new Date().toISOString(),
      'conflict-status': '0'
    } as OSSUserMeta, {})
    console.log(`[IgnoreConflict] Updated metadata for ${oss_path}`)

    // 4. 删除 temp/{file} 和 temp/{file}.diff
    try {
      await client.delete(tempPath)
      console.log(`[IgnoreConflict] Deleted temp file: ${tempPath}`)
    } catch (e) {
      console.warn(
        `[IgnoreConflict] Failed to delete temp file: ${tempPath}`,
        e
      )
    }

    try {
      await client.delete(diffPath)
      console.log(`[IgnoreConflict] Deleted diff file: ${diffPath}`)
    } catch (e) {
      console.warn(
        `[IgnoreConflict] Failed to delete diff file: ${diffPath}`,
        e
      )
    }

    return {
      code: 0,
      message: 'Conflict ignored successfully',
      data: {
        oss_path,
        conflict_status: '0'
      }
    }
  } catch (err: unknown) {
    console.error('Failed to ignore conflict:', err)
    const error = err as { statusCode?: number, message?: string }

    if (error.statusCode) {
      throw err
    }

    throw createError({
      statusCode: 500,
      message: error.message || '操作失败'
    })
  }
})

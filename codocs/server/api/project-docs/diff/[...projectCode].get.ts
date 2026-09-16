import type { Project } from '~~/app/types/account'
import { createProjectsOSSClient } from '../../../utils/oss'
import { extractGitProjectPath } from '@hzy/foundation/server/utils/gitIntegration'
import { fetchDirectoryResponse } from '~~/server/utils/directoryCompat'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  requireRequestUid(event)
  await requirePermission(event, 'projects', 'view', '缺少项目查看权限')

  const rawProjectCode = getRouterParam(event, 'projectCode')
  const query = getQuery(event)
  const ossPath = query.ossPath as string

  if (!rawProjectCode || !ossPath) {
    throw createError({
      statusCode: 400,
      message: '缺少项目ID或文件路径'
    })
  }

  const projectCode = decodeURIComponent(rawProjectCode)
  // Project membership and repository-path scope are not yet represented by a
  // signed Aims/Console assertion. Never turn browser path input into an OSS
  // object read while that contract is absent.
  throw createError({
    statusCode: 503,
    statusMessage: 'project_document_scope_contract_required',
    message: '项目文档范围授权合同尚未就绪'
  })

  try {
    // 1. 获取项目详情以提取 repoPath（用于定位 OSS 中的项目根目录）
    console.log(`[DiffAPI] Getting project info for: ${projectCode}`)
    const projectResponse = await fetchDirectoryResponse<Project>(`/projects/${encodeURIComponent(projectCode)}`)

    if (projectResponse.code !== 0 || !projectResponse.data) {
      throw createError({
        statusCode: 404,
        message: '项目不存在'
      })
    }

    const project = projectResponse.data
    const repoPath = extractGitProjectPath(project.repoUrl) || ''

    if (!repoPath) {
      throw createError({
        statusCode: 400,
        message: '项目未配置有效的仓库地址'
      })
    }

    // 2. 构造 diff 文件路径
    // Account API 存储格式: {gitlabProjectPath}/temp/{relativePath}.diff
    const pathSegments = ossPath.split('/')

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

    const diffPath = `${projectPathFromOss}/temp/${relativePath}.diff`

    console.log('[DiffAPI] Calculated paths:', {
      ossPath,
      projectPathFromOss,
      relativePath,
      diffPath
    })

    const client = createProjectsOSSClient()

    try {
      const result = await client.get(diffPath)
      const diffContent = result.content.toString('utf-8')

      return {
        code: 0,
        message: 'success',
        data: diffContent
      }
    } catch (err: unknown) {
      const error = err as { code?: string }
      if (error.code === 'NoSuchKey') {
        console.warn(`[DiffAPI] Diff file not found on OSS: ${diffPath}`)
        throw createError({
          statusCode: 404,
          message: '未找到冲突差异文件'
        })
      }
      throw err
    }
  } catch (err: unknown) {
    console.error('[DiffAPI] Failed to fetch diff:', err)
    const error = err as { statusCode?: number, message?: string }

    if (error.statusCode) {
      throw err
    }

    throw createError({
      statusCode: 500,
      message: error.message || '获取差异文件失败'
    })
  }
})

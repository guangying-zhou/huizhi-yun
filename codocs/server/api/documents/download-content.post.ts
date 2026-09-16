/**
 * 下载文档内容 API
 * POST /api/documents/download-content
 *
 * 从 OSS 下载文档内容并返回，用于前端审阅页面展示文档
 */

import type { H3Event } from 'h3'
import { downloadDocument } from '../../utils/oss'
import { hasMeaningfulMarkdownContent, recoverMarkdownFromYjsSnapshot } from '../../utils/yjsMarkdownRecovery'
import { getGitProjectInfo } from '@hzy/foundation/server/utils/gitIntegration'
import { getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import { fetchDirectoryResponse } from '~~/server/utils/directoryCompat'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'

type RequestBody = {
  uuid?: unknown
  document_uuid?: unknown
  documentUuid?: unknown
  oss_path?: unknown
  doc_type?: unknown
  project_code?: unknown
  projectCode?: unknown
}

interface DirectoryProject {
  projectCode?: string
  repoUrl?: string
  subProjects?: DirectoryProject[]
}

interface DirectoryProjectList {
  items?: DirectoryProject[]
  flat?: DirectoryProject[]
}

function text(value: unknown) {
  return String(value || '').trim()
}

function normalizeOssPath(value: unknown) {
  return text(value).replace(/^\/+/, '')
}

function assertSafeOssPath(ossPath: string) {
  if (!ossPath || ossPath.includes('\\') || ossPath.split('/').some(segment => segment === '..')) {
    throw createError({ statusCode: 400, message: '非法 oss_path 参数' })
  }
}

function flattenProjects(projects: DirectoryProject[] = []): DirectoryProject[] {
  const result: DirectoryProject[] = []
  for (const project of projects) {
    result.push(project)
    if (Array.isArray(project.subProjects)) {
      result.push(...flattenProjects(project.subProjects))
    }
  }
  return result
}

async function resolveGitProjectOssPath(event: H3Event, body: RequestBody) {
  await requirePermission(event, 'projects', 'export', '缺少项目文档导出权限')

  const projectCode = text(body.project_code || body.projectCode)
  const ossPath = normalizeOssPath(body.oss_path)
  if (!projectCode) {
    throw createError({ statusCode: 400, message: '缺少 project_code 参数' })
  }
  if (!ossPath) {
    throw createError({ statusCode: 400, message: '缺少 oss_path 参数' })
  }
  assertSafeOssPath(ossPath)

  const projectResponse = await fetchDirectoryResponse<DirectoryProjectList>('/projects', {
    params: {
      search: projectCode,
      status: 'all',
      include_template: 'true'
    }
  })
  const projectCandidates = projectResponse.data?.flat?.length
    ? projectResponse.data.flat
    : flattenProjects(projectResponse.data?.items || [])
  const project = projectCandidates.find(item => item.projectCode === projectCode)
  if (projectResponse.code !== 0 || !project) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }

  const repoUrl = text(project.repoUrl)
  if (!repoUrl) {
    throw createError({ statusCode: 400, message: '项目未配置仓库地址或仓库地址不正确' })
  }
  const gitProject = await getGitProjectInfo({ repoUrl })
  const repoPath = text(gitProject.path_with_namespace)
  if (!repoPath || !ossPath.startsWith(`${repoPath}/`)) {
    throw createError({ statusCode: 403, message: 'OSS 路径不属于当前项目' })
  }

  return { ossPath, docType: 'git-project' }
}

async function resolveDocumentOssPath(event: H3Event, body: RequestBody) {
  await requirePermission(event, 'documents', 'export', '缺少文档导出权限')

  const uuid = text(body.uuid || body.document_uuid || body.documentUuid)
  if (!uuid) {
    throw createError({ statusCode: 400, message: '缺少 document uuid 参数' })
  }

  const doc = await getCodocsDocumentMetadata(event, uuid, { actorUid: getRequestUid(event) })
  if (!doc.oss_path) {
    throw createError({ statusCode: 404, message: '文档内容不存在' })
  }

  const requestedOssPath = normalizeOssPath(body.oss_path)
  if (requestedOssPath) {
    assertSafeOssPath(requestedOssPath)
    if (requestedOssPath !== doc.oss_path) {
      throw createError({ statusCode: 403, message: 'OSS 路径与文档不匹配' })
    }
  }

  return { ossPath: doc.oss_path, docType: doc.doc_type }
}

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody<RequestBody>(event)
    const docType = text(body.doc_type)
    const resolved = docType === 'git-project'
      ? await resolveGitProjectOssPath(event, body)
      : await resolveDocumentOssPath(event, body)

    let content = await downloadDocument(resolved.ossPath, resolved.docType)

    if (content === null) {
      content = await recoverMarkdownFromYjsSnapshot(resolved.ossPath, resolved.docType)
    } else if (!hasMeaningfulMarkdownContent(content)) {
      content = await recoverMarkdownFromYjsSnapshot(resolved.ossPath, resolved.docType)
    }

    if (!hasMeaningfulMarkdownContent(content)) {
      throw createError({
        statusCode: 404,
        message: '文档内容不存在'
      })
    }

    return {
      success: true,
      content
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number }
    if (error.statusCode) throw err
    console.error('Failed to download document content:', error)
    throw createError({
      statusCode: 500,
      message: '下载文档内容失败'
    })
  }
})

/**
 * 获取项目文档文件列表
 * GET /api/project-docs/files/:projectCode
 */
import { getGitIntegrationConfig } from '@hzy/foundation/server/utils/gitIntegration'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { fetchDirectoryResponse } from '~~/server/utils/directoryCompat'
import { createProjectsOSSClient } from '~~/server/utils/oss'

interface OSSListResult {
  objects?: { name: string, size?: number, lastModified?: string }[]
  isTruncated?: boolean
  nextMarker?: string
}

interface RuntimePage<T> {
  items?: T[]
}

interface DirectoryProject {
  projectCode?: string
  repoUrl?: string
  isGroup?: number | string | boolean
  docsSyncedAt?: string | null
  subProjects?: DirectoryProject[]
}

interface DirectoryProjectList {
  items?: DirectoryProject[]
  flat?: DirectoryProject[]
}

interface FolderRow {
  id: number
  name: string
  parent_id: number | null
  created_at: string
}

interface DocumentRow {
  id?: number
  uuid: string
  title: string
  oss_path: string
  content_size?: number
  created_at?: string
  updated_at?: string
  committed_at?: string | null
  doc_type?: string
  folder_id?: number | null
}

interface FolderNode {
  id: number
  name: string
  path: string
  size: number
  createdAt: string
  isDirectory: true
  children: Array<FolderNode | Record<string, unknown>>
}

const flattenProjects = (projects: DirectoryProject[] = []): DirectoryProject[] => {
  const result: DirectoryProject[] = []
  for (const project of projects) {
    result.push(project)
    if (Array.isArray(project.subProjects)) {
      result.push(...flattenProjects(project.subProjects))
    }
  }
  return result
}

const isMarkdownProjectDoc = (relativePath: string) => {
  return relativePath.toLowerCase().endsWith('.md')
    && !relativePath.includes('/temp/')
    && (!relativePath.includes('/') || /^docs\//i.test(relativePath))
}

const getGitLabDocSortGroup = (relativePath: string): number => {
  if (!relativePath.includes('/')) return 0
  if (/^docs\//i.test(relativePath)) return 1
  return 2
}

const compareGitLabDocNames = (left: string, right: string): number => {
  return left.localeCompare(right, 'zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base'
  })
}

const listGitProjectDocsFromOSS = async (prefix: string) => {
  const ossClient = createProjectsOSSClient()
  const files: Record<string, unknown>[] = []
  let marker: string | undefined

  do {
    const result = await ossClient.list({
      prefix,
      'max-keys': 1000,
      marker
    }, {}) as OSSListResult

    for (const object of result.objects || []) {
      const objectName = object.name
      const relativePath = objectName.startsWith(prefix) ? objectName.slice(prefix.length) : objectName
      if (!relativePath || !isMarkdownProjectDoc(relativePath)) continue

      let conflictStatus = false
      let gitlabLatestSize: string | null = null
      let gitlabLatestCommitId: string | null = null
      try {
        const headResult = await ossClient.head(objectName)
        const meta = headResult.meta as Record<string, string> | undefined
        conflictStatus = meta?.['conflict-status'] === '1'
        gitlabLatestSize = meta?.['gitlab-latest-size'] || null
        gitlabLatestCommitId = meta?.['gitlab-latest-commit-id'] || null
      } catch (error) {
        console.warn(`[ProjectDocs] Failed to read OSS meta for ${objectName}:`, error)
      }

      files.push({
        name: relativePath,
        path: objectName,
        oss_path: objectName,
        doc_type: 'git-project',
        size: object.size || 0,
        createdAt: object.lastModified || null,
        lastModified: object.lastModified || null,
        committedAt: object.lastModified || null,
        isModified: false,
        isDirectory: false,
        conflictStatus,
        gitlabLatestSize,
        gitlabLatestCommitId
      })
    }

    marker = result.isTruncated ? result.nextMarker : undefined
  } while (marker)

  return files.sort((left, right) => {
    const leftName = String(left.name || '')
    const rightName = String(right.name || '')
    const groupDiff = getGitLabDocSortGroup(leftName) - getGitLabDocSortGroup(rightName)
    return groupDiff || compareGitLabDocNames(leftName, rightName)
  })
}

const buildRuntimeProjectTree = (folders: FolderRow[], docs: DocumentRow[]) => {
  const folderMap = new Map<number, FolderNode>()
  const root: Array<FolderNode | Record<string, unknown>> = []

  for (const folder of folders) {
    folderMap.set(folder.id, {
      id: folder.id,
      name: folder.name,
      path: '',
      size: 0,
      createdAt: folder.created_at,
      isDirectory: true,
      children: []
    })
  }

  for (const folder of folders) {
    const node = folderMap.get(folder.id)
    if (!node) continue
    if (folder.parent_id && folderMap.has(folder.parent_id)) {
      folderMap.get(folder.parent_id)!.children.push(node)
    } else {
      root.push(node)
    }
  }

  for (const doc of docs) {
    const item = {
      uuid: doc.uuid,
      name: doc.title,
      path: doc.oss_path,
      oss_path: doc.oss_path,
      size: doc.content_size || 0,
      createdAt: doc.created_at || null,
      lastModified: doc.updated_at || null,
      committedAt: doc.committed_at || null,
      doc_type: doc.doc_type || 'project',
      isModified: false,
      isDirectory: false,
      conflictStatus: false,
      gitlabLatestSize: null,
      gitlabLatestCommitId: null
    }

    if (doc.folder_id && folderMap.has(doc.folder_id)) {
      folderMap.get(doc.folder_id)!.children.push(item)
    } else {
      root.push(item)
    }
  }

  return root
}

export default defineEventHandler(async (event) => {
  const rawProjectCode = getRouterParam(event, 'projectCode')
  if (!rawProjectCode) {
    throw createError({ statusCode: 400, message: '缺少项目ID' })
  }
  const projectCode = decodeURIComponent(rawProjectCode)

  const gitlabConfig = await getGitIntegrationConfig()
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

  const isGroup = Number(project.isGroup) === 1
  const isGitLabProject = Boolean(project.repoUrl && (!isGroup || project.docsSyncedAt))
  if (isGitLabProject) {
    const repoUrl = String(project.repoUrl || '')
    if (!repoUrl.startsWith(gitlabConfig.baseUrl)) {
      throw createError({ statusCode: 400, message: '项目未配置仓库地址或仓库地址不正确' })
    }
    const repoPath = repoUrl.replace(gitlabConfig.baseUrl, '').replace(/^\/+/, '').replace(/\.git$/, '')
    const files = await listGitProjectDocsFromOSS(`${repoPath}/`)
    return { code: 0, data: files }
  }

  const [foldersPage, documentsPage] = await Promise.all([
    callCodocsTenantRuntime<RuntimePage<FolderRow>>(event, '/v1/codocs/folders', {
      query: { folder_type: 'project', project_code: projectCode, limit: 5000 },
      scope: 'codocs.read'
    }),
    callCodocsTenantRuntime<RuntimePage<DocumentRow>>(event, '/v1/codocs/documents', {
      query: { type: 'project', project_code: projectCode, limit: 5000 },
      scope: 'codocs.read'
    })
  ])

  return {
    code: 0,
    data: buildRuntimeProjectTree(foldersPage.items || [], documentsPage.items || [])
  }
})

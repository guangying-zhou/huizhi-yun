/**
 * POST /api/v1/projects/:id/other-documents
 *
 * Uploads non-Markdown project documents into Codocs department cabinet (OSS)
 * and registers the returned file metadata in Aims project_documents.
 */
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import type { H3Event } from 'h3'
import { uploadCodocsDepartmentCabinetFile } from '~~/server/utils/codocsApi'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'

type RuntimeEnvelope<T> = {
  code?: number
  data?: T
  message?: string
}

interface RuntimeProject {
  id?: number
  project_code?: string
  projectCode?: string
  dept_code?: string | null
  deptCode?: string | null
  leader_uid?: string | null
  leaderUid?: string | null
  created_by?: string | null
  createdBy?: string | null
}

interface RuntimeMember {
  uid?: string
  role?: string
  status?: string
}

interface RuntimePage<T> {
  items?: T[]
}

const allowedExtensions = new Set([
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'pdf',
  'txt',
  'csv',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz'
])

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function fileExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase()
  const index = normalized.lastIndexOf('.')
  return index >= 0 ? normalized.slice(index + 1) : ''
}

function otherDocumentCategory(fileName: string, fallback?: string) {
  const normalized = stringValue(fallback)
  if (normalized.startsWith('other_')) return normalized

  const extension = fileExtension(fileName)
  if (extension === 'doc' || extension === 'docx') return 'other_word'
  if (extension === 'xls' || extension === 'xlsx') return 'other_excel'
  if (extension === 'ppt' || extension === 'pptx') return 'other_powerpoint'
  if (extension === 'pdf') return 'other_pdf'
  return 'other_file'
}

function unwrapRuntimeData<T>(value: unknown): T {
  const envelope = value as RuntimeEnvelope<T>
  if (envelope && typeof envelope === 'object' && 'data' in envelope) {
    if (envelope.code !== undefined && envelope.code !== 0) {
      throw createError({ statusCode: 502, message: envelope.message || 'Aims tenant-runtime returned an error.' })
    }
    return envelope.data as T
  }
  return value as T
}

async function callAimsRuntime<T>(
  event: H3Event,
  path: string,
  options: {
    method?: string
    query?: Record<string, unknown>
    body?: Record<string, unknown>
    scope?: string
  }
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'aims',
    scope: options.scope || (options.method && options.method !== 'GET' ? 'aims.write' : 'aims.read'),
    method: options.method || 'GET',
    query: options.query,
    body: options.body
  })

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for project document upload.'
    })
  }

  return unwrapRuntimeData<T>(runtime.data)
}

function projectField(project: RuntimeProject, camel: keyof RuntimeProject, snake: keyof RuntimeProject) {
  return stringValue(project[camel] ?? project[snake])
}

function isProjectMember(project: RuntimeProject, uid: string, members: RuntimeMember[]) {
  const leaderUid = projectField(project, 'leaderUid', 'leader_uid')
  const createdBy = projectField(project, 'createdBy', 'created_by')
  if (leaderUid === uid || createdBy === uid) return true

  return members.some(member =>
    stringValue(member.uid) === uid
    && (!member.status || member.status === 'active')
  )
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const multipart = await readMultipartFormData(event)
  if (!multipart) {
    throw createError({ statusCode: 400, message: '请选择文件' })
  }

  const file = multipart.find(part => part.filename)
  if (!file?.filename || !file.data?.length) {
    throw createError({ statusCode: 400, message: '请选择文件' })
  }

  const extension = fileExtension(file.filename)
  if (extension === 'md' || extension === 'markdown') {
    throw createError({ statusCode: 400, message: 'Markdown 文件请上传到规范文档' })
  }
  if (!allowedExtensions.has(extension)) {
    throw createError({ statusCode: 400, message: `不支持的文件类型: .${extension || 'unknown'}` })
  }

  const projectAccessQuery = await buildAimsProjectRuntimeAccessQuery(event, {
    projectId,
    uid,
    baseQuery: { operator_uid: uid }
  })

  const project = await callAimsRuntime<RuntimeProject>(
    event,
    `/v1/aims/projects/${encodeURIComponent(String(projectId))}`,
    {
      query: projectAccessQuery,
      scope: 'aims.read'
    }
  )

  const membersPage = await callAimsRuntime<RuntimePage<RuntimeMember>>(
    event,
    `/v1/aims/projects/${encodeURIComponent(String(projectId))}/members`,
    {
      query: {
        ...projectAccessQuery,
        uid,
        pageSize: 1
      },
      scope: 'aims.read'
    }
  )

  const members = Array.isArray(membersPage.items) ? membersPage.items : []
  const isScopedProjectAdmin = stringValue(projectAccessQuery.current_user_is_project_admin) === '1'
  if (!isScopedProjectAdmin && !isProjectMember(project, uid, members)) {
    throw createError({ statusCode: 403, message: '仅项目成员可以上传项目文档' })
  }

  const projectCode = projectField(project, 'projectCode', 'project_code')
  const deptCode = projectField(project, 'deptCode', 'dept_code')
  if (!projectCode) {
    throw createError({ statusCode: 500, message: '项目编码缺失，无法登记项目文档' })
  }
  if (!deptCode) {
    throw createError({ statusCode: 500, message: '项目部门缺失，无法上传到部门文件柜' })
  }

  const docCategory = otherDocumentCategory(
    file.filename,
    multipart.find(part => part.name === 'docCategory')?.data.toString()
  )

  const uploaded = await uploadCodocsDepartmentCabinetFile({
    ownerUid: uid,
    deptCode,
    projectCode,
    fileName: file.filename,
    data: file.data,
    contentType: file.type || 'application/octet-stream'
  })

  const indexed = await callAimsRuntime<Record<string, unknown>>(
    event,
    '/v1/aims/documents',
    {
      method: 'POST',
      scope: 'aims.write',
      body: {
        uuid: uploaded.uuid,
        projectId,
        projectCode,
        title: uploaded.filename || file.filename,
        docCategory,
        isFolder: false,
        documentSource: 'repo',
        repoProjectCode: projectCode,
        repoFilePath: uploaded.ossPath,
        ossPath: uploaded.ossPath,
        contentSize: uploaded.fileSize || file.data.length,
        current_user: uid,
        operator_uid: uid
      }
    }
  )

  return {
    code: 0,
    data: {
      document: indexed,
      cabinetFile: uploaded
    }
  }
})

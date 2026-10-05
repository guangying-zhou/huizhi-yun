/**
 * 将个人文档直接移交到项目组
 * POST /api/documents/:uuid/project-transfer
 *
 * Body: { projectCode, projectName? }
 * 校验：
 *  - 仅文档所有者可发起
 *  - 文档必须为 private 且非只读
 *  - 目标项目必须是用户参与或管理的项目（任意层级）
 * 效果：直接把 doc_type 切换为 project，迁移 OSS 文件，保留 owner_uid
 */
import type { Project, UserProjects } from '~/types/account'
import { getDocumentPath, renameDocument } from '~~/server/utils/oss'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { fetchDirectoryResponse } from '~~/server/utils/directoryCompat'
import { callCodocsTenantRuntime, getCodocsDocumentMetadata, updateCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'

interface DocumentRow {
  uuid: string
  title: string
  oss_path: string
  doc_type: string
  owner_uid: string
  dept_code: string | null
  readonly_flag: number
  status: number
}

function findProjectInTree(projects: Project[] | undefined, projectCode: string): Project | null {
  if (!projects?.length) return null
  for (const project of projects) {
    if (project.projectCode === projectCode) return project
    const child = findProjectInTree(project.subProjects, projectCode)
    if (child) return child
  }
  return null
}

export default defineEventHandler(async (event) => {
  const uuid = getRouterParam(event, 'uuid')
  const uid = requireRequestUid(event)

  const { projectCode, projectName } = await readBody<{ projectCode?: string, projectName?: string }>(event) || {}
  if (!uuid || !projectCode) {
    throw createError({ statusCode: 400, message: '缺少必填参数' })
  }

  const doc = await getCodocsDocumentMetadata(event, uuid, { actorUid: uid }) as DocumentRow

  if (doc.owner_uid !== uid) {
    throw createError({ statusCode: 403, message: '仅文档所有者可发起移交' })
  }

  if (doc.doc_type !== 'private') {
    throw createError({ statusCode: 400, message: '当前仅支持移交个人文档' })
  }

  if (doc.readonly_flag === 1) {
    throw createError({ statusCode: 403, message: '当前文档为只读状态，无法移交' })
  }

  // 2. 校验用户对目标项目的归属
  let userProjects: UserProjects | null = null
  try {
    const response = await fetchDirectoryResponse<UserProjects>(
      `/users/${encodeURIComponent(uid)}/projects`,
      { timeout: 10000 }
    )
    userProjects = response?.data || null
  } catch (error) {
    console.error('[ProjectTransfer] Failed to load user projects:', error)
    throw createError({ statusCode: 502, message: '无法校验项目归属，请稍后重试' })
  }

  const matched
    = findProjectInTree(userProjects?.managed, projectCode)
      || findProjectInTree(userProjects?.joined, projectCode)

  if (!matched) {
    throw createError({ statusCode: 403, message: '仅可移交到你参与或管理的项目组' })
  }

  // 3. 计算新的 OSS 路径，并检查目标是否存在同名文档
  const newOssPath = getDocumentPath('project', uid, projectCode, '', doc.title)

  const conflict = await callCodocsTenantRuntime<{ exists?: boolean }>(event, '/v1/codocs/documents/check-name', {
    query: {
      title: doc.title,
      doc_type: 'project',
      project_code: projectCode,
      exclude_uuid: doc.uuid
    },
    scope: 'codocs.read'
  })
  if (conflict.exists) {
    throw createError({ statusCode: 409, message: '目标项目组已存在同名文档，请先改名后再移交' })
  }

  // 4. 迁移 OSS 文件
  try {
    await renameDocument(doc.oss_path, newOssPath, 'project')
  } catch (error) {
    console.error('[ProjectTransfer] OSS rename failed:', error)
    throw createError({ statusCode: 500, message: '文档文件迁移失败，请稍后重试' })
  }

  await updateCodocsDocumentMetadata(event, doc.uuid, {
    docType: 'project',
    ossPath: newOssPath,
    projectCode,
    deptCode: null,
    folderId: null,
    homeFlag: false,
    lastEditorUid: uid,
    actorUid: uid
  })

  return {
    code: 0,
    message: 'success',
    data: {
      documentUuid: doc.uuid,
      projectCode,
      projectName: projectName || matched.name
    }
  }
})

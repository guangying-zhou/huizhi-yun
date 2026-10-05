import { useDbPool } from '~~/server/utils/db'
import type { ResultSetHeader } from 'mysql2/promise'
import { logOperationFromEvent } from '~~/server/utils/log'

interface CreateProjectBody {
  projectCode: string
  name: string
  deptCode: string
  leaderUid?: string
  description?: string
  startDate?: string
  endDate?: string
  repoUrl?: string
  parentId?: string | null
  /** 是否在 GitLab 上真正创建仓库（默认 false，仅写数据库） */
  createOnGitlab?: boolean
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateProjectBody>(event)
  const pool = useDbPool()

  // Validation
  if (!body.projectCode || !body.name || !body.deptCode) {
    throw createError({
      statusCode: 400,
      message: '缺少必填字段: projectCode, name, deptCode'
    })
  }

  // Validate projectCode format (lowercase letters, numbers, hyphens, slashes for namespacing)
  if (!/^[a-z0-9]+([-/][a-z0-9]+)*$/.test(body.projectCode)) {
    throw createError({
      statusCode: 400,
      message: '项目编码格式无效，请使用小写字母、数字、连字符和斜杠 (如: group/proj-abc)'
    })
  }

  try {
    let repoUrl = body.repoUrl || null
    let gitlabProjectId: number | null = null

    // 如果指定了 createOnGitlab 且有 parentId（群组），则调用 GitLab API 创建仓库
    if (body.createOnGitlab && body.parentId) {
      const config = useRuntimeConfig()
      const gitlabBaseUrl = config.ingestionService.gitlabBaseUrl
      const gitlabToken = config.ingestionService.gitlabApiToken

      if (!gitlabToken) {
        throw createError({ statusCode: 500, message: 'GitLab API Token 未配置' })
      }

      // 获取父群组的 GitLab namespace ID
      const encodedNamespace = encodeURIComponent(body.parentId)
      const gitlabGroup = await $fetch<{ id: number }>(`${gitlabBaseUrl}/api/v4/groups/${encodedNamespace}`, {
        headers: { 'PRIVATE-TOKEN': gitlabToken }
      }).catch(() => null)

      if (!gitlabGroup?.id) {
        throw createError({ statusCode: 404, message: `在 GitLab 中未找到群组: ${body.parentId}` })
      }

      // 从 projectCode 中提取最后一段作为 path（如 huizhi-yun/test -> test）
      const projectPath = body.projectCode.includes('/')
        ? body.projectCode.split('/').pop()!
        : body.projectCode

      // 调用 GitLab API 创建项目
      const gitlabProject = await $fetch<{
        id: number
        path_with_namespace: string
        http_url_to_repo: string
        web_url: string
      }>(`${gitlabBaseUrl}/api/v4/projects`, {
        method: 'POST',
        headers: { 'PRIVATE-TOKEN': gitlabToken },
        body: {
          name: body.name,
          path: projectPath,
          namespace_id: gitlabGroup.id,
          description: body.description || '',
          visibility: 'private',
          initialize_with_readme: true
        }
      })

      if (!gitlabProject?.id) {
        throw createError({ statusCode: 500, message: 'GitLab 创建项目失败' })
      }

      repoUrl = gitlabProject.http_url_to_repo || gitlabProject.web_url
      gitlabProjectId = gitlabProject.id
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO git_projects (project_code, parent_code, name, dept_code, leader_uid, description, start_date, end_date, repo_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        body.projectCode,
        body.parentId || null,
        body.name,
        body.deptCode,
        body.leaderUid || null,
        body.description || null,
        body.startDate || null,
        body.endDate || null,
        repoUrl
      ]
    )

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'project.create',
      targetType: 'project',
      targetId: body.projectCode,
      detail: {
        id: result.insertId,
        name: body.name,
        deptCode: body.deptCode,
        leaderUid: body.leaderUid || null,
        parentId: body.parentId || null,
        gitlabProjectId
      }
    })

    return {
      success: true,
      message: '创建成功',
      data: {
        id: result.insertId,
        repoUrl,
        gitlabProjectId
      }
    }
  } catch (err: unknown) {
    const error = err as { code?: string, message?: string, statusCode?: number }
    // 透传已有的 HTTP 错误
    if (error.statusCode) throw err
    // Handle duplicate key error
    if (error.code === 'ER_DUP_ENTRY') {
      throw createError({
        statusCode: 409,
        message: '项目ID已存在'
      })
    }

    console.error('Failed to create project:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to create project'
    })
  }
})

import { useDbPool } from '~~/server/utils/db'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { logOperationFromEvent } from '~~/server/utils/log'

interface ForkCreateBody {
  templateProjectCode: string
  targetNamespace: string
  projectPath: string
  projectName: string
  leaderUid: string
  deptCode: string
}

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  repo_url: string | null
  is_template: number
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ForkCreateBody>(event)
  const pool = useDbPool()
  const config = useRuntimeConfig()
  const gitlabBaseUrl = config.ingestionService.gitlabBaseUrl
  const gitlabToken = config.ingestionService.gitlabApiToken

  // 参数校验
  if (!body.templateProjectCode || !body.targetNamespace || !body.projectPath || !body.projectName || !body.deptCode) {
    throw createError({
      statusCode: 400,
      message: '缺少必填字段'
    })
  }

  if (!gitlabToken) {
    throw createError({ statusCode: 500, message: 'GitLab API Token 未配置' })
  }

  // 校验项目标识格式
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.projectPath)) {
    throw createError({
      statusCode: 400,
      message: '项目标识格式无效，请使用小写字母、数字和连字符'
    })
  }

  try {
    // 1. 查询模板项目
    const [templateRows] = await pool.query<ProjectRow[]>(
      'SELECT id, project_code, repo_url, is_template FROM git_projects WHERE project_code = ?',
      [body.templateProjectCode]
    )
    if (templateRows.length === 0) {
      throw createError({ statusCode: 404, message: '模板项目不存在' })
    }
    const template = templateRows[0]
    if (!template || !template.repo_url) {
      throw createError({ statusCode: 400, message: '模板项目没有关联的 GitLab 仓库地址' })
    }

    // 2. 从 repo_url 解析 GitLab 项目路径，获取 GitLab project ID
    // repo_url 格式如: http://gitlab.xxx.com/group/project.git 或 http://gitlab.xxx.com/group/project
    const repoPath = template.repo_url
      .replace(gitlabBaseUrl, '')
      .replace(/^\/+/, '')
      .replace(/\.git$/, '')

    const encodedPath = encodeURIComponent(repoPath)
    const gitlabProject = await $fetch<{ id: number }>(`${gitlabBaseUrl}/api/v4/projects/${encodedPath}`, {
      headers: { 'PRIVATE-TOKEN': gitlabToken }
    })

    if (!gitlabProject?.id) {
      throw createError({ statusCode: 404, message: `在 GitLab 中未找到项目: ${repoPath}` })
    }

    // 3. 调用 GitLab Fork API
    const forkedProject = await $fetch<{
      id: number
      path_with_namespace: string
      http_url_to_repo: string
      web_url: string
    }>(`${gitlabBaseUrl}/api/v4/projects/${gitlabProject.id}/fork`, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': gitlabToken },
      body: {
        namespace_path: body.targetNamespace,
        path: body.projectPath,
        name: body.projectPath,
        description: body.projectName
      }
    })

    if (!forkedProject?.id) {
      throw createError({ statusCode: 500, message: 'GitLab Fork 失败' })
    }

    // 4. 在本地数据库创建项目记录
    const projectCode = forkedProject.path_with_namespace.replace(/\//g, '/')
    const repoUrl = forkedProject.http_url_to_repo || forkedProject.web_url

    // 查找父项目（目标 namespace 对应的群组）
    const [parentRows] = await pool.query<ProjectRow[]>(
      'SELECT project_code FROM git_projects WHERE project_code = ? AND is_group = 1',
      [body.targetNamespace]
    )
    const parentCode = parentRows.length > 0 ? parentRows[0]?.project_code : null

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO git_projects (project_code, parent_code, name, dept_code, leader_uid, description, repo_url, is_group, is_template, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), repo_url = VALUES(repo_url), leader_uid = VALUES(leader_uid)`,
      [
        projectCode,
        parentCode,
        body.projectPath,
        body.deptCode,
        body.leaderUid || null,
        body.projectName,
        repoUrl
      ]
    )

    // 5. 从 GitLab 同步该项目的成员
    const botUsername = process.env.GITLAB_BOT_USERNAME || 'bot'
    try {
      const members = await $fetch<{ username: string, access_level: number }[]>(
        `${gitlabBaseUrl}/api/v4/projects/${forkedProject.id}/members/all`,
        { headers: { 'PRIVATE-TOKEN': gitlabToken } }
      )
      for (const member of members) {
        if (member.username && member.username !== botUsername) {
          await pool.query(
            'INSERT IGNORE INTO git_project_members (project_code, uid) VALUES (?, ?)',
            [projectCode, member.username]
          )
        }
      }
    } catch {
      // Ignored
    }

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'project.fork-create',
      targetType: 'project',
      targetId: projectCode,
      detail: {
        templateProjectCode: body.templateProjectCode,
        gitlabProjectId: forkedProject.id,
        targetNamespace: body.targetNamespace,
        repoUrl
      }
    })

    return {
      success: true,
      message: '项目创建成功',
      data: {
        id: result.insertId,
        projectCode,
        repoUrl,
        gitlabProjectId: forkedProject.id
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, data?: { message?: unknown }, status?: number, message?: string }
    if (error.statusCode) throw error

    // GitLab API 错误处理
    if (error.data?.message) {
      const msg = typeof error.data.message === 'object'
        ? JSON.stringify(error.data.message)
        : String(error.data.message)
      throw createError({
        statusCode: error.status || 500,
        message: `GitLab 错误: ${msg}`
      })
    }

    console.error('Failed to fork-create project:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '创建项目失败'
    })
  }
})

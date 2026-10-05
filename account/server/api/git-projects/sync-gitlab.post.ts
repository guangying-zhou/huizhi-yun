import { defineEventHandler } from 'h3'
import { queryRows, execute } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface GitLabGroup {
  id: number
  name: string
  path: string
  full_path: string
  parent_id: number | null
  description: string | null
  created_at: string
  owner_id?: number
}

interface GitLabProject {
  id: number
  name: string
  path: string
  path_with_namespace: string
  description: string | null
  created_at: string
  namespace: {
    id: number
    name: string
    path: string
    full_path: string
    kind: string
  }
  creator_id?: number
}

interface GitLabMember {
  id: number
  username: string
  access_level: number
}

export default defineEventHandler(async (_event) => {
  const config = useRuntimeConfig()
  const gitlabBaseUrl = config.ingestionService.gitlabBaseUrl
  const gitlabToken = config.ingestionService.gitlabApiToken
  const botUsername = process.env.GITLAB_BOT_USERNAME || 'bot'

  if (!gitlabToken) {
    throw createError({ statusCode: 500, message: 'GitLab API Token 未配置' })
  }

  try {
    // 获取所有 GitLab groups（处理分页）
    let allGroups: GitLabGroup[] = []
    let groupPage = 1
    let hasMoreGroups = true

    while (hasMoreGroups) {
      const groups = await $fetch<GitLabGroup[]>(`${gitlabBaseUrl}/api/v4/groups`, {
        headers: { 'PRIVATE-TOKEN': gitlabToken },
        query: { per_page: 100, page: groupPage, all_available: true }
      })

      if (groups.length === 0) {
        hasMoreGroups = false
      } else {
        allGroups = allGroups.concat(groups)
        groupPage++
        if (groups.length < 100) {
          hasMoreGroups = false
        }
      }
    }

    // 获取所有 GitLab projects（处理分页）
    let allProjects: GitLabProject[] = []
    let projectPage = 1
    let hasMoreProjects = true

    while (hasMoreProjects) {
      const git_projects = await $fetch<GitLabProject[]>(`${gitlabBaseUrl}/api/v4/projects`, {
        headers: { 'PRIVATE-TOKEN': gitlabToken },
        query: {
          per_page: 100,
          page: projectPage,
          archived: false,
          with_custom_attributes: false
        }
      })

      if (git_projects.length === 0) {
        hasMoreProjects = false
      } else {
        allProjects = allProjects.concat(git_projects)
        projectPage++
        if (git_projects.length < 100) {
          hasMoreProjects = false
        }
      }
    }

    // 获取所有 GitLab users（用于匹配 creator_id）
    let allGitlabUsers: { id: number, username: string }[] = []
    let userPage = 1
    let hasMoreUsers = true

    while (hasMoreUsers) {
      const gitlabUsers = await $fetch<{ id: number, username: string }[]>(`${gitlabBaseUrl}/api/v4/users`, {
        headers: { 'PRIVATE-TOKEN': gitlabToken },
        query: { per_page: 100, page: userPage }
      })

      if (gitlabUsers.length === 0) {
        hasMoreUsers = false
      } else {
        allGitlabUsers = allGitlabUsers.concat(gitlabUsers)
        userPage++
        if (gitlabUsers.length < 100) {
          hasMoreUsers = false
        }
      }
    }

    // 获取所有用户及其部门信息（优先取 org_type = 'department' 的部门）
    const users = await queryRows<RowDataPacket[]>(
      `SELECT u.uid,
              COALESCE(
                (SELECT d2.dept_code FROM user_departments ud2
                 JOIN departments d2 ON ud2.dept_code = d2.dept_code
                 WHERE ud2.uid = u.uid AND d2.org_type = 'department'
                 LIMIT 1),
                (SELECT d3.dept_code FROM user_departments ud3
                 JOIN departments d3 ON ud3.dept_code = d3.dept_code
                 WHERE ud3.uid = u.uid
                 LIMIT 1)
              ) as dept_code
       FROM system_users u
       WHERE u.status = 1`
    )
    const userDeptMap = new Map(users.filter(u => u.dept_code).map(u => [u.uid, u.dept_code]))

    let syncedCount = 0
    let updatedCount = 0

    // 1. 同步 groups 作为项目组
    for (const group of allGroups) {
      const projectCode = group.full_path
      const repoUrl = `${gitlabBaseUrl}/${group.full_path}`
      const createdAt = new Date(group.created_at).toISOString().slice(0, 19).replace('T', ' ')

      // 获取 group 成员，找到 owner
      let leaderUid: string | null = null
      let deptCode: string | null = null

      try {
        const members = await $fetch<GitLabMember[]>(`${gitlabBaseUrl}/api/v4/groups/${group.id}/members`, {
          headers: { 'PRIVATE-TOKEN': gitlabToken }
        })

        // 找到 access_level = 50 (Owner) 的成员，排除 bot
        const owner = members.find(m => m.access_level === 50 && m.username !== botUsername)
        if (owner) {
          leaderUid = owner.username
          if (leaderUid) {
            deptCode = userDeptMap.get(leaderUid) as string || null
          }
        }
      } catch (err: unknown) {
        console.error(`Failed to get owner for group ${projectCode}:`, err)
      }

      // 确定父项目 ID
      let parentId: string | null = null
      if (group.parent_id) {
        const parentGroup = allGroups.find(g => g.id === group.parent_id)
        if (parentGroup) {
          parentId = parentGroup.full_path
        }
      }

      const existing = await queryRows<RowDataPacket[]>(
        'SELECT id FROM git_projects WHERE project_code = ?',
        [projectCode]
      )

      if (existing.length > 0) {
        await execute(
          `UPDATE git_projects
           SET name = ?, parent_code = ?, repo_url = ?, dept_code = ?, leader_uid = ?, description = ?, is_group = 1, created_at = ?, updated_at = NOW()
           WHERE project_code = ?`,
          [group.name, parentId, repoUrl, deptCode || '', leaderUid, group.description, createdAt, projectCode]
        )
        updatedCount++
      } else {
        await execute(
          `INSERT INTO git_projects (project_code, parent_code, name, dept_code, leader_uid, repo_url, description, is_group, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, NOW())`,
          [projectCode, parentId, group.name, deptCode || '', leaderUid, repoUrl, group.description, createdAt]
        )
        syncedCount++
      }

      // 同步群组成员
      try {
        const members = await $fetch<GitLabMember[]>(`${gitlabBaseUrl}/api/v4/groups/${group.id}/members/all`, {
          headers: { 'PRIVATE-TOKEN': gitlabToken }
        })

        // 清除现有成员
        await execute('DELETE FROM git_project_members WHERE project_code = ?', [projectCode])

        // 插入新成员，排除 bot
        for (const member of members) {
          const memberUid = member.username
          if (memberUid && memberUid !== botUsername) {
            await execute(
              'INSERT IGNORE INTO git_project_members (project_code, uid) VALUES (?, ?)',
              [projectCode, memberUid]
            )
          }
        }
      } catch (err: unknown) {
        console.error(`Failed to sync members for group ${projectCode}:`, err)
      }
    }

    // 2. 同步 git_projects
    for (const project of allProjects) {
      const projectCode = project.path_with_namespace
      const repoUrl = `${gitlabBaseUrl}/${project.path_with_namespace}`
      const createdAt = new Date(project.created_at).toISOString().slice(0, 19).replace('T', ' ')

      // 确定父项目 ID（所属 group）
      let parentId: string | null = null
      if (project.namespace.kind === 'group') {
        parentId = project.namespace.full_path
      }

      // 获取项目成员，找到 Owner (access_level = 50)
      let leaderUid: string | null = null
      let deptCode: string | null = null
      let projectMembers: GitLabMember[] = []

      try {
        projectMembers = await $fetch<GitLabMember[]>(`${gitlabBaseUrl}/api/v4/projects/${encodeURIComponent(projectCode)}/members/all`, {
          headers: { 'PRIVATE-TOKEN': gitlabToken }
        })

        const owner = projectMembers.find(m => m.access_level === 50 && m.username !== botUsername)
        if (owner) {
          leaderUid = owner.username
          if (leaderUid) {
            deptCode = userDeptMap.get(leaderUid) as string || null
          }
        }
      } catch (err: unknown) {
        console.error(`Failed to get members for project ${projectCode}:`, err)
      }

      const existing = await queryRows<RowDataPacket[]>(
        'SELECT id FROM git_projects WHERE project_code = ?',
        [projectCode]
      )

      if (existing.length > 0) {
        await execute(
          `UPDATE git_projects
           SET name = ?, parent_code = ?, repo_url = ?, dept_code = ?, leader_uid = ?, description = ?, is_group = 0, created_at = ?, updated_at = NOW()
           WHERE project_code = ?`,
          [project.name, parentId, repoUrl, deptCode || '', leaderUid, project.description, createdAt, projectCode]
        )
        updatedCount++
      } else {
        await execute(
          `INSERT INTO git_projects (project_code, parent_code, name, dept_code, leader_uid, repo_url, description, is_group, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, NOW())`,
          [projectCode, parentId, project.name, deptCode || '', leaderUid, repoUrl, project.description, createdAt]
        )
        syncedCount++
      }

      // 同步项目成员
      if (projectMembers.length > 0) {
        await execute('DELETE FROM git_project_members WHERE project_code = ?', [projectCode])
        for (const member of projectMembers) {
          const memberUid = member.username
          if (memberUid && memberUid !== botUsername) {
            await execute(
              'INSERT IGNORE INTO git_project_members (project_code, uid) VALUES (?, ?)',
              [projectCode, memberUid]
            )
          }
        }
      }
    }

    return {
      success: true,
      message: `同步完成：新增 ${syncedCount} 个项目，更新 ${updatedCount} 个项目`,
      data: {
        synced: syncedCount,
        updated: updatedCount,
        totalGroups: allGroups.length,
        totalProjects: allProjects.length,
        total: allGroups.length + allProjects.length
      }
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('GitLab sync error:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'GitLab 同步失败'
    })
  }
})

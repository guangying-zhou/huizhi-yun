/**
 * 获取项目详情
 * GET /api/v1/projects/:id
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { normalizeProjectRole } from '~~/app/utils/projectRoles'
import { requireProjectMember } from '~~/server/utils/projectPermission'

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  name: string
  short_name: string
  internal_code: string | null
  description: string | null
  category: string
  methodology: string
  // item_key_prefix removed — project_code is the work item prefix
  lifecycle_status: string
  portfolio_id: number | null
  domain_code: string | null
  dept_code: string | null
  leader_uid: string | null
  start_date: string | null
  end_date: string | null
  opp_id: number | null
  contract_id: number | null
  customer_code: string | null
  customer_name: string | null
  contract_code: string | null
  template_set_id: number | null
  template_version_id: number | null
  template_set_name: string | null
  template_version_label: string | null
  approval_status: string
  workflow_instance_id: string | null
  module_config: string | null
  board_config: string | null
  workflow_config: string | null
  notification_config: string | null
  created_by: string
  created_at: string
  updated_at: string
}

interface MemberRow extends RowDataPacket {
  id: number
  project_id: number
  uid: string
  role: string
  joined_at: string
}

interface RepoRow extends RowDataPacket {
  id: number
  project_id: number
  repo_project_code: string
  last_commit_sha: string | null
  last_synced_at: string | null
  created_at: string
}

function parseConfigJson(value: unknown) {
  if (!value) return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  // 查询项目
  const project = await queryRow<ProjectRow>(
    `SELECT
        p.*,
        ts.name AS template_set_name,
        tv.version_label AS template_version_label
     FROM aims_projects p
     LEFT JOIN project_template_sets ts ON ts.id = p.template_set_id
     LEFT JOIN project_template_versions tv ON tv.id = p.template_version_id
     WHERE p.id = ?`,
    [id]
  )
  if (!project) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }

  const { uid, member } = await requireProjectMember(event, id, '当前用户无权查看该项目')

  // 查询成员
  const members = await queryRows<MemberRow[]>(
    'SELECT * FROM aims_project_members WHERE project_id = ? ORDER BY joined_at',
    [id]
  )

  // 查询关联仓库
  const repos = await queryRows<RepoRow[]>(
    'SELECT * FROM aims_project_repos WHERE project_id = ? ORDER BY created_at',
    [id]
  )

  // 当前用户角色
  const currentMember = members.find(m => m.uid === uid)
  const currentUserRole = currentMember?.role || member.role

  return {
    code: 0,
    data: {
      id: project.id,
      projectCode: project.project_code,
      name: project.name,
      shortName: project.short_name,
      internalCode: project.internal_code,
      description: project.description,
      category: project.category,
      methodology: project.methodology,
      lifecycleStatus: project.lifecycle_status,
      portfolioId: project.portfolio_id,
      domainCode: project.domain_code,
      deptCode: project.dept_code,
      leaderUid: project.leader_uid,
      startDate: project.start_date,
      endDate: project.end_date,
      oppId: project.opp_id,
      contractId: project.contract_id,
      customerCode: project.customer_code,
      customerName: project.customer_name,
      contractCode: project.contract_code,
      templateSetId: project.template_set_id,
      templateSetName: project.template_set_name,
      templateVersionId: project.template_version_id,
      templateVersionLabel: project.template_version_label,
      approvalStatus: project.approval_status,
      workflowInstanceId: project.workflow_instance_id,
      moduleConfig: parseConfigJson(project.module_config),
      boardConfig: parseConfigJson(project.board_config),
      workflowConfig: parseConfigJson(project.workflow_config),
      notificationConfig: parseConfigJson(project.notification_config),
      createdBy: project.created_by,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      members: members.map(m => ({
        id: m.id,
        projectId: m.project_id,
        uid: m.uid,
        role: normalizeProjectRole(m.role),
        joinedAt: m.joined_at
      })),
      repos: repos.map(r => ({
        id: r.id,
        projectId: r.project_id,
        repoProjectCode: r.repo_project_code,
        lastCommitSha: r.last_commit_sha,
        lastSyncedAt: r.last_synced_at,
        createdAt: r.created_at
      })),
      currentUserRole: currentUserRole ? normalizeProjectRole(currentUserRole) : null
    }
  }
})

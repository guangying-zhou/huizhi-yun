export interface ExecutionTotals {
  target_count: number
  incomplete_target_count: number
  open_defect_count: number
  total_weight: number
  completed_weight: number
  no_execution_plan: boolean
}
export interface ProjectExecutionTotals extends ExecutionTotals { project_id: number }
export interface ExecutionCoordination extends ExecutionTotals {
  product_code: string
  version_id: number
  workspace_revision: number
  defect_coverage: string
  projects: ProjectExecutionTotals[]
}
const counters = ['target_count', 'incomplete_target_count', 'open_defect_count', 'total_weight', 'completed_weight'] as const
function totals(value: ExecutionTotals): ExecutionTotals {
  if (!value || counters.some(key => !Number.isSafeInteger(value[key]) || value[key] < 0) || value.incomplete_target_count > value.target_count || value.completed_weight > value.total_weight || value.no_execution_plan !== (value.total_weight === 0)) throw new Error('执行汇总统计无效')
  return { target_count: value.target_count, incomplete_target_count: value.incomplete_target_count, open_defect_count: value.open_defect_count, total_weight: value.total_weight, completed_weight: value.completed_weight, no_execution_plan: value.no_execution_plan }
}

// Product aggregates remain complete; only authorized project rows are paged.
// Whitelist output fields so runtime additions cannot bypass visibility checks.
export async function filterExecutionCoordination(value: ExecutionCoordination, productCode: string, versionId: number, page: number, pageSize: number, canViewProject: (id: number) => Promise<boolean>) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('协调汇总分页无效')
  if (!value || value.product_code !== productCode || value.version_id !== versionId || !Number.isSafeInteger(value.workspace_revision) || value.workspace_revision < 1 || value.defect_coverage !== 'linked-descendants-only' || !Array.isArray(value.projects)) throw new Error('协调汇总身份或覆盖范围无效')
  const aggregate = totals(value)
  const projects = value.projects.map(project => ({ ...totals(project), project_id: project.project_id }))
  if (projects.some((project, index) => !Number.isSafeInteger(project.project_id) || project.project_id < 1 || (index > 0 && project.project_id <= projects[index - 1]!.project_id))) throw new Error('协调汇总项目无效或重复')
  for (const key of counters) {
    let sum = 0
    for (const project of projects) {
      // All terms and the aggregate are non-negative safe integers. Comparing
      // against the remaining aggregate before addition keeps the sum exact
      // without requiring BigInt in the ES2019 Worker target.
      if (project[key] > aggregate[key] - sum) throw new Error('协调汇总与项目统计不一致')
      sum += project[key]
    }
    if (sum !== aggregate[key]) throw new Error('协调汇总与项目统计不一致')
  }
  const visible: ProjectExecutionTotals[] = []
  for (const project of projects) if (await canViewProject(project.project_id)) visible.push(project)
  return { ...aggregate, product_code: productCode, version_id: versionId, workspace_revision: value.workspace_revision, defect_coverage: value.defect_coverage, projects: visible.slice((page - 1) * pageSize, page * pageSize), total: visible.length, restricted_project_count: projects.length - visible.length, page, pageSize }
}

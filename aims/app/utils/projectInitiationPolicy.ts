export const PRODUCT_DEVELOPMENT_REPOSITORY_REQUIRED_MESSAGE
  = '产品开发类项目请先关联代码库，关联后方可提交立项审批'

export const ROUTINE_INITIATION_NOT_APPLICABLE_MESSAGE
  = '日常事务容器不经过立项审批，创建后直接启用'

interface ProjectInitiationPolicyInput {
  category?: unknown
  repos?: unknown
}

function text(value: unknown) {
  return String(value || '').trim()
}

export function projectRequiresInitiation(project: ProjectInitiationPolicyInput | null | undefined) {
  return text(project?.category) !== 'routine'
}

export function getProjectInitiationApplicabilityIssue(project: ProjectInitiationPolicyInput | null | undefined) {
  return projectRequiresInitiation(project)
    ? null
    : ROUTINE_INITIATION_NOT_APPLICABLE_MESSAGE
}

export function getProjectInitiationRepositoryIssue(project: ProjectInitiationPolicyInput | null | undefined) {
  if (text(project?.category) !== 'product_dev') return null

  const repos = Array.isArray(project?.repos) ? project.repos : []
  const hasLinkedRepository = repos.some((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const repo = item as Record<string, unknown>
    return Boolean(text(repo.repoProjectCode ?? repo.repo_project_code))
  })

  return hasLinkedRepository
    ? null
    : PRODUCT_DEVELOPMENT_REPOSITORY_REQUIRED_MESSAGE
}

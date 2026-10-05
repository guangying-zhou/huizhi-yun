import { listGitCommits } from '../../utils/gitIntegration'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const data = await listGitCommits({
    projectCode: String(query.projectCode || query.project_code || ''),
    repoUrl: String(query.repoUrl || query.repo_url || ''),
    repoPath: String(query.repoPath || query.repo_path || ''),
    integrationCode: String(query.integrationCode || query.integration_code || 'gitlab.default'),
    ref: typeof query.ref === 'string' ? query.ref : undefined,
    path: typeof query.path === 'string' ? query.path : undefined,
    since: typeof query.since === 'string' ? query.since : undefined,
    until: typeof query.until === 'string' ? query.until : undefined,
    page: Number(query.page || 1),
    perPage: Number(query.perPage || query.per_page || 50)
  })

  return { code: 0, data }
})

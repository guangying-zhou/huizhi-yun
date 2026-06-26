import { listGitMarkdownTree } from '../../utils/gitIntegration'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const data = await listGitMarkdownTree({
    projectCode: String(query.projectCode || query.project_code || ''),
    repoUrl: String(query.repoUrl || query.repo_url || ''),
    repoPath: String(query.repoPath || query.repo_path || ''),
    integrationCode: String(query.integrationCode || query.integration_code || 'gitlab.default'),
    ref: typeof query.ref === 'string' ? query.ref : undefined
  })

  return { code: 0, data }
})

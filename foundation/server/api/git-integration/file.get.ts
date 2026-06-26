import { getGitRepositoryFile } from '../../utils/gitIntegration'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const data = await getGitRepositoryFile({
    projectCode: String(query.projectCode || query.project_code || ''),
    repoUrl: String(query.repoUrl || query.repo_url || ''),
    repoPath: String(query.repoPath || query.repo_path || ''),
    integrationCode: String(query.integrationCode || query.integration_code || 'gitlab.default'),
    path: String(query.path || ''),
    ref: typeof query.ref === 'string' ? query.ref : undefined,
    commitId: typeof query.commit_id === 'string' ? query.commit_id : typeof query.commitId === 'string' ? query.commitId : undefined
  })

  return { code: 0, data }
})

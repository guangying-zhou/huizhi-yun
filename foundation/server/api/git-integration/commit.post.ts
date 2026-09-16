import { createGitCommit } from '../../utils/gitIntegration'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const data = await createGitCommit({
    projectCode: String(body.projectCode || body.project_code || ''),
    repoUrl: String(body.repoUrl || body.repo_url || ''),
    repoPath: String(body.repoPath || body.repo_path || ''),
    integrationCode: String(body.integrationCode || body.integration_code || 'gitlab.default'),
    branch: typeof body.branch === 'string' ? body.branch : undefined,
    commitMessage: String(body.commitMessage || body.commit_message || ''),
    actions: Array.isArray(body.actions) ? body.actions : [],
    authorName: typeof body.authorName === 'string' ? body.authorName : typeof body.author_name === 'string' ? body.author_name : undefined,
    authorEmail: typeof body.authorEmail === 'string' ? body.authorEmail : typeof body.author_email === 'string' ? body.author_email : undefined
  })

  return { code: 0, message: 'success', data }
})

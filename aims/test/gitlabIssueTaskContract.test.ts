import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Aims GitLab Issue and external task contracts', () => {
  test('exports only runtime-validated work item facts through the fixed GitLab operation', () => {
    const handler = source('server/api/v1/projects/[id]/sync-gitlab-issues.post.ts')
    const middleware = source('server/middleware/tenant-runtime.ts')

    assert.match(handler, /buildAimsProjectRuntimeAccessQuery/)
    assert.match(handler, /gitlab-issue-sync-context/)
    assert.match(handler, /upsertGitIssue/)
    assert.match(handler, /repoPath:\s*context\.repoProjectCode/)
    assert.doesNotMatch(handler, /projectCode:\s*context\.repoProjectCode/)
    assert.match(handler, /createHash\('sha256'\)/)
    assert.match(handler, /gitlab-issue-links\/ingest/)
    assert.doesNotMatch(handler, /PRIVATE-TOKEN|resolveIntegrationSecret|server\/utils\/db/)
    assert.match(middleware, /sync-gitlab-issues/)
  })

  test('protects the task feed with the exact read capability and no caller whitelist', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')
    assert.match(middleware, /suffix === '\/service\/tasks'/)
    assert.match(middleware, /scope: 'aims:tasks:read'/)
    const taskRequirement = middleware.match(/if \(method === 'GET' && suffix === '\/service\/tasks'\) \{[\s\S]*?\n[ ]{2}\}/)?.[0] || ''
    assert.match(taskRequirement, /scope: 'aims:tasks:read'/)
    assert.doesNotMatch(taskRequirement, /allowedApps/)
  })

  test('keeps the GitLab link schema normalized and repository-bound', () => {
    const schema = source('docs/aims_schema.sql')
    assert.match(schema, /CREATE TABLE IF NOT EXISTS `gitlab_issue_links`/)
    assert.match(schema, /UNIQUE KEY `uk_gitlab_issue_work_item_repo`/)
    assert.match(schema, /FOREIGN KEY \(`project_id`, `repo_project_code`\) REFERENCES `aims_project_repos`/)
  })
})

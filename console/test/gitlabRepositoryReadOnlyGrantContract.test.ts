import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const seed = read('../docs/sql/Console-SQL-Seed-v2.35-gitlab-repository-read-only-candidate.sql')
const verify = read('../docs/sql/Console-SQL-Verify-v2.35-gitlab-repository-read-only-candidate.sql')
const runtimeRoute = read('../../data-runtime/internal/server/server.go')
const runtimeOperations = read('../../data-runtime/internal/apps/console/gitlab_operations.go')
const foundationGit = read('../../foundation/server/utils/gitIntegration.ts')

// Document asset design DOC-01: GitLab repository content is read-only in the platform.
describe('GitLab repository operations are read-only', () => {
  test('the candidate seed only withdraws the two repository write operations', () => {
    for (const operation of ['gitlab.commit', 'gitlab.resolve-actions']) {
      assert.match(seed, new RegExp(`JSON_SEARCH\\(\`scope_json\`, 'one', '${operation.replace('.', '\\.')}'`))
      assert.match(verify, new RegExp(`'${operation.replace('.', '\\.')}'`))
    }
    // Never deletes, re-activates or broadens a grant, and never touches other operations.
    const statements = seed.replace(/^--.*$/gm, '')
    assert.doesNotMatch(statements, /\bDELETE\b|\bINSERT\b|`status`\s*=/i)
    for (const kept of ['gitlab.issue-upsert', 'gitlab.file', 'gitlab.commits', 'wecom.']) {
      assert.doesNotMatch(statements, new RegExp(kept.replace('.', '\\.')))
    }
    assert.doesNotMatch(verify.replace(/^--.*$/gm, ''), /\b(UPDATE|DELETE|INSERT)\b/i)
  })

  test('Runtime no longer enumerates or implements repository writes', () => {
    assert.doesNotMatch(runtimeRoute, /"commit": true|"resolve-actions": true/)
    assert.match(runtimeRoute, /"issue-upsert": true/)
    assert.doesNotMatch(runtimeOperations, /createCommit|resolveActions|normalizeGitLabActions|repository\/commits"/)
  })

  test('Foundation exposes no generic GitLab HTTP endpoint and no commit helper', () => {
    for (const route of ['commit.post', 'commits.get', 'commit-diff.get', 'file.get', 'markdown-tree.get']) {
      assert.equal(existsSync(new URL(`../../foundation/server/api/git-integration/${route}.ts`, import.meta.url)), false, route)
    }
    assert.doesNotMatch(foundationGit, /createGitCommit|resolveGitCommitActions|'commit'|'resolve-actions'/)
    assert.equal(existsSync(new URL('../../codocs/server/api/project-docs/gitlab-submit/[...projectCode].post.ts', import.meta.url)), false)
  })
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const source = readFileSync(
  new URL('../server/utils/gitIntegration.ts', import.meta.url),
  'utf8'
)

describe('GitLab fixed Tenant Runtime operations', () => {
  test('never resolves or attaches the GitLab credential in Foundation', () => {
    assert.match(source, /integration_operations:execute/)
    assert.match(source, /serviceTokenSourceBinding: 'service-client-policy'/)
    assert.match(source, /\/gitlab\/\$\{operation\}/)
    assert.doesNotMatch(source, /getGitLabRuntimeConfig|resolveIntegrationSecret|PRIVATE-TOKEN|accessKeySecret/)
    assert.doesNotMatch(source, /\$fetch\s*</)
  })

  test('exposes only the enumerated semantic operation set', () => {
    for (const operation of [
      'project-info',
      'group-projects',
      'commits',
      'commit-diff',
      'markdown-tree',
      'file',
      'commit',
      'issue-upsert',
      'resolve-actions'
    ]) {
      assert.match(source, new RegExp(`['"]${operation}['"]`))
    }
  })

  test('group project listing stays behind the fixed operation boundary and requests the complete catalog', () => {
    assert.match(source, /export async function listGitGroupProjects/)
    assert.match(source, /'group-projects'/)
    assert.match(source, /repoPath: groupPath/)
    assert.match(source, /includeArchived: input\.includeArchived !== false/)
  })

  test('keeps the verified request context when resolving a repository from Directory', () => {
    const resolver = source.slice(
      source.indexOf('async function resolveRepoPath'),
      source.indexOf('async function callGitLabFixedOperation')
    )

    assert.match(resolver, /const event = useEvent\(\)/)
    assert.match(
      resolver,
      /fetchConsoleDirectoryApi<ConsoleProjectResponse>\(\s*`\/projects\/\$\{encodeURIComponent\(projectCode\)\}`\s*,\s*\{ event \}\s*\)/s
    )
  })
})

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { extractGitLabProjectPath } from '../server/utils/gitlabProjectPath.ts'

describe('extractGitLabProjectPath', () => {
  test('accepts standard GitLab clone URLs', () => {
    assert.equal(extractGitLabProjectPath('https://gitlab.example.com/hzy/platform.git'), 'hzy/platform')
    assert.equal(extractGitLabProjectPath('https://gitlab.example.com/hzy/platform.git/'), 'hzy/platform')
    assert.equal(extractGitLabProjectPath('git@gitlab.example.com:hzy/platform.git'), 'hzy/platform')
    assert.equal(extractGitLabProjectPath('ssh://git@gitlab.example.com/hzy/platform.git'), 'hzy/platform')
  })

  test('normalizes GitLab page URLs to the owning project path', () => {
    assert.equal(extractGitLabProjectPath('https://gitlab.example.com/hzy/platform/-/releases'), 'hzy/platform')
    assert.equal(extractGitLabProjectPath('https://gitlab.example.com/hzy/platform/-/tree/main'), 'hzy/platform')
    assert.equal(extractGitLabProjectPath('https://gitlab.example.com/hzy/platform/-/blob/main/app.manifest.json'), 'hzy/platform')
  })

  test('accepts host paths, bare project paths, and stored source endpoints', () => {
    assert.equal(extractGitLabProjectPath('gitlab.example.com/hzy/platform/-/tags'), 'hzy/platform')
    assert.equal(extractGitLabProjectPath('hzy/platform'), 'hzy/platform')
    assert.equal(extractGitLabProjectPath('gitlab:https://gitlab.example.com/hzy/platform.git#abc123:app.manifest.json'), 'hzy/platform')
  })

  test('rejects non-project values', () => {
    assert.equal(extractGitLabProjectPath(''), null)
    assert.equal(extractGitLabProjectPath('https://gitlab.example.com/hzy'), null)
    assert.equal(extractGitLabProjectPath('not-a-project'), null)
  })
})

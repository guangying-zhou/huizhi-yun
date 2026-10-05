import test from 'node:test'
import assert from 'node:assert/strict'
import { selectGitLabFields } from '../configure-platform-gitlab.mjs'

test('GitLab reuse selects only required fields on the intended HTTPS origin', () => {
  assert.deepEqual(selectGitLabFields({ GITLAB_BASE_URL: 'https://gitlab.wiztek.cn/', GITLAB_BOT_TOKEN: ' fixture ',
    DB_PASSWORD: 'unrelated', GITLAB_BOT_EMAIL: 'unused', GITLAB_BOT_USERNAME: 'unused' }), {
    GITLAB_BASE_URL: 'https://gitlab.wiztek.cn', GITLAB_BOT_TOKEN: 'fixture'
  })
})
test('GitLab reuse rejects absent credentials, HTTP, credentials in URL and other origins', () => {
  for (const url of ['http://gitlab.wiztek.cn', 'https://gitlab.wiztek.cn.evil.test', 'https://user:password@gitlab.wiztek.cn', '']) {
    assert.throws(() => selectGitLabFields({ GITLAB_BASE_URL: url, GITLAB_BOT_TOKEN: 'fixture' }))
  }
  assert.throws(() => selectGitLabFields({ GITLAB_BASE_URL: 'https://gitlab.wiztek.cn', GITLAB_BOT_TOKEN: ' ' }))
})

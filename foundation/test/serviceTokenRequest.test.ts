import assert from 'node:assert/strict'
import test from 'node:test'
import { executeServiceTokenRequest } from '../server/utils/serviceTokenRequest.ts'

const statusCode = (error: unknown) => Number((error as { statusCode?: number })?.statusCode || 0)

test('a cached token rejected with 401 is refreshed exactly once', async () => {
  const refreshes: boolean[] = []
  const attemptedTokens: string[] = []
  const result = await executeServiceTokenRequest({
    async getToken(forceRefresh) {
      refreshes.push(forceRefresh)
      return forceRefresh ? 'current-token' : 'rotated-token'
    },
    async request(token) {
      attemptedTokens.push(token)
      if (token === 'rotated-token') throw { statusCode: 401 }
      return 'ok'
    },
    statusCode
  })

  assert.equal(result, 'ok')
  assert.deepEqual(refreshes, [false, true])
  assert.deepEqual(attemptedTokens, ['rotated-token', 'current-token'])
})

test('a second 401 is terminal and never loops', async () => {
  let requests = 0
  await assert.rejects(() => executeServiceTokenRequest({
    async getToken(forceRefresh) { return forceRefresh ? 'fresh-token' : 'cached-token' },
    async request() {
      requests += 1
      throw { statusCode: 401, code: 'grant_revoked' }
    },
    statusCode
  }))
  assert.equal(requests, 2)
})

test('non-401 failures do not refresh credentials', async () => {
  const refreshes: boolean[] = []
  await assert.rejects(() => executeServiceTokenRequest({
    async getToken(forceRefresh) {
      refreshes.push(forceRefresh)
      return 'token'
    },
    async request() { throw { statusCode: 503 } },
    statusCode
  }))
  assert.deepEqual(refreshes, [false])
})

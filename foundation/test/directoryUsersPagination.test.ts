import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DIRECTORY_RUNTIME_MAX_PAGE_SIZE,
  fetchPaginatedDirectoryUsers,
  type DirectoryUsersEnvelope
} from '../server/utils/directoryUsersPagination'

interface User {
  uid: string
}

function directoryFetcher(total: number, calls: Record<string, unknown>[]) {
  const users = Array.from({ length: total }, (_, index) => ({ uid: `user-${index + 1}` }))

  return async (params: Record<string, unknown>): Promise<DirectoryUsersEnvelope<User>> => {
    calls.push(params)
    const page = Number(params.page || 1)
    const pageSize = Number(params.pageSize || 20)
    const offset = (page - 1) * pageSize
    return {
      code: 0,
      data: {
        items: users.slice(offset, offset + pageSize),
        total,
        page,
        pageSize,
        tree: []
      }
    }
  }
}

test('directory user BFF preserves ordinary runtime-sized requests', async () => {
  const calls: Record<string, unknown>[] = []
  const response = await fetchPaginatedDirectoryUsers(
    { search: 'Gavin', pageSize: 80 },
    directoryFetcher(120, calls)
  )

  assert.deepEqual(calls, [{ search: 'Gavin', pageSize: 80 }])
  assert.equal(Array.isArray(response.data) ? 0 : response.data?.items?.length, 80)
})

test('directory user BFF combines larger display-name lookup windows using 100-row runtime pages', async () => {
  const calls: Record<string, unknown>[] = []
  const response = await fetchPaginatedDirectoryUsers(
    { dept_code: 'R&D', pageSize: 500 },
    directoryFetcher(230, calls)
  )
  const data = Array.isArray(response.data) ? undefined : response.data

  assert.deepEqual(calls.map(call => call.page), [1, 2, 3])
  assert.ok(calls.every(call => call.pageSize === DIRECTORY_RUNTIME_MAX_PAGE_SIZE))
  assert.ok(calls.every(call => call.dept_code === 'R&D'))
  assert.equal(data?.items?.length, 230)
  assert.equal(data?.page, 1)
  assert.equal(data?.pageSize, 500)
  assert.equal(data?.items?.[0]?.uid, 'user-1')
  assert.equal(data?.items?.[229]?.uid, 'user-230')
})

test('directory user BFF keeps large-page offsets correct across runtime pages', async () => {
  const calls: Record<string, unknown>[] = []
  const response = await fetchPaginatedDirectoryUsers(
    { page: 2, pageSize: 150 },
    directoryFetcher(325, calls)
  )
  const data = Array.isArray(response.data) ? undefined : response.data

  assert.deepEqual(calls.map(call => call.page), [2, 3])
  assert.equal(data?.items?.length, 150)
  assert.equal(data?.items?.[0]?.uid, 'user-151')
  assert.equal(data?.items?.[149]?.uid, 'user-300')
})

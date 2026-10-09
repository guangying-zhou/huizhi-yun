import assert from 'node:assert/strict'
import test from 'node:test'
import { hostedWorkItemCreator } from '../app/utils/hostedWorkItemCreate'

test('lost response reuses persisted key and produces one owning creation', async () => {
  const stored = new Map<string, string>(), seen = new Set<string>()
  const storage = { getItem: (key: string) => stored.get(key) || null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) } as Storage
  let lost = true
  const headers: string[] = []
  const request: Parameters<typeof hostedWorkItemCreator>[0] = async (_, options) => {
    if (!options) return { code: 0, data: { id: 17, title: 'draft' } }
    assert.equal(options.retry, 0)
    const key = options.headers['Idempotency-Key']!
    headers.push(key)
    seen.add(key)
    if (lost) {
      lost = false
      throw Error('response lost after commit')
    }
    return { code: 0, data: { result: { id: '17' } } }
  }
  await assert.rejects(hostedWorkItemCreator(request, () => storage)('session-a', 263, { title: 'private draft' }))
  assert.equal(stored.size, 1)
  assert.ok(!JSON.stringify([...stored]).includes('private draft'))
  assert.equal((await hostedWorkItemCreator(request, () => storage)('session-a', 263, { title: 'private draft' })).id, 17)
  assert.equal(new Set(headers).size, 1)
  assert.equal(seen.size, 1)
  assert.equal(stored.size, 0)
})

test('same concurrent command coalesces; session/project/input isolate keys', async () => {
  const keys: string[] = []
  const create = hostedWorkItemCreator(async (_, options) => {
    if (options) {
      keys.push(options.headers['Idempotency-Key']!)
      return { code: 0, data: { result: { id: 1 } } }
    }
    return { code: 0, data: { id: 1 } }
  }, () => undefined)
  await Promise.all([create('a', 263, { title: 'x' }), create('a', 263, { title: 'x' })])
  assert.equal(keys.length, 1)
  await create('b', 263, { title: 'x' })
  await create('a', 264, { title: 'x' })
  await create('a', 263, { title: 'y' })
  assert.equal(new Set(keys).size, 4)
})

test('storage failure falls back to memory and invalid receipt/details retain key', async () => {
  const keys: string[] = []
  let stage = 0
  const create = hostedWorkItemCreator(async (_, options) => {
    if (options) {
      keys.push(options.headers['Idempotency-Key']!)
      return stage++ === 0 ? { code: 0, data: { result: {} } } : { code: 0, data: { result: { id: 2 } } }
    }
    if (stage === 2) throw Error('detail unavailable')
    return { code: 0, data: { id: 2 } }
  }, () => { throw Error('storage denied') })
  await assert.rejects(create('a', 263, {}))
  await assert.rejects(create('a', 263, {}))
  await create('a', 263, {})
  assert.equal(new Set(keys).size, 1)
})

test('store uses the Host receipt transport only inside Enterprise and deduplicates replayed items', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../app/stores/workItem.ts', import.meta.url), 'utf8')
  const create = source.slice(source.indexOf('async function createItem'), source.indexOf('async function updateItem'))
  assert.match(create, /hosted\s*\?\s*\{ code: 0, data: await createHostedItem\(cacheKey\('commands'\)/u)
  assert.match(create, /:\s*await \$fetch[\s\S]*?\{ method: 'POST', body: data \}/u)
  assert.match(create, /hosted \? items\.value\.findIndex/u)
})

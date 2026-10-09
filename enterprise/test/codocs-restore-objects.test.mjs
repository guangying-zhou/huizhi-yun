import test from 'node:test'
import assert from 'node:assert/strict'
import { copyRestoreObjects, logRestoreStorageFailure } from '../server/utils/codocsRestoreObjects.ts'

const messages = { unavailable: '存储暂不可用', notFound: '不存在' }
const plan = { source_path: 'recycle.bin/document-creations/secret-doc/body.md', target_path: 'codocs/document-restores/secret-doc/hash.md' }
const notFound = () => Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey', statusCode: 404 })

function fakeStorage({ objects = {}, failOn = {}, delay = 0 } = {}) {
  const store = new Map(Object.entries(objects))
  const calls = []
  let active = 0
  let maxActive = 0
  const enter = async (method, key) => {
    calls.push(`${method}:${key}`)
    active++
    maxActive = Math.max(maxActive, active)
    if (delay)
      await new Promise(resolve => setTimeout(resolve, delay))
    active--
    const failure = failOn[`${method}:${key.endsWith('.yjs') ? 'yjs' : 'md'}`]
    if (failure)
      throw failure
  }
  return {
    calls, store, get maxActive() {
      return maxActive
    },
    client: {
      async head(key) {
        await enter('head', key)
        if (!store.has(key))
          throw notFound()
        return {}
      },
      async get(key) {
        await enter('get', key)
        if (!store.has(key))
          throw notFound()
        return { content: store.get(key) }
      },
      async put(key, body, options) {
        await enter('put', key)
        assert.equal(options.forbidOverwrite, true)
        if (store.has(key))
          throw Object.assign(new Error('exists'), { statusCode: 409 })
        store.set(key, body)
        return {}
      }
    }
  }
}

test('markdown and CRDT snapshot copy in parallel and never delete the source', async () => {
  const storage = fakeStorage({ objects: { [plan.source_path]: Buffer.from('md'), [plan.source_path.replace('.md', '.yjs')]: Buffer.from('yjs') }, delay: 20 })
  await copyRestoreObjects(async () => storage.client, plan, messages)
  assert.ok(storage.maxActive >= 2, 'the two object paths must overlap')
  assert.ok(storage.store.has(plan.target_path) && storage.store.has(plan.target_path.replace('.md', '.yjs')))
  assert.ok(storage.store.has(plan.source_path), 'source remains')
  assert.ok(storage.calls.every(call => /^(head|get|put):/.test(call)), 'copy-only: no delete calls')
})

test('any failed path aborts before commit, logs a fixed code, and a same-plan retry is idempotent', async () => {
  const yjsSource = plan.source_path.replace('.md', '.yjs')
  const objects = { [plan.source_path]: Buffer.from('md'), [yjsSource]: Buffer.from('yjs') }
  for (const [failOn, code, object, cause] of [
    [{ 'put:yjs': Object.assign(new Error('secret-key-material write failed'), { statusCode: 500 }) }, 'codocs_restore_storage_put_failed', 'yjs', 'http_500'],
    [{ 'get:md': Object.assign(new Error('Object storage request timed out after 8000ms: GET recycle.bin/x'), {}) }, 'codocs_restore_storage_get_failed', 'md', 'timeout'],
    [{ 'head:yjs': Object.assign(new Error('connect'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }) }, 'codocs_restore_storage_head_failed', 'yjs', 'timeout']
  ]) {
    const first = fakeStorage({ objects: { ...objects }, failOn })
    const logs = []
    await assert.rejects(() => copyRestoreObjects(async () => first.client, plan, messages, line => logs.push(line)), error => error.statusCode === 503 && error.message === messages.unavailable)
    assert.ok(logs.some(line => JSON.parse(line).code === code && JSON.parse(line).object === object && JSON.parse(line).cause === cause), `${code}: ${logs}`)
    for (const line of logs)
      assert.doesNotMatch(line, /secret|recycle\.bin|document-restores|Bearer|hash/i)
    // Same plan again with a healthy backend and whatever the first attempt already wrote.
    const retry = fakeStorage({ objects: Object.fromEntries(first.store) })
    await copyRestoreObjects(async () => retry.client, plan, messages)
    assert.ok(retry.store.has(plan.target_path) && retry.store.has(plan.target_path.replace('.md', '.yjs')))
  }
})

test('missing sources are only an error when neither object exists; a missing snapshot alone is fine', async () => {
  const onlyMarkdown = fakeStorage({ objects: { [plan.source_path]: Buffer.from('md') } })
  await copyRestoreObjects(async () => onlyMarkdown.client, plan, messages)
  assert.ok(onlyMarkdown.store.has(plan.target_path))
  const nothing = fakeStorage()
  await assert.rejects(() => copyRestoreObjects(async () => nothing.client, plan, messages), error => error.statusCode === 404 && error.message === messages.notFound)
  // A stable in-place plan only confirms existence.
  const stable = fakeStorage({ objects: { 'codocs/a/body.md': Buffer.from('md') } })
  await copyRestoreObjects(async () => stable.client, { source_path: 'codocs/a/body.md', target_path: 'codocs/a/body.md' }, messages)
  assert.deepEqual(stable.calls.filter(call => call.startsWith('put') || call.startsWith('get')), [])
})

test('a lost race winner that cannot be confirmed does not commit, and client creation failures are logged', async () => {
  const yjsSource = plan.source_path.replace('.md', '.yjs')
  const racing = fakeStorage({ objects: { [plan.source_path]: Buffer.from('md'), [yjsSource]: Buffer.from('yjs') } })
  const originalPut = racing.client.put
  racing.client.put = async (key) => {
    racing.store.delete(key)
    throw Object.assign(new Error('exists'), { statusCode: 409 })
  }
  const logs = []
  await assert.rejects(() => copyRestoreObjects(async () => racing.client, plan, messages, line => logs.push(line)), error => error.statusCode === 503)
  assert.ok(logs.some(line => JSON.parse(line).code === 'codocs_restore_storage_confirm_failed'))
  void originalPut
  const clientLogs = []
  await assert.rejects(() => copyRestoreObjects(async () => {
    throw new Error('credentials unavailable')
  }, plan, messages, line => clientLogs.push(line)), error => error.statusCode === 503)
  assert.deepEqual(clientLogs.map(line => JSON.parse(line).code), ['codocs_restore_storage_client_failed'])
  assert.doesNotMatch(clientLogs.join(''), /credentials/)
})

test('log helper only emits its fixed vocabulary', () => {
  const lines = []
  logRestoreStorageFailure('get', 'md', Object.assign(new Error('Bearer abc recycle.bin/key'), { status: 403 }), line => lines.push(line))
  assert.deepEqual(JSON.parse(lines[0]), { event: 'codocs-restore-storage-failed', code: 'codocs_restore_storage_get_failed', object: 'md', cause: 'http_403' })
})

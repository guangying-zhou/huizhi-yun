import assert from 'node:assert/strict'
import test from 'node:test'
import { copyQuickPublishDocument, type QuickPublishStorage } from '../server/utils/companyAssetQuickPublish.ts'

const item = { sourceUuid: 'source', sourcePath: 'codocs/departments/A/a.md', title: 'A', newUuid: 'new', ossPath: 'codocs/company/rules/a-new.md' }
const copied = { meta: { 'quick-publish-operation': 'operation', 'quick-publish-source': 'source' }, res: { headers: { 'etag': 'copied', 'content-length': '10' } } }
test('quick publish uploads a source snapshot and forbids overwrite', async () => {
  let calls = 0
  const client: QuickPublishStorage = {
    async head(path) {
      if (path === item.sourcePath) return { res: { headers: { etag: 'source-etag' } } }
      if (!calls) throw { status: 404 }
      return copied
    },
    async get() { return { content: Buffer.from('snapshot'), res: { headers: { etag: 'source-etag' } } } },
    async put(target, source, options) {
      calls++
      assert.equal(target, item.ossPath)
      assert.equal(source.toString(), 'snapshot')
      assert.equal(options.forbidOverwrite, true)
      assert.equal(options.headers['x-oss-forbid-overwrite'], undefined)
      assert.equal(options.headers['if-none-match'], undefined)
      assert.equal(options.meta['quick-publish-source-etag'], 'source-etag')
      assert.equal(options.meta['quick-publish-operation'], 'operation')
    }
  }
  assert.equal((await copyQuickPublishDocument(client, 'operation', item)).size, 10)
  assert.equal(calls, 1)
  await copyQuickPublishDocument(client, 'operation', item)
  assert.equal(calls, 1)
})
test('existing unrelated object is never overwritten', async () => {
  const client: QuickPublishStorage = {
    async head() { return { ...copied, meta: {} } },
    async get() { assert.fail('must not read') },
    async put() { assert.fail('must not overwrite') }
  }
  await assert.rejects(copyQuickPublishDocument(client, 'operation', item), { statusCode: 409 })
})
test('storage faults fail closed without copying', async () => {
  const client: QuickPublishStorage = {
    async head() { throw new Error('storage offline') },
    async get() { assert.fail('must not read') },
    async put() { assert.fail('must not copy after unknown destination state') }
  }
  await assert.rejects(copyQuickPublishDocument(client, 'operation', item), /storage offline/)
})
test('failed conditional upload does not return publication evidence', async () => {
  const client: QuickPublishStorage = {
    async head() { throw { status: 404 } },
    async get() { return { content: Buffer.from('snapshot'), res: { headers: { etag: 'snapshot-etag' } } } },
    async put(_target, content, options) {
      assert.equal(content.toString(), 'snapshot')
      assert.equal(options.forbidOverwrite, true)
      throw Object.assign(new Error('destination changed'), { status: 412 })
    }
  }
  await assert.rejects(copyQuickPublishDocument(client, 'operation', item), { status: 412 })
})

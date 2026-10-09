import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { publishedAssetPagePath } from '../shared/utils/publishedAssetLink.ts'

function compile(path: string) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
}

const notifyCode = compile('../server/utils/reviewNotify.ts')
const appUrlsCode = compile('../../foundation/server/utils/appUrls.ts')
type Notification = { url: string, touser: string[], idempotencyKey: string, bizId: string }

function harness(members = ['U001', 'U002', 'U001']) {
  const event = { origin: 'https://wiztek.huizhi.yun' }
  const sent: Notification[] = []
  const queries: string[] = []
  const appUrls: Record<string, unknown> = {}
  runInNewContext(appUrlsCode, {
    exports: appUrls,
    process: { env: {} },
    URL,
    useRuntimeConfig: () => ({ public: { appBasePath: '/codocs' } }),
    require: (id: string) => {
      assert.equal(id, 'h3')
      return {
        getHeader: () => '',
        getRequestURL: (input: unknown) => {
          assert.equal(input, event)
          return new URL(event.origin)
        }
      }
    }
  })
  const exports: Record<string, (...args: unknown[]) => Promise<void>> = {}
  runInNewContext(notifyCode, {
    exports,
    URL,
    console: { warn: () => {} },
    useRuntimeConfig: () => ({ public: { siteUrl: 'https://old.example' } }),
    sendNotification: async (notification: Notification) => sent.push(notification),
    require: (id: string) => {
      if (id === './accountPermissions') return {}
      if (id === '@hzy/foundation/server/utils/appUrls') return appUrls
      if (id === '~~/shared/utils/publishedAssetLink') return { publishedAssetPagePath }
      if (id === './directoryCompat') return {
        fetchDirectoryData: async (path: string, options: { event: unknown }) => {
          assert.equal(options.event, event)
          queries.push(path)
          return { items: members.map(uid => ({ uid })) }
        }
      }
      if (id === './codocsNotificationBuilders') return {
        buildCodocsNotification: (input: unknown) => input,
        codocsNotificationIdempotencyKey: (...args: unknown[]) => args.join(':')
      }
      throw new Error(`Unexpected import ${id}`)
    }
  })
  return {
    sent,
    queries,
    notify: (scope: string, category: string, path: string, deptCode?: string) =>
      exports.notifyPublished!(scope, '测试制度', category, 'doc-001', deptCode, { event, archiveOssPath: path })
  }
}

test('published company notifications preserve tenant origin, app prefix and encoded document path', async () => {
  const h = harness()
  const path = 'codocs/company/rules/制度/人事 + 100% #问?.md'
  await h.notify('company', '公司制度', path)
  assert.equal(h.sent.length, 1)
  const notification = h.sent[0]!
  const url = new URL(notification.url)
  assert.equal(url.origin, 'https://wiztek.huizhi.yun')
  assert.equal(url.pathname, '/codocs/company/document')
  assert.equal(url.searchParams.get('path'), path)
  assert.equal(url.hash, '')
  assert.deepEqual([...notification.touser], ['U001', 'U002'])
  assert.deepEqual(h.queries, ['/users'])
  assert.equal(notification.bizId, 'doc-001')
  assert.equal(notification.idempotencyKey, 'document-published:doc-001:公司制度:company')
})

test('department notifications keep department recipients and select the department reader', async () => {
  const h = harness()
  const path = 'codocs/departments/GMO/outsides/发文.md'
  await h.notify('department', '对外发文', path, 'GMO')
  const url = new URL(h.sent[0]!.url)
  assert.equal(url.pathname, '/codocs/departments/document')
  assert.equal(url.searchParams.get('path'), path)
  assert.deepEqual(h.queries, ['/departments/GMO/members'])
})

test('missing or unsupported published paths retain category fallback under the current tenant', async () => {
  for (const path of ['', 'codocs/archives/company/rules/已归档.md', '../secret']) {
    const h = harness()
    await h.notify('company', '技术规范', path)
    assert.equal(h.sent[0]!.url, 'https://wiztek.huizhi.yun/codocs/company/tech-specs')
  }
})

test('missing department and empty recipients still skip notifications', async () => {
  const missingDept = harness()
  await missingDept.notify('department', '部门规章', 'codocs/departments/GMO/rules/a.md')
  assert.equal(missingDept.sent.length, 0)
  assert.equal(missingDept.queries.length, 0)
  const noMembers = harness([])
  await noMembers.notify('company', '公司制度', 'codocs/company/rules/a.md')
  assert.equal(noMembers.sent.length, 0)
})

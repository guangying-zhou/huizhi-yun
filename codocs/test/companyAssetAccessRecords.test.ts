import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

type Row = Record<string, unknown>
// The VM loads both handlers and synchronous CSV exports dynamically.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...args: any[]) => any

function load(path: string, dependencies: Record<string, unknown>, globals: Row = {}) {
  const exports: Record<string, Fn> = {}
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`)
      return dependencies[name]
    },
    crypto: { randomUUID: () => 'server-generated-event-id' },
    ...globals
  })
  return exports
}

function failure(statusCode: number, message = 'failure') {
  return Object.assign(new Error(message), { statusCode })
}

function recordsHarness(denied?: string, items: Row[] = [], directoryUsers: Row[] = []) {
  const calls: Row[] = []
  const directoryCalls: Row[] = []
  const permissions: string[] = []
  const event = { context: { consoleAuth: { uid: 'U001', authenticated: true } } }
  const api = load('../server/utils/companyAssetAccessRecords.ts', {
    'h3': { createError: ({ statusCode, message }: { statusCode: number, message: string }) => failure(statusCode, message) },
    '@hzy/foundation/server/utils/directoryApi': { fetchConsoleDirectoryApi: async (path: string, options: Row) => {
      assert.equal(options.event, event)
      directoryCalls.push({ path, ...options })
      if (denied === 'directory') throw failure(500, 'internal-directory-secret')
      if (denied === 'directory:forbidden') throw failure(403)
      const uids = String((options.params as Row).uids).split(',')
      assert.ok(uids.length <= 100)
      return { code: 0, data: directoryUsers.filter(user => uids.includes(String(user.uid))) }
    } },
    './assetOssPath': { normalizeCompanyAssetOssPath: (path: string) => path },
    './checkPermission': { requirePermission: async (input: unknown, resource: string, action: string) => {
      assert.equal(input, event)
      permissions.push(`${resource}:${action}`)
      if (`${resource}:${action}` === denied) throw failure(403)
    } },
    './codocsRuntime': { callCodocsTenantRuntime: async (input: unknown, path: string, options: Row) => {
      assert.equal(input, event)
      calls.push({ path, ...options })
      if (denied === 'runtime') throw failure(500, 'internal-storage-secret')
      return { items, total: items.length, page: 1, pageSize: 20 }
    } }
  })
  return { api, calls, directoryCalls, permissions, event }
}

test('asset record reads require both administrator grants, with separate explicit export', async () => {
  for (const denied of ['admin:admin', 'company:admin', 'company:export']) {
    const h = recordsHarness(denied)
    await assert.rejects(h.api.listCompanyAssetAccessRecords!(h.event, { path: 'codocs/company/a.md' }, true), { statusCode: 403 })
    assert.equal(h.calls.length, 0)
    assert.equal(h.directoryCalls.length, 0)
  }
  const h = recordsHarness()
  await h.api.listCompanyAssetAccessRecords!(h.event, { path: 'codocs/company/a.md' }, true)
  assert.deepEqual(h.permissions, ['admin:admin', 'company:admin', 'company:export'])
  assert.equal(h.calls[0]?.path, '/v1/codocs/company-assets/access-records/export')
})

test('record query allowlist removes forged actors and authorization; filters survive', async () => {
  const h = recordsHarness()
  await h.api.listCompanyAssetAccessRecords!(h.event, {
    path: 'codocs/company/a.md', page: '2', pageSize: '25', from: '2026-09-10', to: '2026-09-10',
    viewerUid: 'victim', current_user: 'victim', hzy_runtime_actor_delegated: '1',
    codocs_trusted_company_asset_access_action: 'export'
  })
  const query = h.calls[0]!.query as Row
  assert.equal(query.page, 2)
  assert.equal(query.from, '2026-09-10')
  assert.equal(query.codocs_trusted_company_asset_access_action, 'list')
  assert.equal(query.viewerUid, undefined)
  assert.equal(query.current_user, undefined)
  assert.equal(query.hzy_runtime_actor_delegated, undefined)
})

test('invalid and reversed dates or oversized pages fail before runtime', async () => {
  for (const query of [{ from: '2026-02-30' }, { from: '2026-09-11', to: '2026-09-10' }, { pageSize: 101 }, { page: 0 }]) {
    const h = recordsHarness()
    await assert.rejects(h.api.listCompanyAssetAccessRecords!(h.event, { path: 'codocs/company/a.md', ...query }), { statusCode: 400 })
    assert.equal(h.calls.length, 0)
  }
})

test('recording uses server-generated event ID and safe retryable error on failure', async () => {
  const h = recordsHarness()
  await h.api.recordCompanyAssetAccess!(h.event, 'codocs/company/a.md')
  assert.equal(h.calls[0]?.method, 'POST')
  assert.equal((h.calls[0]!.query as Row).eventId, 'server-generated-event-id')
  const failed = recordsHarness('runtime')
  await assert.rejects(failed.api.recordCompanyAssetAccess!(failed.event, 'codocs/company/a.md'), {
    statusCode: 503, message: '查看记录暂时无法保存，请稍后重试'
  })
})

test('CSV is Excel-compatible and protects formulas without breaking quoting', () => {
  const h = recordsHarness()
  const csv = h.api.companyAssetAccessRecordsCsv!([{ id: '1', viewerUid: '=HYPERLINK("bad")', viewedAt: '2026-09-10T00:00:00Z', ossPath: 'codocs/company/a,"b".md' }])
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'))
  assert.ok(csv.includes('"codocs/company/a,""b"".md"'))
})

test('CSV export resolves Chinese names in the authorized request and retains unknown UIDs', async () => {
  const items = ['U001', 'U001', 'deleted'].map((viewerUid, i) => ({
    id: String(i), viewerUid, viewedAt: '2026-09-10T00:00:00Z', ossPath: 'codocs/company/制度.md'
  }))
  const h = recordsHarness(undefined, items, [{ uid: 'U001', realName: '王敏' }])
  const result = await h.api.listCompanyAssetAccessRecords!(h.event, { path: items[0]!.ossPath }, true)
  assert.equal(h.directoryCalls.length, 1)
  assert.equal(h.directoryCalls[0]?.path, '/users')
  assert.equal((h.directoryCalls[0]!.params as Row).uids, 'U001,deleted')
  const csv = h.api.companyAssetAccessRecordsCsv!(result.items)
  assert.ok(csv.startsWith('\uFEFF"姓名","用户 UID","查看时间（UTC）","文档路径"\r\n'))
  assert.equal(csv.split('"王敏","U001"').length - 1, 2)
  assert.ok(csv.includes('"未匹配姓名","deleted"'))
  assert.ok(csv.includes('制度.md'))
})

test('name resolution batches unique users and skips ordinary lists and empty exports', async () => {
  const items = Array.from({ length: 102 }, (_, i) => ({ viewerUid: `U${i}`, id: String(i), viewedAt: '', ossPath: '' }))
  const h = recordsHarness(undefined, items)
  await h.api.listCompanyAssetAccessRecords!(h.event, { path: 'codocs/company/a.md' })
  assert.equal(h.directoryCalls.length, 0)
  await h.api.listCompanyAssetAccessRecords!(h.event, { path: 'codocs/company/a.md' }, true)
  assert.equal(h.directoryCalls.length, 2)
  assert.equal((h.directoryCalls[1]!.params as Row).uids, 'U100,U101')
  const empty = recordsHarness()
  await empty.api.listCompanyAssetAccessRecords!(empty.event, { path: 'codocs/company/a.md' }, true)
  assert.equal(empty.directoryCalls.length, 0)
})

test('directory failures do not silently export missing names or mask authorization denial', async () => {
  for (const [denied, statusCode] of [['directory', 503], ['directory:forbidden', 403]] as const) {
    const h = recordsHarness(denied, [{ viewerUid: 'U001' }])
    await assert.rejects(h.api.listCompanyAssetAccessRecords!(h.event, { path: 'codocs/company/a.md' }, true), { statusCode })
  }
})

test('CSV protects formulas and quoting in directory names as well as UIDs', () => {
  const h = recordsHarness()
  const csv = h.api.companyAssetAccessRecordsCsv!([{ viewerName: '=HYPERLINK("bad")', viewerUid: 'U001', viewedAt: '', ossPath: '' }])
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")","U001"'))
})

function previewHarness(options: { denied?: boolean, missing?: boolean, storageError?: object, pdf?: boolean, format?: string, recordFailure?: boolean } = {}) {
  const order: string[] = []
  const path = options.pdf ? 'codocs/company/a.pdf' : 'codocs/company/a.md'
  const deps = {
    '../../utils/oss': {
      getFileMetadata: async () => {
        order.push('metadata')
        return options.missing ? null : { size: 10 }
      },
      createRuntimeOSSClient: async () => ({ get: async (key: string) => {
        assert.equal(key, path)
        order.push('pdfBytes')
        if (options.storageError) throw options.storageError
        if (options.missing) throw Object.assign(new Error('missing'), { status: 404 })
        return { content: Buffer.from('%PDF-test') }
      } })
    },
    'h3': { setHeader: () => {} },
    '~~/server/utils/companyAssetAccessRecords': { recordCompanyAssetAccess: async () => {
      order.push('record')
      if (options.recordFailure) throw failure(503)
    } },
    '~~/server/utils/checkPermission': { requirePermission: async () => {
      order.push('permission')
      if (options.denied) throw failure(403)
    } },
    '~~/server/utils/assetOssPath': { normalizeCompanyAssetOssPath: (value: unknown) => value }
  }
  const api = load('../server/api/company-assets/preview.get.ts', deps, {
    defineEventHandler: (fn: Fn) => fn,
    getQuery: () => ({ path, format: options.format }),
    useRuntimeConfig: () => ({ app: { baseURL: '/codocs/' } }),
    createError: ({ statusCode, message }: { statusCode: number, message?: string }) => failure(statusCode, message),
    downloadDocument: async () => {
      order.push('download')
      return options.missing ? null : '# body'
    }
  })
  return { invoke: () => api.default!({ context: {} }), order }
}

test('text reads record access; PDF metadata returns a same-origin content URL without a duplicate record', async () => {
  for (const pdf of [false, true]) {
    const h = previewHarness({ pdf })
    const response = await h.invoke()
    assert.equal(response.code, 0)
    if (pdf) assert.equal(response.data.preview_url, '/codocs/api/company-assets/preview?format=pdf&path=codocs%2Fcompany%2Fa.pdf')
    assert.deepEqual(h.order, pdf ? ['permission', 'metadata'] : ['permission', 'download', 'record'])
    const missing = previewHarness({ missing: true, pdf })
    await assert.rejects(missing.invoke(), { statusCode: 404 })
    assert.ok(!missing.order.includes('record'))
  }
  const denied = previewHarness({ denied: true })
  await assert.rejects(denied.invoke(), { statusCode: 403 })
  assert.deepEqual(denied.order, ['permission'])
  const failed = previewHarness({ recordFailure: true })
  await assert.rejects(failed.invoke(), { statusCode: 503 })
})

test('PDF bytes require read permission, load successfully, then record once before responding', async () => {
  const h = previewHarness({ pdf: true, format: 'pdf' })
  assert.equal((await h.invoke()).toString(), '%PDF-test')
  assert.deepEqual(h.order, ['permission', 'pdfBytes', 'record'])
  for (const options of [{ denied: true }, { missing: true }, { recordFailure: true }]) {
    const failed = previewHarness({ pdf: true, format: 'pdf', ...options })
    await assert.rejects(failed.invoke(), { statusCode: options.denied ? 403 : options.missing ? 404 : 503 })
    if (options.denied) assert.deepEqual(failed.order, ['permission'])
    if (options.missing) assert.ok(!failed.order.includes('record'))
  }
})

test('PDF format cannot be used to read other file types or unknown formats', async () => {
  for (const options of [{ pdf: false, format: 'pdf' }, { pdf: true, format: 'raw' }]) {
    const h = previewHarness(options)
    await assert.rejects(h.invoke(), { statusCode: 400 })
    assert.deepEqual(h.order, ['permission'])
  }
})

test('PDF storage failures hide upstream details and do not record failed reads', async () => {
  for (const storageError of [{ statusCode: 404 }, { code: 'NoSuchKey' }, { message: 'internal-storage-secret' }]) {
    const h = previewHarness({ pdf: true, format: 'pdf', storageError })
    await assert.rejects(h.invoke(), {
      statusCode: 'message' in storageError ? 503 : 404,
      message: 'message' in storageError ? 'PDF 内容暂时无法加载，请稍后重试' : '文件不存在或暂时无法访问'
    })
    assert.ok(!h.order.includes('record'))
  }
})

test('UUID reader records successful company content only, skipping metadata and failed reads', async () => {
  for (const scenario of ['company', 'metadata', 'missing', 'department', 'denied']) {
    const calls: string[] = []
    const api = load('../server/api/documents/[uuid]/index.get.ts', {
      'h3': { setHeader: () => {} },
      '~~/server/utils/oss': {
        downloadDocument: async () => {
          calls.push('download')
          return scenario === 'missing' ? null : '# body'
        },
        getFileMetadata: async () => ({})
      },
      '~~/server/utils/authIdentity': { requireRequestUid: () => 'U001' },
      '~~/server/utils/yjsMarkdownRecovery': {
        hasMeaningfulMarkdownContent: (content: string) => Boolean(content),
        recoverMarkdownFromYjsSnapshot: async () => ''
      },
      '~~/server/utils/codocsRuntime': { getCodocsDocumentMetadata: async () => {
        if (scenario === 'denied') throw failure(403)
        return { uuid: 'doc-1', oss_path: scenario === 'department' ? 'codocs/departments/D001/a.md' : 'codocs/company/a.md', doc_type: 'company' }
      } },
      '~~/server/utils/departmentAccess': { requireDepartmentReadAccess: async () => {} },
      '~~/server/utils/companyAssetAccessRecords': { recordCompanyAssetAccess: async () => { calls.push('record') } }
    }, {
      defineEventHandler: (fn: Fn) => fn,
      getRouterParam: () => 'doc-1',
      getQuery: () => scenario === 'metadata' ? { skip_content: '1' } : {},
      createError: ({ statusCode }: { statusCode: number }) => failure(statusCode),
      console: { error: () => {} }
    })
    if (scenario === 'missing' || scenario === 'denied') {
      await assert.rejects(api.default!({ context: {} }), { statusCode: scenario === 'missing' ? 404 : 403 })
    } else {
      await api.default!({ context: {} })
    }
    assert.equal(calls.includes('record'), scenario === 'company', scenario)
  }
})

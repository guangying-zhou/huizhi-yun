import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('Enterprise Codocs document content uses actor-bound metadata and isolated content recovery', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const downloads = []
  const recoveries = []
  const audits = []
  const oldDownload = globalThis.__codocsContentDownload
  const oldRecovery = globalThis.__codocsContentRecovery
  const oldAudit = globalThis.__codocsContentAudit
  const oldSnapshotHead = globalThis.__codocsSnapshotHead
  const oldSnapshotSwitch = process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2

  globalThis.__codocsContentDownload = async (...args) => {
    downloads.push(args)
    return '# content'
  }
  globalThis.__codocsContentRecovery = async (...args) => {
    recoveries.push(args)
    return ''
  }
  globalThis.__codocsContentAudit = async (...args) => {
    audits.push(args)
  }

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/oss')) {
        source = 'export const downloadDocument=async(...args)=>globalThis.__codocsContentDownload(...args); export const downloadDocumentBuffer=async(...args)=>globalThis.__codocsContentDownload(...args)'
      }
      if (specifier.endsWith('/yjsMarkdownRecovery')) {
        source = 'export const hasMeaningfulMarkdownContent=value=>String(value??\'\').trim().length>0; export const recoverMarkdownFromYjsSnapshot=async(...args)=>globalThis.__codocsContentRecovery(...args)'
      }
      if (specifier.endsWith('/enterpriseCodocsDocumentAccessRecord')) source = 'export const recordEnterpriseCodocsDocumentAccess=async(...args)=>globalThis.__codocsContentAudit(...args)'
      if (specifier.endsWith('/enterpriseCodocsSnapshot')) source = 'export const readSnapshotHead=async()=>globalThis.__codocsSnapshotHead; export const readSnapshotMarkdown=async()=>"# v2"; export const repairLegacyMirror=async()=>true'
      if (specifier.endsWith('/enterpriseRuntimeClient')) source = 'export const requireEnterpriseUser=async()=>({uid:"owner",tenant:"tenant-a",deployment:"enterprise-test"})'
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      let candidate
      if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
      else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
      return next(specifier, context)
    }
  })

  try {
    const { withEnterpriseCodocsDocumentContent } = await import('../server/utils/enterpriseCodocsDocumentContent.ts')
    const event = { context: { tenant: 'tenant-a' } }
    const metadata = {
      uuid: 'doc-1',
      oss_path: 'codocs/private/doc-1.md',
      doc_type: 'private',
      readonly: true,
      title: 'Document'
    }

    for (const response of [
      { success: false, data: metadata },
      { success: true, data: { ...metadata, uuid: 'other-doc' } },
      { success: true, data: null }
    ]) {
      downloads.length = 0
      recoveries.length = 0
      await assert.rejects(
        withEnterpriseCodocsDocumentContent(event, response, 'doc-1', false),
        error => error.statusCode === 503
      )
      assert.equal(downloads.length, 0)
      assert.equal(recoveries.length, 0)
    }

    downloads.length = 0
    recoveries.length = 0
    const normal = await withEnterpriseCodocsDocumentContent(
      event,
      { success: true, data: { ...metadata, spoofed_path: 'not-used', spoofed_type: 'not-used' } },
      'doc-1',
      false
    )
    assert.equal(normal.data.content, '# content')
    assert.equal(normal.data.readonly_flag, 1)
    assert.deepEqual(downloads[0], [metadata.oss_path, metadata.doc_type, { event }])
    assert.equal(recoveries.length, 0)

    process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 = 'true'
    globalThis.__codocsSnapshotHead = { generation: 0, epoch: 3 }
    const initial = await withEnterpriseCodocsDocumentContent(event, { success: true, data: metadata }, 'doc-1', false)
    assert.deepEqual([initial.data.snapshot_generation, initial.data.snapshot_epoch], [0, 3])
    globalThis.__codocsSnapshotHead = { generation: 1, epoch: 3 }
    const published = await withEnterpriseCodocsDocumentContent(event, { success: true, data: metadata }, 'doc-1', false)
    assert.deepEqual([published.data.content, published.data.snapshot_generation, published.data.snapshot_epoch], ['# v2', 1, 3])
    if (oldSnapshotSwitch === undefined) delete process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2
    else process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 = oldSnapshotSwitch

    downloads.length = 0
    recoveries.length = 0
    const skipped = await withEnterpriseCodocsDocumentContent(event, { success: true, data: metadata }, 'doc-1', true)
    assert.equal(skipped.data.content, '')
    assert.equal(downloads.length, 0)
    assert.equal(recoveries.length, 0)
    const skippedCompany = await withEnterpriseCodocsDocumentContent(event, { success: true, data: { ...metadata, oss_path: 'codocs/company/published.md' } }, 'doc-1', true)
    assert.equal(skippedCompany.data.content, '')
    assert.equal(audits.length, 0)

    downloads.length = 0
    recoveries.length = 0
    globalThis.__codocsContentDownload = async (...args) => {
      downloads.push(args)
      return '   '
    }
    globalThis.__codocsContentRecovery = async (...args) => {
      recoveries.push(args)
      return '# recovered'
    }
    const recovered = await withEnterpriseCodocsDocumentContent(event, { success: true, data: metadata }, 'doc-1', false)
    assert.equal(recovered.data.content, '# recovered')
    assert.deepEqual(recoveries[0], [metadata.oss_path, metadata.doc_type, { event }])

    globalThis.__codocsContentDownload = async (...args) => {
      downloads.push(args)
      return null
    }
    globalThis.__codocsContentRecovery = async (...args) => {
      recoveries.push(args)
      return ''
    }
    await assert.rejects(
      withEnterpriseCodocsDocumentContent(event, { success: true, data: metadata }, 'doc-1', false),
      error => error.statusCode === 404
    )

    globalThis.__codocsContentDownload = async () => {
      throw new Error('credentials=secret-endpoint')
    }
    await assert.rejects(
      withEnterpriseCodocsDocumentContent(event, { success: true, data: metadata }, 'doc-1', false),
      error => error.statusCode === 503 && error.message === '文档存储暂不可用' && !error.message.includes('secret-endpoint')
    )
    audits.length = 0
    await assert.rejects(
      withEnterpriseCodocsDocumentContent(event, { success: true, data: { ...metadata, oss_path: 'codocs/company/published.md' } }, 'doc-1', false),
      error => error.statusCode === 503 && error.message === '文档存储暂不可用'
    )
    assert.equal(audits.length, 0)

    downloads.length = 0
    recoveries.length = 0
    audits.length = 0
    globalThis.__codocsContentDownload = async (...args) => {
      downloads.push(args)
      return '# company content'
    }
    const company = await withEnterpriseCodocsDocumentContent(
      event,
      { success: true, data: { ...metadata, oss_path: 'codocs/company/published.md' } },
      'doc-1',
      false,
      'view'
    )
    assert.equal(company.data.content, '# company content')
    assert.deepEqual(audits[0], [event, 'doc-1', 'codocs/company/published.md', 'view'])

    audits.length = 0
    globalThis.__codocsContentAudit = async () => { throw new Error('audit backend secret') }
    await assert.rejects(
      withEnterpriseCodocsDocumentContent(
        event,
        { success: true, data: { ...metadata, oss_path: 'codocs/company/published.md' } },
        'doc-1',
        false,
        'export'
      ),
      error => error.statusCode === 503 && error.message === '文档访问记录暂不可用'
    )

    for (const statusCode of [401, 403, 409]) {
      globalThis.__codocsContentAudit = async () => {
        const error = new Error(`audit-secret-${statusCode}`)
        error.statusCode = statusCode
        throw error
      }
      await assert.rejects(
        withEnterpriseCodocsDocumentContent(
          event,
          { success: true, data: { ...metadata, oss_path: 'codocs/company/published.md' } },
          'doc-1',
          false,
          'export'
        ),
        error => error.statusCode === statusCode
          && !error.message.includes(`audit-secret-${statusCode}`)
          && (statusCode === 409 ? error.message === '文档存储已变更，请重新读取' : error.message === '文档访问授权已失效')
      )
    }
  } finally {
    if (oldSnapshotSwitch === undefined) delete process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2
    else process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 = oldSnapshotSwitch
    globalThis.__codocsSnapshotHead = oldSnapshotHead
    hooks.deregister()
    globalThis.__codocsContentDownload = oldDownload
    globalThis.__codocsContentRecovery = oldRecovery
    globalThis.__codocsContentAudit = oldAudit
  }
})

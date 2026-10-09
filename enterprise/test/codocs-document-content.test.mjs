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
  const oldDepartmentHead = globalThis.__departmentHead
  const oldSnapshotReads = globalThis.__codocsSnapshotReads
  const oldDepartmentSwitch = process.env.HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2
  globalThis.__codocsSnapshotReads = []
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
      if (specifier.endsWith('/enterpriseCodocsSnapshot')) source = 'export const readSnapshotHead=async()=>globalThis.__codocsSnapshotHead; export const readSnapshotMarkdown=async(...args)=>{globalThis.__codocsSnapshotReads.push(args); return "# v2"}; export const parseSnapshotHead=value=>({generation:value.generation,epoch:value.epoch})'
      if (specifier.endsWith('/enterpriseCodocsDepartmentCollaboration')) source = 'export const codocsDepartmentCollaborationV2Enabled=()=>process.env.HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2==="true"; export const readDepartmentSnapshotHead=async(...args)=>globalThis.__departmentHead(...args)'
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

    // Department documents: once department collaboration is on, the exact
    // published version is the body and a stale mirror is never read or repaired.
    const departmentDoc = { uuid: 'doc-1', oss_path: 'codocs/departments/D1/doc-1.md', doc_type: 'department', dept_code: 'D1', title: 'Dept' }
    const departmentHeads = []
    globalThis.__departmentHead = async (...args) => {
      departmentHeads.push(args.slice(2))
      return globalThis.__codocsSnapshotHead
    }
    globalThis.__codocsContentDownload = async (...args) => {
      downloads.push(args)
      return '# stale mirror'
    }
    downloads.length = 0
    delete process.env.HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2
    const flagOff = await withEnterpriseCodocsDocumentContent(event, { success: true, data: departmentDoc }, 'doc-1', false)
    assert.equal(flagOff.data.content, '# stale mirror', 'department reads keep their path while the switch is off')
    assert.equal(departmentHeads.length, 0)

    process.env.HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2 = 'true'
    downloads.length = 0
    globalThis.__codocsSnapshotHead = { generation: 3, epoch: 2 }
    const departmentV2 = await withEnterpriseCodocsDocumentContent(event, { success: true, data: departmentDoc }, 'doc-1', false, 'export')
    assert.deepEqual([departmentV2.data.content, departmentV2.data.snapshot_generation, departmentV2.data.snapshot_epoch], ['# v2', 3, 2])
    assert.deepEqual(departmentHeads[0], ['D1', 'doc-1', 'export'], 'department and the caller permission come from the trusted response')
    assert.equal(downloads.length, 0, 'the mirror is not read once a snapshot is published')

    globalThis.__codocsSnapshotHead = { generation: 0, epoch: 2 }
    const departmentV1 = await withEnterpriseCodocsDocumentContent(event, { success: true, data: departmentDoc }, 'doc-1', false)
    assert.deepEqual([departmentV1.data.content, departmentV1.data.snapshot_generation], ['# stale mirror', 0], 'an unconverted document still reads its own path')

    const before = downloads.length
    await assert.rejects(
      withEnterpriseCodocsDocumentContent(event, { success: true, data: { ...departmentDoc, dept_code: '../x' } }, 'doc-1', false),
      error => error.statusCode === 503
    )
    for (const generation of [undefined, 4]) {
      await assert.rejects(
        withEnterpriseCodocsDocumentContent(event, { success: true, data: { ...departmentDoc, snapshot_generation: generation } }, 'doc-1', false, 'view', { bodyRef: 'required' }),
        error => error.statusCode === 503 && error.data.code === 'enterprise_document_body_ref_required'
      )
    }
    assert.equal(downloads.length, before, 'failing closed never falls back to the mirror')

    globalThis.__codocsSnapshotReads.length = 0
    departmentHeads.length = 0
    const viaReference = await withEnterpriseCodocsDocumentContent(
      event, { success: true, data: { ...departmentDoc, dept_code: 'OTHER', body_ref: { generation: 5, epoch: 1 } } }, 'doc-1', false, 'view', { bodyRef: 'required' })
    assert.deepEqual([viaReference.data.content, viaReference.data.snapshot_generation], ['# v2', 5])
    assert.equal(departmentHeads.length, 0, 'a Runtime body reference is the single authorization point')
    assert.equal(globalThis.__codocsSnapshotReads.length, 1)

    // The same rule for a private document read by somebody who is not its
    // owner (portfolio documents): never the actor-bound personal head.
    const personalSwitch = process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2
    const personalHead = globalThis.__codocsSnapshotHead
    process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 = 'true'
    globalThis.__codocsSnapshotHead = { generation: 9, epoch: 9 }
    try {
      const foreign = { uuid: 'doc-1', oss_path: 'codocs/private/other/doc-1.md', doc_type: 'private', title: 'Linked' }
      globalThis.__codocsSnapshotReads.length = 0
      const viaForeignReference = await withEnterpriseCodocsDocumentContent(
        event, { success: true, data: { ...foreign, snapshot_generation: 4, snapshot_ref: { generation: 4, epoch: 2 } } }, 'doc-1', false, 'view', { bodyRef: 'required' })
      assert.deepEqual([viaForeignReference.data.content, viaForeignReference.data.snapshot_generation], ['# v2', 4])
      assert.equal(globalThis.__codocsSnapshotReads.length, 1)
      const downloaded = downloads.length
      const unconverted = await withEnterpriseCodocsDocumentContent(
        event, { success: true, data: { ...foreign, snapshot_generation: 0 } }, 'doc-1', false, 'view', { bodyRef: 'required' })
      assert.deepEqual(downloads.at(-1).slice(0, 2), ['codocs/private/other/doc-1.md', 'private'], 'an unconverted document reads its own path')
      assert.notEqual(unconverted.data.content, '# v2')
      assert.notEqual(unconverted.data.snapshot_generation, 9, 'the reader\'s own personal head is never consulted')
      assert.equal(downloads.length, downloaded + 1)
      for (const generation of [undefined, 4]) {
        await assert.rejects(
          withEnterpriseCodocsDocumentContent(event, { success: true, data: { ...foreign, snapshot_generation: generation } }, 'doc-1', false, 'view', { bodyRef: 'required' }),
          error => error.statusCode === 503 && error.data.code === 'enterprise_document_body_ref_required'
        )
      }
      assert.equal(downloads.length, downloaded + 1, 'a converted or unannotated document without a reference releases nothing')
      // Without the option the owner's own read is unchanged: it asks the owning domain.
      const own = await withEnterpriseCodocsDocumentContent(event, { success: true, data: foreign }, 'doc-1', false)
      assert.deepEqual([own.data.content, own.data.snapshot_generation], ['# v2', 9])
    } finally {
      globalThis.__codocsSnapshotHead = personalHead
      if (personalSwitch === undefined) delete process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2
      else process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 = personalSwitch
    }

    const skippedDepartment = await withEnterpriseCodocsDocumentContent(event, { success: true, data: departmentDoc }, 'doc-1', true)
    assert.equal(skippedDepartment.data.content, '')
    assert.equal(departmentHeads.length, 0)

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
    globalThis.__codocsContentAudit = async () => {
      throw new Error('audit backend secret')
    }
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
    globalThis.__departmentHead = oldDepartmentHead
    globalThis.__codocsSnapshotReads = oldSnapshotReads
    if (oldDepartmentSwitch === undefined) delete process.env.HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2
    else process.env.HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2 = oldDepartmentSwitch
    hooks.deregister()
    globalThis.__codocsContentDownload = oldDownload
    globalThis.__codocsContentRecovery = oldRecovery
    globalThis.__codocsContentAudit = oldAudit
  }
})

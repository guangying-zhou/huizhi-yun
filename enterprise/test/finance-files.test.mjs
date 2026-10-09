import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

test('Finance attachment gates IO, freezes object key and restricts previews to owning metadata', async () => {
  const trace = []
  globalThis.__financeFileTrace = trace
  globalThis.__financeFileDenied = ''
  globalThis.__financeFileParts = [
    { name: 'file', filename: 'marked.pdf', type: 'application/pdf', data: Buffer.from('marked fixture') },
    { name: 'entityType', data: Buffer.from('finance_invoice_request') },
    { name: 'entityCode', data: Buffer.from('MARKED-REQ') }
  ]
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let code
    if (specifier === 'h3') code = `export const createError=x=>Object.assign(Error('fixed'),x); export const getHeader=()=> 'same-intent'; export const getQuery=()=>({code:'FILE1'}); export const readMultipartFormData=async()=>globalThis.__financeFileParts`
    if (specifier.endsWith('/enterpriseRuntimeClient')) code = `export const requireEnterpriseUser=async()=>({uid:globalThis.__financeFileActor||'clerk',tenant:'MARKED'})`
    if (specifier.endsWith('/ossIntegration')) code = `export const getOssIntegrationConfig=async(_code,{event})=>{globalThis.__financeStorageEvent=event;return {config:{provider:'aliyun-oss-s3'},bucket:'fixture',endpoint:'oss-cn-qingdao.aliyuncs.com'}}`
    if (specifier.endsWith('/objectStorage')) code = `export const createAliOssCompatibleClient=(config)=>{globalThis.__financeStorageConfig=config;return {put:async(key)=>{globalThis.__financeFileTrace.push(['put',key])},createSignedGetUrl:async(key)=>{globalThis.__financeFileTrace.push(['preview',key]);return 'https://fixture.invalid/signed'}}}`
    if (specifier.endsWith('/enterpriseFinanceLedger')) code = `
      export const normalizeFinanceLedgerRequest=(_op,code,_query,payload)=>({code,payload});
      export const authorizeFinanceLedger=async()=>{globalThis.__financeFileTrace.push(['write-auth']);if(globalThis.__financeFileDenied==='write')throw Object.assign(Error('denied'),{statusCode:403})};
      export const callFinanceLedger=async(_e,op,input)=>{globalThis.__financeFileTrace.push([op,input]);if(globalThis.__financeFileDenied===op)throw Object.assign(Error('denied'),{statusCode:403});return {data:{status:globalThis.__financeFileStatus||'draft',issuance_responsible_uid:'clerk',requested_by:'maker',file_key:'finance/invoices/owned.pdf',file_name:'marked.pdf',mime_type:'application/pdf'}}}
    `
    if (code) return { url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { attachFinanceFile, readFinanceFile, financeFileStorageProvider } = await import('../server/utils/enterpriseFinanceFiles.ts')
    assert.equal(financeFileStorageProvider('aliyun-oss-s3', 'https://oss-cn-qingdao.aliyuncs.com'), 'aliyun-oss-native')
    assert.equal(financeFileStorageProvider('oss-s3', 'oss-cn-shanghai.aliyuncs.com'), 'aliyun-oss-native')
    for (const [provider, endpoint] of [
      ['s3', 'oss-cn-qingdao.aliyuncs.com'],
      ['aliyun-oss-s3', 's3.oss-cn-qingdao.aliyuncs.com'],
      ['aliyun-oss-s3', 'oss-cn-qingdao.aliyuncs.com.example.invalid']
    ]) assert.equal(financeFileStorageProvider(provider, endpoint), provider)
    globalThis.__financeFileDenied = 'invoice-requests-detail'
    await assert.rejects(attachFinanceFile({}), { statusCode: 403 })
    assert.equal(trace.some(r => r[0] === 'put'), false)
    trace.length = 0
    globalThis.__financeFileDenied = 'write'
    await assert.rejects(attachFinanceFile({}), { statusCode: 403 })
    assert.equal(trace.some(r => r[0] === 'put'), false)
    trace.length = 0
    globalThis.__financeFileDenied = ''
    const event = {}
    await attachFinanceFile(event)
    assert.equal(globalThis.__financeStorageEvent, event)
    assert.equal(globalThis.__financeStorageConfig.provider, 'aliyun-oss-native')
    assert.equal(globalThis.__financeStorageConfig.endpoint, 'https://oss-cn-qingdao.aliyuncs.com')
    assert.deepEqual(trace.map(r => r[0]), ['invoice-requests-detail', 'write-auth', 'put', 'invoice-files-attach'])
    assert.equal(trace[3][1].payload.attachmentPurpose, undefined)
    const firstKey = trace[2][1]
    assert.match(firstKey, /^finance\/invoices\/MARKED\/[a-f0-9]{64}\/[a-f0-9]{64}\.pdf$/)
    trace.length = 0
    await attachFinanceFile({})
    assert.equal(trace[2][1], firstKey)
    trace.length = 0
    globalThis.__financeFileStatus = 'approved'
    await attachFinanceFile({})
    assert.equal(trace.at(-1)[1].payload.attachmentPurpose, 'issuance')
    trace.length = 0
    for (const actor of ['maker', 'other']) {
      globalThis.__financeFileActor = actor
      await assert.rejects(attachFinanceFile({}), { statusCode: 403 })
      assert.equal(trace.some(r => r[0] === 'put'), false)
      trace.length = 0
    }
    delete globalThis.__financeFileActor
    globalThis.__financeFileDenied = 'invoice-files-read'
    await assert.rejects(readFinanceFile({}), { statusCode: 403 })
    assert.equal(trace.some(r => r[0] === 'preview'), false)
    trace.length = 0
    globalThis.__financeFileDenied = ''
    await readFinanceFile({})
    assert.equal(trace[1][1], 'finance/invoices/owned.pdf')
  } finally {
    hooks.deregister()
    delete globalThis.__financeFileTrace
    delete globalThis.__financeFileDenied
    delete globalThis.__financeFileStatus
    delete globalThis.__financeFileActor
    delete globalThis.__financeFileParts
    delete globalThis.__financeStorageEvent
    delete globalThis.__financeStorageConfig
  }
})

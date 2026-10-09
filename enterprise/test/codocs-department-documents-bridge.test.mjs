import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { createApp, createRouter, toNodeListener } from 'h3'

test('department documents Host bridge separates read/create, forwards only whitelisted input and maps failures', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const state = { resources: { departments: ['view', 'create'] }, consoleDown: false, runtimeStatus: 0, deniedOperation: '', calls: [], keys: [], objects: new Set(), stages: new Map(), targetContents: new Map(), sourceContent: '# Note', putFails: false }
  const oldState = globalThis.__departmentDocumentsState, oldDefine = globalThis.defineEventHandler
  globalThis.__departmentDocumentsState = state
  globalThis.defineEventHandler = value => value
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `
      export const requireEnterpriseUser=async()=>({uid:'reader',tenant:'C000001',deployment:'C000001-test-enterprise'})
      export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+10000
      export const prepareEnterpriseRuntime=async()=>{}
      export const callEnterpriseRuntime=async(_event,operation,input,options)=>{const s=globalThis.__departmentDocumentsState;s.calls.push({operation,input,options});
        if(s.runtimeStatus || s.deniedOperation===operation)throw Object.assign(new Error('internal secret detail'),{statusCode:s.runtimeStatus||403});
        const dept={dept_code:input.code,doc_type:'department',folder_type:'department'};
        if(operation==='codocs.department-access-resolve')return {success:true,data:{role:'manager',canRead:true,canWrite:true,canManage:true}};
        if(operation==='codocs.department-documents-list')return {success:true,data:{items:[{...dept,uuid:'doc-1',title:'A',oss_path:'internal/secret',star_flag:1}],total:1,page:Number(input.query.page),pageSize:Number(input.query.pageSize)}};
        if(operation==='codocs.department-documents-create')return {success:true,data:{id:91,uuid:'00000000-0000-4000-8000-000000000091',title:input.payload.title,doc_type:'department',dept_code:input.code,oss_path:'codocs/document-creations/00000000-0000-4000-8000-000000000091/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md'}};
        if(operation==='codocs.department-documents-download')return {success:true,data:{uuid:input.subId,title:'Team note',doc_type:'department',dept_code:input.code,oss_path:'codocs/departments/D1/team-note.md'}};
        if(operation==='codocs.department-documents-view')return {success:true,data:{uuid:input.subId,title:'Team note',doc_type:'department',dept_code:s.viewDeptOverride||input.code,oss_path:'codocs/departments/'+input.code+'/team-note.md'}};
        if(operation==='codocs.department-documents-trash')return {success:true,data:{items:[{uuid:'00000000-0000-4000-8000-000000000091',title:'Removed',doc_type:'department',dept_code:input.code,deleted_at:'2026-09-29'}],total:1,page:1,pageSize:20}};
        if(operation==='codocs.department-documents-restore-plan')return {success:true,data:{uuid:input.subId,title:'Removed',doc_type:'department',dept_code:input.code,source_path:'codocs/departments/D1/team-note.md',target_path:'codocs/departments/D1/team-note.md',state_sha256:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',deleted:true,snapshot_backed:s.snapshotBacked===true}};
        if(operation==='codocs.department-documents-restore')return {success:true,data:{uuid:input.subId,restored:true}};
        if(operation.startsWith('codocs.department-documents-'))return {success:true,data:{uuid:input.subId}};
        if(operation==='codocs.department-folders-list')return {success:true,data:{items:[{...dept,id:5,name:'F',parent_id:null}],total:1,page:1,pageSize:20}};
        if(operation==='codocs.department-folders-create')return {success:true,data:{...dept,id:9,name:input.payload.name,parent_id:input.payload.parent_id}};
        if(operation.startsWith('codocs.department-folders-'))return {success:true,data:{id:Number(input.objectId)}};
        throw Error(operation)}
    `
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>{const s=globalThis.__departmentDocumentsState;if(s.consoleDown)throw Object.assign(new Error('down'),{statusCode:503});return {resources:s.resources,actionPolicies:{}}}`
    if (specifier.endsWith('/authorizationActions')) source = `export const authorizationResourcesAllow=(resources,resource,action)=>resources?.[resource]?.includes(action)===true`
    if (specifier.endsWith('/codocs/server/utils/oss')) source = `export const resolveDocumentOssTimeoutMs=()=>8000;export const createRuntimeOSSClient=async()=>({head:async(path)=>{const s=globalThis.__departmentDocumentsState;if(s.stages.has(path))return {meta:{'copy-intent':s.stages.get(path).intent}};if(!s.objects.has(path))throw {status:404};return {meta:{}}},get:async(path)=>{const s=globalThis.__departmentDocumentsState;if(!s.stages.has(path))throw {status:404};return {content:s.stages.get(path).bytes}},put:async(path,bytes,options)=>{const s=globalThis.__departmentDocumentsState;if(path.startsWith('codocs/copy-staging/')){if(s.stages.has(path))throw {status:412};s.stages.set(path,{bytes:Buffer.from(bytes),intent:options.meta['copy-intent']});return};if(s.putFails)throw Error('storage down');s.objects.add(path);s.targetContents.set(path,Buffer.from(bytes))}});export const downloadDocument=async()=> globalThis.__departmentDocumentsState.sourceContent`
    if (specifier.endsWith('/codocs/server/utils/yjsMarkdownRecovery')) source = `export const hasMeaningfulMarkdownContent=(value)=>Boolean(value);export const recoverMarkdownFromYjsSnapshot=async()=>''`
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const app = createApp(), router = createRouter()
    router.get('/documents', (await import('../server/routes/codocs/api/departments/documents.get.ts')).default)
    router.get('/documents/:uuid', (await import('../server/routes/codocs/api/departments/documents/[uuid].get.ts')).default)
    router.get('/documents/:uuid/download', (await import('../server/routes/codocs/api/departments/documents/[uuid]/download.get.ts')).default)
    router.post('/documents/:uuid/copy', (await import('../server/routes/codocs/api/departments/documents/[uuid]/copy.post.ts')).default)
    router.patch('/documents/:uuid', (await import('../server/routes/codocs/api/departments/documents/[uuid].patch.ts')).default)
    router.delete('/documents/:uuid', (await import('../server/routes/codocs/api/departments/documents/[uuid].delete.ts')).default)
    router.patch('/documents/:uuid/readonly', (await import('../server/routes/codocs/api/departments/documents/[uuid]/readonly.patch.ts')).default)
    router.post('/documents/:uuid/restore', (await import('../server/routes/codocs/api/departments/documents/[uuid]/restore.post.ts')).default)
    router.get('/documents/trash', (await import('../server/routes/codocs/api/departments/documents/trash.get.ts')).default)
    router.post('/documents', (await import('../server/routes/codocs/api/departments/documents.post.ts')).default)
    router.get('/folders', (await import('../server/routes/codocs/api/departments/folders.get.ts')).default)
    router.post('/folders', (await import('../server/routes/codocs/api/departments/folders.post.ts')).default)
    router.patch('/folders/:id', (await import('../server/routes/codocs/api/departments/folders/[id].patch.ts')).default)
    router.delete('/folders/:id', (await import('../server/routes/codocs/api/departments/folders/[id].delete.ts')).default)
    router.patch('/folders/:id/open', (await import('../server/routes/codocs/api/departments/folders/[id]/open.patch.ts')).default)
    router.get('/access', (await import('../server/routes/codocs/api/departments/access.get.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'codocs:department-folder:11111111-2222' }
    const post = (body, extra = {}) => fetch(`${base}/folders`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) })
    const postDocument = (body, extra = {}) => fetch(`${base}/documents`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) })
    const folder = { dept_code: 'D1', name: '规章', parent_id: null }
    const reset = () => {
      state.calls.length = 0
      state.runtimeStatus = 0
      state.consoleDown = false
      state.resources = { departments: ['view', 'create'] }
    }

    // Forged identity, marker and type keys are rejected before any permission or Runtime call.
    for (const key of ['owner', 'owner_uid', 'viewer', 'viewer_uid', 'actor_uid', 'actorUid', 'type', 'doc_type', 'codocs_trusted_department_read_dept_code', 'hzy_runtime_actor_delegated', 'marker', 'folder_type']) {
      assert.equal((await fetch(`${base}/documents?dept_code=D1&${key}=x`)).status, 400, key)
    }
    assert.equal((await fetch(`${base}/folders?dept_code=D1&owner_uid=x`)).status, 400)
    assert.equal((await fetch(`${base}/documents?dept_code=D1&dept_code=D2`)).status, 400)
    for (const code of ['', '../D1', 'D1%20', 'D1/x']) assert.equal((await fetch(`${base}/documents?dept_code=${code}`)).status, 400, code)
    assert.equal((await fetch(`${base}/documents`)).status, 400)
    for (const query of ['published_mode=all', 'exclude_weekly_reports=1', `search=${'x'.repeat(101)}`, 'folder_id=abc', 'folder_id=0', 'folder_id=1;drop']) {
      assert.equal((await fetch(`${base}/documents?dept_code=D1&${query}`)).status, 400, query)
    }
    assert.equal((await fetch(`${base}/folders?dept_code=D1&parent_id=-1`)).status, 400)
    assert.equal(state.calls.length, 0)

    // Pagination bounds: default 20, maximum 200.
    for (const query of ['page=0', 'page=x', 'pageSize=201', 'pageSize=0', 'pageSize=1.5', 'page=1000001']) {
      assert.equal((await fetch(`${base}/documents?dept_code=D1&${query}`)).status, 400, query)
    }
    assert.equal(state.calls.length, 0)
    const listed = await fetch(`${base}/documents?dept_code=D1`)
    assert.equal(listed.status, 200)
    assert.equal(state.calls[0].input.query.pageSize, '20')
    assert.equal(state.calls[0].input.query.page, '1')
    assert.equal((await fetch(`${base}/documents?dept_code=D1&pageSize=200&page=3&folder_id=null&search=abc&published_mode=published&exclude_weekly_reports=true`)).status, 200)
    const last = state.calls.at(-1)
    assert.deepEqual(last.input.query, { page: '3', pageSize: '200', published_mode: 'published', exclude_weekly_reports: 'true', search: 'abc', folder_id: 'null' })
    assert.deepEqual({ resource: last.input.authorization.resource, action: last.input.authorization.action, actorUid: last.input.authorization.actorUid }, { resource: 'department-documents', action: 'read', actorUid: 'reader' })
    assert.equal(last.input.code, 'D1')
    // Internal columns never reach the browser.
    const body = await listed.json()
    assert.deepEqual(Object.keys(body.data.items[0]).sort(), ['dept_code', 'doc_type', 'title', 'uuid'])
    assert.ok(!JSON.stringify(body).includes('internal/secret'))
    assert.equal((await fetch(`${base}/folders?dept_code=D1&parent_id=5`)).status, 200)
    assert.equal(state.calls.at(-1).input.authorization.resource, 'department-folders')

    const downloadUrl = `${base}/documents/00000000-0000-4000-8000-000000000091/download?dept_code=D1`
    assert.equal((await fetch(downloadUrl)).status, 403)
    state.resources.departments.push('export')
    const downloaded = await fetch(downloadUrl)
    assert.equal(downloaded.status, 200)
    assert.equal(await downloaded.text(), '# Note')
    assert.match(downloaded.headers.get('content-disposition'), /attachment;/)
    assert.equal(state.calls.at(-1).operation, 'codocs.department-documents-download')
    assert.equal(state.calls.at(-1).input.subId, '00000000-0000-4000-8000-000000000091')
    assert.equal(state.calls.at(-1).input.authorization.action, 'export')
    assert.equal((await fetch(`${downloadUrl}&owner_uid=victim`)).status, 400)
    assert.equal((await fetch(`${base}/documents/../download?dept_code=D1`)).status, 404)

    // Read (view) and create are different person permissions.
    reset()
    state.resources = { departments: ['view'] }
    assert.equal((await post(folder)).status, 403)
    assert.equal(state.calls.length, 0)
    assert.equal((await fetch(`${base}/documents?dept_code=D1`)).status, 200)
    state.resources = { departments: ['create'] }
    assert.equal((await fetch(`${base}/documents?dept_code=D1`)).status, 403)
    assert.equal((await fetch(`${base}/folders?dept_code=D1`)).status, 403)
    assert.equal((await fetch(`${base}/access?dept_code=D1`)).status, 403)
    assert.equal((await post(folder)).status, 200)
    state.resources = {}
    assert.equal((await fetch(`${base}/documents?dept_code=D1`)).status, 403)

    // Console authorization failure is 503, never a fake 403.
    reset()
    state.consoleDown = true
    assert.equal((await fetch(`${base}/documents?dept_code=D1`)).status, 503)
    assert.equal((await post(folder)).status, 503)
    assert.equal(state.calls.length, 0)

    // Runtime failure mapping without leaking internals.
    reset()
    for (const [runtime, expected] of [[403, 403], [404, 404], [500, 503], [502, 503], [401, 503]]) {
      state.runtimeStatus = runtime
      const response = await fetch(`${base}/documents?dept_code=D1`)
      assert.equal(response.status, expected, String(runtime))
      assert.ok(!(await response.text()).includes('internal secret detail'))
    }
    state.runtimeStatus = 403
    assert.equal((await post(folder)).status, 403)
    state.runtimeStatus = 0

    // Folder creation: required stable Idempotency-Key, strict payload, permit action edit.
    reset()
    assert.equal((await post(folder, { 'Idempotency-Key': '' })).status, 400)
    assert.equal((await post(folder, { 'Idempotency-Key': 'short' })).status, 400)
    assert.equal((await post(folder, { 'Idempotency-Key': 'bad key with spaces!' })).status, 400)
    for (const extra of [{ owner_uid: 'x' }, { viewer: 'x' }, { actor_uid: 'x' }, { marker: 'x' }, { codocs_trusted_department_manage_dept_code: 'D1' }, { folder_type: 'private' }]) {
      assert.equal((await post({ ...folder, ...extra })).status, 400, JSON.stringify(extra))
    }
    for (const bad of [{ ...folder, name: '  ' }, { ...folder, name: 'x'.repeat(101) }, { ...folder, dept_code: 'D1/../D2' }, { ...folder, parent_id: 'abc' }, { ...folder, parent_id: 0 }, { name: 'x' }]) {
      assert.equal((await post(bad)).status, 400, JSON.stringify(bad))
    }
    assert.equal((await fetch(`${base}/folders?dept_code=D1`, { method: 'POST', headers, body: JSON.stringify(folder) })).status, 400)
    assert.equal(state.calls.length, 0)
    const created = await post({ ...folder, name: ' 规章 ', parent_id: 5 })
    assert.equal(created.status, 200)
    const call = state.calls[0]
    assert.equal(call.operation, 'codocs.department-folders-create')
    assert.equal(call.options.idempotencyKey, headers['Idempotency-Key'])
    assert.deepEqual(call.input.payload, { folder_type: 'department', dept_code: 'D1', name: '规章', parent_id: 5 })
    assert.deepEqual({ resource: call.input.authorization.resource, action: call.input.authorization.action }, { resource: 'department-folders', action: 'edit' })
    // Retry with the same key forwards the same key (Runtime owns replay semantics).
    assert.equal((await post({ ...folder, name: ' 规章 ', parent_id: 5 })).status, 200)
    assert.equal(state.calls[1].options.idempotencyKey, call.options.idempotencyKey)

    // The metadata receipt is durable first; a storage failure returns 503,
    // and the same key converges without replacing an already present body.
    reset()
    const document = { dept_code: 'D1', title: 'Team note', folder_id: null, content: '# Note' }
    assert.equal((await postDocument({ ...document, owner_uid: 'victim' })).status, 400)
    assert.equal((await postDocument(document, { 'Idempotency-Key': 'short' })).status, 400)
    assert.equal(state.calls.length, 0)
    state.putFails = true
    assert.equal((await postDocument(document)).status, 503)
    assert.equal(state.calls[0].operation, 'codocs.department-documents-create')
    assert.deepEqual({ resource: state.calls[0].input.authorization.resource, action: state.calls[0].input.authorization.action }, { resource: 'department-documents', action: 'create' })
    assert.equal(state.calls[0].options.idempotencyKey, headers['Idempotency-Key'])
    state.putFails = false
    assert.equal((await postDocument(document)).status, 200)
    assert.equal(state.calls[1].options.idempotencyKey, state.calls[0].options.idempotencyKey)
    assert.equal(state.objects.size, 1)
    assert.equal((await postDocument(document)).status, 200)
    assert.equal(state.objects.size, 1)

    // Copy stages the first readable source bytes under a bound key before
    // creating metadata. A failed target write converges from that stage even
    // if the source body changes between attempts.
    reset()
    state.objects.clear()
    state.stages.clear()
    state.targetContents.clear()
    state.sourceContent = '# First source'
    const copyUrl = `${base}/documents/00000000-0000-4000-8000-000000000077/copy`
    const copyBody = { source_dept_code: 'D2', dept_code: 'D1', title: 'Copied note', folder_id: null }
    const copy = (payload = copyBody) => fetch(copyUrl, { method: 'POST', headers, body: JSON.stringify(payload) })
    state.deniedOperation = 'codocs.department-documents-view'
    assert.equal((await copy()).status, 403)
    assert.equal(state.stages.size, 0)
    state.deniedOperation = 'codocs.department-documents-create'
    assert.equal((await copy()).status, 403)
    assert.equal(state.objects.size, 0)
    state.deniedOperation = ''
    state.putFails = true
    assert.equal((await copy()).status, 503)
    assert.equal(state.stages.size, 1)
    assert.match([...state.stages.keys()][0], /^codocs\/copy-staging\/[0-9a-f]{64}\.md$/)
    const staged = [...state.stages.values()][0].bytes.toString('utf8')
    assert.equal(staged, '# First source')
    state.sourceContent = '# Changed later'
    state.putFails = false
    assert.equal((await copy()).status, 200)
    assert.equal(state.objects.size, 1)
    assert.equal([...state.targetContents.values()][0].toString('utf8'), staged)
    const copyCreate = state.calls.find(call => call.operation === 'codocs.department-documents-create')
    assert.equal(copyCreate.input.payload.source_uuid, '00000000-0000-4000-8000-000000000077')
    assert.equal(copyCreate.input.payload.content_sha256, (await import('node:crypto')).createHash('sha256').update(staged).digest('hex'))
    assert.equal((await copy()).status, 200)
    assert.equal(state.objects.size, 1)
    assert.equal(state.stages.size, 1)
    assert.equal((await copy({ ...copyBody, title: 'Different title' })).status, 409)
    assert.equal(state.objects.size, 1)
    assert.equal(state.calls.filter(call => call.operation === 'codocs.department-documents-create').length, 4)

    // Access hint proxies only the four UI fields.
    reset()
    const access = await (await fetch(`${base}/access?dept_code=D1`)).json()
    assert.deepEqual(access.data, { role: 'manager', canRead: true, canWrite: true, canManage: true })
    assert.equal(state.calls[0].operation, 'codocs.department-access-resolve')
    assert.equal((await fetch(`${base}/access`)).status, 400)

    // Department writes retain precise operation, object and session permit.
    const uuid = '00000000-0000-4000-8000-000000000091'
    const write = (path, method, body) => fetch(`${base}${path}`, { method, headers, body: JSON.stringify(body) })
    const docPath = `/documents/${uuid}`
    assert.equal((await write(docPath, 'PATCH', { dept_code: 'D1', title: 'Renamed' })).status, 403)
    state.resources.departments.push('edit')
    assert.equal((await write(docPath, 'PATCH', { dept_code: 'D1', title: 'Renamed' })).status, 200)
    assert.equal(state.calls.at(-1).operation, 'codocs.department-documents-edit-metadata')
    assert.equal(state.calls.at(-1).input.authorization.action, 'edit')
    assert.equal(state.calls.at(-1).input.subId, uuid)
    assert.equal(state.calls.at(-1).input.payload.title, 'Renamed')
    assert.equal((await write(docPath, 'PATCH', { dept_code: 'D1', title: 'X', owner_uid: 'victim' })).status, 400)
    assert.equal((await write(`${docPath}/readonly`, 'PATCH', { dept_code: 'D1', readonly_flag: true })).status, 200)
    assert.equal(state.calls.at(-1).operation, 'codocs.department-documents-readonly')
    assert.equal((await write(docPath, 'DELETE', { dept_code: 'D1' })).status, 200)
    assert.equal(state.calls.at(-1).operation, 'codocs.department-documents-recycle')
    assert.equal((await fetch(`${base}/documents/trash?dept_code=D1`)).status, 200)
    assert.equal(state.calls.at(-1).operation, 'codocs.department-documents-trash')
    // A v1 document with no surviving mirror cannot be restored ...
    assert.equal((await write(`${docPath}/restore`, 'POST', { dept_code: 'D1' })).status, 404)
    // ... but a snapshot-backed (v2) one restores by status only, without touching storage.
    state.snapshotBacked = true
    state.objects.clear()
    assert.equal((await write(`${docPath}/restore`, 'POST', { dept_code: 'D1' })).status, 200)
    assert.equal(state.calls.at(-1).operation, 'codocs.department-documents-restore')
    assert.equal(state.calls.at(-1).input.payload.state_sha256, 'a'.repeat(64))
    assert.equal(state.objects.size, 0)
    state.snapshotBacked = false
    state.objects.add('codocs/departments/D1/team-note.md')
    assert.equal((await write(`${docPath}/restore`, 'POST', { dept_code: 'D1' })).status, 200)
    assert.equal(state.calls.at(-1).operation, 'codocs.department-documents-restore')
    // Department document read (view) is independent of the collaboration flags and of
    // departments:export: the person needs departments:view and Runtime decides the relation.
    for (const key of ['HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2', 'HZY_ENTERPRISE_CODOCS_COLLABORATION_V2', 'HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2']) assert.notEqual(process.env[key], 'true')
    const viewUrl = `${base}/documents/00000000-0000-4000-8000-000000000091?dept_code=D1`
    state.resources = { departments: ['view'] }
    state.calls.length = 0
    const viewed = await fetch(viewUrl)
    assert.equal(viewed.status, 200)
    const viewedBody = await viewed.json()
    assert.equal(viewedBody.data.doc_type, 'department')
    assert.ok(!('oss_path' in viewedBody.data))
    assert.ok(!('department_collaboration' in viewedBody.data))
    assert.equal(state.calls[0].operation, 'codocs.department-documents-view')
    assert.equal(state.calls[0].input.authorization.action, 'read')
    assert.equal((await fetch(`${base}/documents/00000000-0000-4000-8000-000000000091/download?dept_code=D1`)).status, 403)
    // Non-member: Runtime denies the relation.
    state.deniedOperation = 'codocs.department-documents-view'
    assert.equal((await fetch(viewUrl)).status, 403)
    state.deniedOperation = ''
    // Missing departments:view is refused before any Runtime call.
    state.resources = { departments: [] }
    state.calls.length = 0
    assert.equal((await fetch(viewUrl)).status, 403)
    assert.equal(state.calls.length, 0)
    state.resources = { departments: ['view'] }
    // A forged dept_code for a document of another department is never returned.
    state.viewDeptOverride = 'D2'
    assert.ok([403, 404, 503].includes((await fetch(viewUrl)).status))
    state.viewDeptOverride = ''
    assert.equal((await fetch(`${viewUrl}&doc_type=private`)).status, 400)
    state.resources = { departments: ['view', 'create', 'export', 'edit'] }

    assert.equal((await write('/folders/5', 'PATCH', { dept_code: 'D1', name: 'New folder' })).status, 200)
    assert.equal(state.calls.at(-1).operation, 'codocs.department-folders-update')
    assert.equal((await write('/folders/5/open', 'PATCH', { dept_code: 'D1', is_open: true })).status, 200)
    assert.equal(state.calls.at(-1).operation, 'codocs.department-folders-open')
    assert.equal((await write('/folders/5', 'DELETE', { dept_code: 'D1' })).status, 200)
    assert.equal(state.calls.at(-1).operation, 'codocs.department-folders-delete')
    state.deniedOperation = 'codocs.department-folders-update'
    assert.equal((await write('/folders/5', 'PATCH', { dept_code: 'D1', name: 'No' })).status, 403)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.__departmentDocumentsState = oldState
    globalThis.defineEventHandler = oldDefine
  }
})

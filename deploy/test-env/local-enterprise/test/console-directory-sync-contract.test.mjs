import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { hzy0ConsoleDirectorySyncReads, hzy0ConsoleDirectorySyncWrite } from '../../enterprise-topology.mjs'
import { consoleFacadeRoute } from '../console-facade.mjs'
const require = createRequire(new URL('../../../../console/package.json', import.meta.url))
const ts = require('typescript')
const source = fs.readFileSync(new URL('../../../../console/server/api/v1/console/directory/sync-jobs/index.post.ts', import.meta.url), 'utf8')
function handler() {
  let calls = 0
  const receipts = new Map()
  const client = { startConsoleDirectorySubjectSync: async (event, body) => {
    calls++
    const prior = receipts.get(event.key)
    if (prior) return { data: prior }
    const data = { jobCode: 'fixture-job', providerCode: body.providerCode }
    receipts.set(event.key, data)
    return { data }
  } }
  const exports = {}
  const context = { exports, defineEventHandler: f => f,
    readBody: async event => event.body,
    createError: data => Object.assign(new Error(data.message), data),
    require: path => path.includes('consoleTenantRuntimeClient') ? client
      : path.includes('checkPermission') ? { requirePermission: async (event, resource, action) => {
        assert.equal(resource, 'directory_sync')
        if (!event.session) throw Object.assign(new Error('unauthenticated'), {statusCode:401})
        if (!event.permissions.includes(action)) throw Object.assign(new Error('denied'), {statusCode:403})
      } } : path.includes('idempotency') ? {requireIdempotencyKey: event => {
        if (!event.key) throw Object.assign(new Error('missing key'), {statusCode:400})
      }} : {ok: data => ({code:0,data})} }
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, context)
  return {run:exports.default,calls:()=>calls}
}
test('sync topology matches exact facade paths, no general administration proxy', () => {
  for (const path of hzy0ConsoleDirectorySyncReads) assert.equal(consoleFacadeRoute(path,'GET'),true)
  assert.equal(consoleFacadeRoute(hzy0ConsoleDirectorySyncWrite,'POST'),true)
  for (const path of ['/console/directory/sync/DS-fixture', hzy0ConsoleDirectorySyncWrite+'/DS-fixture', hzy0ConsoleDirectorySyncWrite+'/DS-fixture/events']) {
    assert.equal(consoleFacadeRoute(path,'GET'),true)
    assert.equal(consoleFacadeRoute(path,'POST'),false)
  }
  for(const path of [hzy0ConsoleDirectorySyncWrite+'/../vault',hzy0ConsoleDirectorySyncWrite+'/%2e%2e/events',hzy0ConsoleDirectorySyncWrite+'/DS-fixture/other']) assert.equal(consoleFacadeRoute(path,'GET'),false)
  for (const path of ['/console/directory/users','/console/api/v1/console/vault','/console/api/activation/bundle-refresh']) assert.equal(consoleFacadeRoute(path,'POST'),false)
})
test('real Console handler preserves session, both permissions, key and replay', async () => {
  const h=handler()
  const event={session:true,permissions:['edit','admin'],key:'fixture-key',body:{providerCode:'console',syncType:'manual',objectScope:'subjects'}}
  for(const change of [{session:false},{permissions:[]},{permissions:['edit']},{permissions:['admin']},{key:null}]) {
    await assert.rejects(h.run({...event,...change}),error=>[400,401,403].includes(error.statusCode))
    assert.equal(h.calls(),0)
  }
  const first=await h.run(event),replay=await h.run(event)
  assert.equal(first.data.jobCode,replay.data.jobCode)
  // Target receipt implementation is unchanged; this tests the BFF carrying the
  // same key and command to it rather than forging a user or generating a key.
  assert.equal(h.calls(),2)
})

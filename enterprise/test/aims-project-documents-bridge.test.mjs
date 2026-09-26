import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise project documents use an independently signed Aims service hop', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'deployment-a' }
  globalThis.__projectDocumentAllowed = true
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = 'export const requireEnterpriseUser=async()=>globalThis.__projectDocumentSession'
    if (specifier.endsWith('/platformBundleAuthorization')) source = "export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__projectDocumentAllowed?{projects:['view']}:{},actionPolicies:{}})"
    if (specifier.endsWith('/authorizationActions')) source = "export const authorizationResourcesAllow=(resources,resource,action)=>resources?.[resource]?.includes(action)===true"
    if (specifier.endsWith('/tenantGatewayTrust')) source = "export const resolveTrustedTenantGatewayContext=()=>({appCode:'enterprise',tenant:'tenant-a',deployment:'deployment-a'})"
    if (specifier.endsWith('/serviceAppUrl')) source = "export const resolveTrustedServiceAppRoute=()=>({deploymentCode:'aims-deployment'});export const resolveServiceAppBaseUrl=()=> 'https://tenant.test/aims'"
    if (specifier.endsWith('/serviceOidc')) source = 'export const requestWithServiceAccessToken=async({request})=>request("enterprise-token");export const trustedServiceRequestHeaders=()=>({"x-hzy-gateway":"tenant-gateway","x-hzy-gateway-token":"test-proof"})'
    if (specifier.endsWith('/appServiceBinding')) source = 'export const serviceAppFetch=async(event,app,url,options)=>globalThis.__projectDocumentFetch(event,app,url,options)'
    if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const hashServiceCommandPayload=async()=>"a".repeat(64);export const buildServiceCommandRuntimeHeaders=async(input)=>{globalThis.__projectDocumentSigned=input;return {"x-hzy-signature":"signed"}}'
    if (specifier.endsWith('/enterpriseAimsProjects') || specifier === './enterpriseAimsProjects') source = "export const enterpriseAimsProjectScope=async()=>({current_user_project_admin_project_codes:'PRJ-1'})"
    if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__projectDocumentSession'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    globalThis.__projectDocumentSession = session
    globalThis.__projectDocumentFetch = async (_event, app, url, options) => { calls.push({ app, url, options }); return { code: 0, data: { items: [] } } }
    const app = createApp(), router = createRouter()
    router.get('/projects/:id/documents', (await import('../server/routes/aims/api/v1/projects/[id]/documents/index.get.ts')).default)
    app.use(router); server = createServer(toNodeListener(app)); await new Promise(done => server.listen(0, '127.0.0.1', done)); const base = `http://127.0.0.1:${server.address().port}`
    globalThis.__projectDocumentAllowed = false
    assert.equal((await fetch(`${base}/projects/12/documents`)).status, 403); assert.equal(calls.length, 0)
    globalThis.__projectDocumentAllowed = true
    assert.equal((await fetch(`${base}/projects/12/documents`)).status, 200)
    const call = calls.at(-1), command = call.options.body.serviceCommand.command
    assert.equal(call.app, 'aims'); assert.match(call.url, /\/aims\/api\/v1\/service\/enterprise\/project-documents\/read$/)
    assert.equal(call.options.headers.authorization, 'Bearer enterprise-token'); assert.equal(command.actorUid, 'person-a'); assert.equal(command.tenant, 'tenant-a'); assert.equal(command.targetDeployment, 'aims-deployment'); assert.equal(command.projectId, '12'); assert.equal(command.scope.current_user_project_admin_project_codes, 'PRJ-1')
    assert.equal(globalThis.__projectDocumentSigned.sourceApp, 'enterprise'); assert.equal(globalThis.__projectDocumentSigned.sourceClientId, 'enterprise.runtime')
    for (const path of ['/projects/0/documents', '/projects/12/documents?tenant=other']) { const before = calls.length; assert.equal((await fetch(base + path)).status, 400); assert.equal(calls.length, before) }
  } finally { if (server) await new Promise(done => server.close(done)); hooks.deregister(); delete globalThis.__projectDocumentSession; delete globalThis.__projectDocumentFetch; delete globalThis.__projectDocumentAllowed; delete globalThis.__projectDocumentSigned }
})

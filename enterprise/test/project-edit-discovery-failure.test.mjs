import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('edit discovery dependency failure hides edit while overview remains readable', async () => {
  const hook = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'U1',tenant:'T1',deployment:'host'});export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const prepareEnterpriseRuntime=async()=>{};export const callEnterpriseRuntime=async()=>({code:0,data:{id:1,name:'Overview',canAccess:true,current_user_role:'manager'}})`
    if (specifier.endsWith('/projectTabAuthorization')) source = `export const loadProjectTabAuthorization=async()=>{throw new Error('discovery dependency')}`
    if (specifier.endsWith('/projectWriteAuthorization')) source = `export const loadProjectWriteAuthorization=async()=>{throw new Error('discovery dependency')};export const projectWriteDiscoveryAllows=()=>{throw new Error('must not be reached')}`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:{projects:['view']}});export const loadScopedAuthorizationFromConsoleRuntime=async()=>({uid:'U1',appCode:'aims',grants:[{permissions:[{appCode:'aims',resourceCode:'projects',action:'view'}]}],bundleVersion:'v1',bundleHash:'hash',policyRevision:1,authorizationExpiresAt:Date.now()+14000})`
    if (specifier.endsWith('/userDepartments')) source = `export const fetchUserDepartments=async()=>({departments:[],managedDeptCodes:[]})`
    if (specifier.endsWith('/aimsScopedAuthorization')) source = `export const resolveAimsProjectListAdminScopeQuery=async()=>({});export const resolveAimsProjectAuthorizationObject=async()=>({projectCode:'A'})`
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    let path
    if (specifier.startsWith('@hzy/foundation/')) path = resolve(import.meta.dirname, '../../foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (path && !existsSync(path) && existsSync(path + '.ts')) return { url: pathToFileURL(path + '.ts').href, shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { projectRead } = await import('../server/utils/enterpriseAimsProjects.ts')
    const event = { node: { res: { setHeader() {}, headersSent: false } } }
    const response = await projectRead(event, 'aims.project-view', {}, '1')
    assert.equal(response.code, 0); assert.equal(response.data.name, 'Overview'); assert.equal(response.data.canEditProject, false)
  } finally { hook.deregister() }
})

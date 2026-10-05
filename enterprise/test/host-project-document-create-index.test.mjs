import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('real Host folder create-index body reaches fixed U create unchanged', async () => {
  const body = JSON.parse(readFileSync(new URL('./fixtures/host-project-document-create-index.json', import.meta.url), 'utf8'))
  // Lock the fixture to the page's actual body keys, including nullable parent.
  const page = readFileSync(new URL('../../aims/app/pages/projects/[id]/documents.vue', import.meta.url), 'utf8')
  const folder = page.slice(page.indexOf('async function createFolder()'), page.indexOf('async function createMarkdownDocument('))
  for (const key of Object.keys(body)) assert.match(folder, new RegExp(`\\b${key}:`))
  assert.match(folder, /isFolder: true/)
  globalThis.__hostCreateFixture = body
  globalThis.__hostCreateCalls = []
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = 'export const readBody=async()=>globalThis.__hostCreateFixture;export const setHeader=()=>{};export const getRouterParam=()=>"";export const readMultipartFormData=async()=>[];export const createError=()=>Error("unexpected")'
    if (specifier.endsWith('enterpriseAimsProjectDocumentPermits')) source = 'export const enterpriseAimsDocumentReadPermitProvider=()=>async()=>({})'
    if (specifier.endsWith('aims/layer/server/index')) return { url: new URL('../../aims/layer/server/internal/projectDocumentWrites.ts', import.meta.url).href, shortCircuit: true }
    if (specifier === './projectDocumentPorts') source = 'export const documentActor=async()=>({uid:"U1"});export const hostDocumentOwner=async()=>"1";export const hostProjectDocumentContext=async()=>({projectId:"1",projectCode:"P1",isMember:true});export const hostDocumentWrite=async(event,action,context,payload)=>{globalThis.__hostCreateCalls.push({action,payload});return {code:0,data:{}}}'
    if (specifier.endsWith('/codocsApi')) source = 'export const createCodocsDocument=async()=>{throw Error("folder must not create Codocs body")};export const deleteCodocsProjectCabinetFile=()=>{};export const uploadCodocsProjectCabinetFile=()=>{}'
    if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const hashServiceCommandPayload=()=>{}'
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = 'export const requireEnterpriseUser=async()=>({uid:"U1"})'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(path) && existsSync(`${path}.ts`)) return { url: pathToFileURL(`${path}.ts`).href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  try {
    const { enterpriseAimsCreateProjectDocument } = await import('../server/utils/enterpriseAimsProjectDocumentWrites.ts')
    await enterpriseAimsCreateProjectDocument({})
    assert.deepEqual(globalThis.__hostCreateCalls, [{ action: 'create', payload: body }])
  } finally {
    hooks.deregister()
    delete globalThis.__hostCreateFixture
    delete globalThis.__hostCreateCalls
  }
})

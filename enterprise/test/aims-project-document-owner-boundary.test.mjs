import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('portfolio-only owner and inherited parent fail before Codocs or fixed U mutation', async () => {
  const calls = []
  globalThis.__p1OwnerBoundaryCalls = calls
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/codocsApi')) source = `const write=async()=>{globalThis.__p1OwnerBoundaryCalls.push('codocs'); throw Error('unexpected write')};export const createCodocsDocument=write,deleteCodocsProjectCabinetFile=write,uploadCodocsProjectCabinetFile=write`
    if (specifier === './projectDocumentPorts') source = `export const documentActor=async()=>({uid:'actor'});export const hostDocumentOwner=async(event,payload)=>{globalThis.__p1OwnerBoundaryCalls.push(payload);throw Object.assign(Error('portfolio owner'),{statusCode:409,data:{code:'project_document_portfolio_owner_unsupported'}})};export const hostDocumentWrite=async()=>{globalThis.__p1OwnerBoundaryCalls.push('runtime write')};export const hostProjectDocumentContext=async()=>{globalThis.__p1OwnerBoundaryCalls.push('context')}`
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  try {
    const { writeHostProjectDocument } = await import('../../aims/layer/server/internal/projectDocumentWrites.ts')
    for (const payload of [{ portfolioId: 9, title: 'test' }, { parentId: 8, title: 'test' }, { projectId: 263, parentId: 8, title: 'test' }]) {
      const before = calls.length
      await assert.rejects(writeHostProjectDocument({}, async () => {
        throw Error('unexpected permit')
      }, 'create-index', { documentUuid: '11111111-1111-4111-8111-111111111111' }, payload), e => e.statusCode === 409 && e.data.code === 'project_document_portfolio_owner_unsupported')
      assert.equal(calls.length, before + 1)
      assert.deepEqual(calls.at(-1), { ...payload, uuid: '11111111-1111-4111-8111-111111111111' })
    }
  } finally {
    hooks.deregister()
    delete globalThis.__p1OwnerBoundaryCalls
  }
})

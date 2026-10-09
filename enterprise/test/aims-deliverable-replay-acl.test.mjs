import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

test('document binding checks current Codocs ACL again before receipt replay', async () => {
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === './enterpriseCodocsDocumentReads' && context.parentURL?.includes('enterpriseAimsDeliverableDocumentAccess')) {
        return { url: 'data:text/javascript,export const enterpriseCodocsDocumentViewByUuid=async (...args)=>globalThis.__pa04CodocsCheck(...args)', shortCircuit: true }
      }
      return next(specifier, context)
    }
  })
  const uuid = '11111111-1111-4111-8111-111111111111'
  const calls = []
  try {
    const { requireDeliverableDocumentAccess } = await import('../server/utils/enterpriseAimsDeliverableDocumentAccess.ts')
    globalThis.__pa04CodocsCheck = async (_event, code, metadataOnly) => {
      calls.push({ code, metadataOnly })
    }
    await requireDeliverableDocumentAccess({}, { documentUuid: uuid })
    await requireDeliverableDocumentAccess({}, { documentUuid: uuid })
    assert.deepEqual(calls, [{ code: uuid, metadataOnly: true }, { code: uuid, metadataOnly: true }])
    globalThis.__pa04CodocsCheck = async () => {
      throw { statusCode: 403 }
    }
    await assert.rejects(requireDeliverableDocumentAccess({}, { documentUuid: uuid }), error => error.statusCode === 403)
    globalThis.__pa04CodocsCheck = async () => {
      throw new Error('dependency unavailable')
    }
    await assert.rejects(requireDeliverableDocumentAccess({}, { documentUuid: uuid }), error => error.statusCode === 503)
    await requireDeliverableDocumentAccess({}, { documentSource: 'repo', documentUuid: null })
    assert.match(readFileSync(new URL('../server/utils/enterpriseAimsDeliverables.ts', import.meta.url), 'utf8'), /requireDeliverableDocumentAccess\(event, call\.payload\)/)
    assert.match(readFileSync(new URL('../server/utils/enterpriseAimsWorkItemWorkspace.ts', import.meta.url), 'utf8'), /requireDeliverableDocumentAccess\(event, call\.payload\)/)
  } finally {
    delete globalThis.__pa04CodocsCheck
    hooks.deregister()
  }
})

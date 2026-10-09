/* eslint-disable @typescript-eslint/no-explicit-any -- VM isolates lease and executor boundaries. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productDocumentDispatch.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText

test('product dispatcher binds claimed operation to server request and product before execution', async () => {
  for (const mode of ['ok', 'unavailable', 'foreign', 'wrong-key', 'wrong-code']) {
    const exports: any = {}, calls: any[] = []
    const key = 'aims:product-document:create:request'
    runInNewContext(compiled, { exports, require: (name: string) => {
      if (name === 'h3') return { createError }
      if (name === './serviceTicketDeliveryOperation') return { createRequestServiceTicketDeliveryOperationIO: () => ({ callRuntime: async (path: string) => {
        calls.push(path)
        return mode === 'unavailable' ? null : { operationKey: mode === 'wrong-key' ? 'other' : key, idempotencyKey: key, operationCode: mode === 'wrong-code' ? 'other' : 'aims.codocs.product-document.create.v1', command: { productCode: mode === 'foreign' ? 'OTHER' : 'P' } }
      } }) }
      if (name === './productDocumentOperationExecutor') return { executeClaimedProductDocumentOperation: async () => {
        calls.push('execute')
        return { synced: true }
      } }
      throw new Error(name)
    } })
    const promise = exports.dispatchProductDocumentRequest({}, 'request', 'P')
    if (['foreign', 'wrong-key', 'wrong-code'].includes(mode)) await assert.rejects(promise, { statusCode: 409 })
    else assert.equal((await promise).synced, mode === 'ok')
    assert.equal(calls[0], `/v1/aims/integration-operations/${encodeURIComponent(key)}:claim`)
    assert.equal(calls.includes('execute'), mode === 'ok')
  }
})

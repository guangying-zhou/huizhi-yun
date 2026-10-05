import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productFeedbackDispatch.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('immediate feedback dispatch binds claimed operation to authorized source and survives failures', async () => {
  for (const mode of ['success', 'wrong-ticket', 'wrong-product', 'wrong-request', 'wrong-key', 'claim-failure', 'processing', 'succeeded']) {
    const exports: Record<string, (...args: unknown[]) => Promise<boolean>> = {}
    const id = '123e4567-e89b-42d3-a456-426614174000'
    let claimed = 0
    let executed = 0
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === './serviceTicketOpsKnowledgeOperation') return {
        createRequestOpsKnowledgeOperationIO: () => ({}),
        claimOpsKnowledgeOperation: async (_io: unknown, key: string) => {
          claimed++
          assert.equal(key, `altoc:product-feedback:create:${id}`)
          if (mode === 'claim-failure') throw new Error('unavailable')
          return { operationKey: mode === 'wrong-key' ? 'other' : key, command: {
            ticketCode: mode === 'wrong-ticket' ? 'ST-2' : 'ST-1',
            productCode: mode === 'wrong-product' ? 'P2' : 'P1',
            requestBizId: mode === 'wrong-request' ? 'other' : 'request'
          } }
        }
      }
      if (name === './productFeedbackOperation') return {
        isProductFeedbackOperation: () => true,
        executeProductFeedbackOperation: async () => {
          executed++
          return { succeeded: true }
        }
      }
      throw new Error(name)
    } })
    const result = await exports.dispatchProductFeedback!({}, {}, 'ST-1', {
      submissionId: id, productCode: 'P1', requestBizId: 'request', status: ['processing', 'succeeded'].includes(mode) ? mode : 'pending'
    })
    assert.equal(result, mode === 'success' || mode === 'succeeded')
    assert.equal(executed, mode === 'success' ? 1 : 0)
    assert.equal(claimed, ['processing', 'succeeded'].includes(mode) ? 0 : 1)
  }
})

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 走查 ISSUE-B-004：runtime 的职责分离检查曾把 paymentConfirmedBy / paidBy /
// confirmedBy 当作 actor，而 BFF 的 sanitizeRuntimeRecord 不清洗这些键。
// 它们都不是业务表的列，伪造后既不落库也不报错，只用来骗过「制单人 ≠ 付款人」。
//
// runtime 侧已改为只信任 operator_uid / current_user；BFF 侧同步删除这些键，
// 保证即使 runtime 将来又扩大 actor 解析范围，伪造值也到不了 runtime。

function dataRuntimeSource() {
  return readFileSync(new URL('../server/utils/dataRuntime.ts', import.meta.url), 'utf8')
}

describe('finance BFF strips forged payment actor keys', () => {
  test('runtimeAuthKeys covers every forged payment actor alias', () => {
    const source = dataRuntimeSource()
    const block = source.slice(
      source.indexOf('const runtimeAuthKeys = new Set(['),
      source.indexOf('function sanitizeRuntimeRecord')
    )
    assert.ok(block.length > 0, 'runtimeAuthKeys block must exist')

    for (const key of [
      'paymentConfirmedBy',
      'payment_confirmed_by',
      'paidBy',
      'paid_by',
      'confirmedBy',
      'confirmed_by'
    ]) {
      assert.ok(
        block.includes(`'${key}'`),
        `runtimeAuthKeys must strip ${key}; runtime duty separation must never see a client-supplied actor`
      )
    }
  })

  test('trusted identity is still rebuilt after sanitization', () => {
    const source = dataRuntimeSource()
    const sanitizeIndex = source.indexOf('const payload = uid ? sanitizeRuntimeRecord(objectBody(body))')
    const currentUserIndex = source.indexOf('payload.current_user = uid')
    const operatorIndex = source.indexOf('payload.operator_uid = uid')

    assert.notEqual(sanitizeIndex, -1, 'write body must be sanitized')
    assert.ok(sanitizeIndex < currentUserIndex, 'current_user must be rebuilt after sanitization')
    assert.ok(sanitizeIndex < operatorIndex, 'operator_uid must be rebuilt after sanitization')
  })

  test('created_by stays writable so the audit trail is preserved', () => {
    const source = dataRuntimeSource()
    const block = source.slice(
      source.indexOf('const runtimeAuthKeys = new Set(['),
      source.indexOf('function sanitizeRuntimeRecord')
    )
    // created_by 是真实表列，属审计信息，不能连带删除；
    // 制单人伪造由 runtime 侧「已落库记录优先」拦截。
    assert.ok(!block.includes(`'created_by'`), 'created_by must remain writable')
    assert.ok(!block.includes(`'createdBy'`), 'createdBy must remain writable')
  })
})

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 走查 ISSUE-B-001 / B-005：可靠命令投递失败被统一收敛成
// { succeeded:false, pending:true } + HTTP 202，但响应体仍是 code:0，
// 前端把 code:0 当成功，于是：
//   - 开票申请在生产必然 403（缺 finance:invoice-request:create grant），
//     用户看到绿色「开票申请已创建」
//   - 履约启动的 Aims 交付项目没建成，用户看到绿色「履约启动已执行」
//
// 这里锁住两件事：BFF 必须把投递结果作为一等字段返回；前端必须据此分流提示。

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('invoice request delivery failure is surfaced', () => {
  const bff = read('../server/api/v1/receivable-plans/[code]/invoice-request.post.ts')

  test('BFF returns explicit delivered / deliveryPending flags', () => {
    assert.match(bff, /delivered:\s*delivery\.succeeded === true/)
    assert.match(bff, /deliveryPending:\s*delivery\.succeeded !== true/)
  })

  test('BFF still returns the Finance-issued invoice request code separately', () => {
    // prepared.invoiceRequest 是未落库的构造体，没有 code；真正的编号只在
    // receipt 校验通过后才有（ISSUE-B-017）。
    assert.match(bff, /invoiceRequestCode:\s*'invoiceRequestCode' in delivery/)
  })

  for (const page of ['../app/pages/payments/[id].vue', '../app/pages/contracts/[id].vue']) {
    test(`${page} only shows success when delivered`, () => {
      const source = read(page)
      assert.ok(
        source.includes('response?.data?.delivered'),
        'invoice request toast must branch on the delivered flag'
      )
      assert.ok(
        source.includes('开票申请尚未送达 Finance'),
        'undelivered invoice request must warn instead of reporting success'
      )
    })

    test(`${page} no longer reads the retired financeSubmitError field`, () => {
      const source = read(page)
      // BFF 早已不返回该字段，旧的 warning 分支永远走不到（ISSUE-B-016）。
      assert.ok(!source.includes('financeSubmitError'), 'financeSubmitError branch must be removed')
    })

    test(`${page} does not read code off the unpersisted invoiceRequest object`, () => {
      const source = read(page)
      assert.ok(
        !source.includes('invoiceRequest?.code'),
        'invoice request code must come from data.invoiceRequestCode'
      )
    })
  }
})

describe('contract activation delivery failure is surfaced', () => {
  test('BFF returns deliveryOrchestrated / deliveryPending and pending operation count', () => {
    const bff = read('../server/api/v1/service/contracts/[contractCode]/activate-delivery.post.ts')
    assert.match(bff, /deliveryOrchestrated:\s*!activationOperationsPending/)
    assert.match(bff, /deliveryPending:\s*activationOperationsPending/)
    assert.match(bff, /pendingOperationCount:\s*pendingOperations\.length/)
  })

  test('contract page warns when Aims delivery orchestration did not complete', () => {
    const source = read('../app/pages/contracts/[id].vue')
    assert.ok(
      source.includes('response?.data?.deliveryOrchestrated'),
      'activation toast must branch on deliveryOrchestrated'
    )
    assert.ok(
      source.includes('合同已生效，但交付编排未完成'),
      'incomplete orchestration must warn instead of reporting success'
    )
    // 不得再出现「无条件成功」的写法。
    const unconditional = /await \$fetch\([^)]*activate-delivery[\s\S]{0,400}?toast\.add\(\{ title: '履约启动已执行', color: 'success' \}\)/
    const match = unconditional.exec(source)
    if (match) {
      assert.ok(
        match[0].includes('deliveryOrchestrated'),
        'activation success toast must be guarded by the delivery flag'
      )
    }
  })
})

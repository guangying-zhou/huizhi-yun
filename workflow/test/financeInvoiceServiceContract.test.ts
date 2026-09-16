import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// 与 codocsPublishServiceContract.test.ts 同构。走查 ISSUE-B-025 实测：
// Finance 曾把 bizUrl / callbackUrl 写进发往 Workflow 的冻结命令，而
// integrationoperation 的安全持久化校验按字段名后缀拒绝一切 url/uri 结尾字段，
// 于是这条链路在生产 100% 返回 400 integration_operation_content_unsafe。
// Codocs 早已按「目标应用拥有目标字段」修过，Finance 漏了。

const financeRuntime = readFileSync(
  new URL('../../data-runtime/internal/apps/finance/invoice_request_operation.go', import.meta.url), 'utf8')
const workflowRuntime = readFileSync(
  new URL('../../data-runtime/internal/apps/workflow/finance_invoice_receipt.go', import.meta.url), 'utf8')

test('Workflow owns Finance invoice target fields; the frozen command never carries them', () => {
  // 冻结命令不得携带目标地址字段
  assert.doesNotMatch(financeRuntime, /"bizUrl"/)
  assert.doesNotMatch(financeRuntime, /"callbackUrl"/)
  assert.doesNotMatch(workflowRuntime, /command\["bizUrl"\]/)
  assert.doesNotMatch(workflowRuntime, /command\["callbackUrl"\]/)

  // 目标字段由 Workflow 自行派生
  assert.match(workflowRuntime, /"biz_url": financeInvoiceWorkflowBizPath\(invoiceCode\)/)
  assert.match(workflowRuntime, /"callback_url": financeInvoiceWorkflowCallback/)
})

test('Finance invoice command keeps the fixed service contract and delegated actor', () => {
  assert.match(workflowRuntime, /ReceiptCommandFromBody\(\s*\n?\s*body, "workflow", financeInvoiceWorkflowOperationCode, financeInvoiceWorkflowCapability,/)
  assert.match(workflowRuntime, /receiptInput\.TrustedContext\.SourceApp != "finance"/)
  assert.match(workflowRuntime, /fmt\.Sprint\(body\["current_user"\]\)\) != actorUID/)
})

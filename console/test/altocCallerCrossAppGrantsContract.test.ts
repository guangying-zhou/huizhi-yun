import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Stream B 走查 ISSUE-B-001 / B-010：生产 altoc.runtime 缺少现行代码实际请求的
// 精确 capability，而 Console 的 scope 校验对 `<audience>:` 前缀只做精确匹配，
// 因此调用必然 403 insufficient_scope。
//
// 这组断言把「代码请求的 scope」与「seed 授予的 capability」绑在一起，避免二者
// 再次漂移。

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

test('Altoc caller grants match the capabilities the code actually requests', () => {
  const seed = read('../docs/sql/Console-SQL-Seed-v2.1-altoc-caller-cross-app-grants.sql')
  const verify = read('../docs/sql/Console-SQL-Verify-v2.1-altoc-caller-cross-app-grants.sql')
  const invoiceExecutor = read('../../altoc/server/utils/receivableInvoiceOperation.ts')

  // 代码侧：开票申请投递请求的正是这个 capability。
  assert.match(invoiceExecutor, /'finance:invoice-request:create'/)

  // seed 侧：必须授予 altoc 调用方，且拆成 resource_code + action 两列。
  assert.match(seed, /'finance:invoice-request', 'create'/)
  assert.match(seed, /'aims:service-ticket:work-item', 'create'/)
  assert.match(seed, /sc\.app_code='altoc' OR sc\.client_code IN \('altoc','altoc\.runtime'\)/)
  assert.match(seed, /ON DUPLICATE KEY UPDATE/)

  // verify 侧：两条都要能被核验。
  assert.match(verify, /finance:invoice-request:create/)
  assert.match(verify, /aims:service-ticket:work-item:create/)

  // 不得夹带任何凭据。
  assert.doesNotMatch(`${seed}\n${verify}`, /client_secret|secret_value|plaintext/i)
})

test('grant coverage verification checks the caller side, not only the target app', () => {
  const coverage = read('../docs/sql/Console-SQL-Verify-service-grant-coverage.sql')

  // 原脚本只校验「目标应用能不能调自己的 runtime」，于是 altoc -> finance /
  // altoc -> aims 在生产整体缺失却一直没被发现。跨应用 capability 必须两侧都查。
  const callerRow = (scope: string) =>
    new RegExp(
      `SELECT 'altoc' AS \`app_code\`, '${scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' AS \`required_scope\``
    )

  assert.match(coverage, callerRow('finance:invoice-request:create'))
  assert.match(coverage, callerRow('aims:service-ticket:work-item:create'))
})

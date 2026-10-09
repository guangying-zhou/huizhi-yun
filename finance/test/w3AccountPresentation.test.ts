import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { w3AccountTypeLabel, w3BalanceFlags } from '../app/utils/w3AccountPresentation.ts'
import type { BankAccount, BalanceSnapshot } from '../app/types/hostFinance'

test('W3 account pages compile, show referenced entity names and keep snapshots non-live', () => {
  for (const file of ['FinanceListPage.vue', 'BankAccountDetails.vue']) {
    const path = new URL(`../app/components/host/${file}`, import.meta.url)
    const source = readFileSync(path, 'utf8')
    const { descriptor, errors } = parse(source, { filename: path.pathname })
    assert.deepEqual(errors, [])
    assert.doesNotThrow(() => compileScript(descriptor, { id: file, inlineTemplate: true }))
    assert.match(source, /legal_entity_name/)
    assert.match(source, /latest_balance/)
    assert.match(source, /import CommonEmptyState from/)
    assert.match(source, /import ContentPageHeader from/)
    assert.ok(!source.includes('account_no_secret_ref'))
  }
  const list = readFileSync(new URL('../app/components/host/FinanceListPage.vue', import.meta.url), 'utf8')
  assert.match(list, /同日人工登记优先于导入/)
  assert.match(list, /已登记快照，非实时余额/)
  assert.ok(!/\.reduce\(/.test(list))
})

test('W3 account subtypes and balance flags distinguish missing history from known counts', () => {
  assert.equal(w3AccountTypeLabel({ account_type: 'bank', account_subtype: 'basic' } as BankAccount), '银行账户 · 基本户')
  assert.equal(w3AccountTypeLabel({ account_type: 'cash', account_subtype: 'basic' } as BankAccount), '现金')
  assert.deepEqual(w3BalanceFlags({ entry_count: null, distinct_amounts: null, latest_tie_count: null } as BalanceSnapshot), [])
  assert.deepEqual(w3BalanceFlags({ distinct_amounts: 2, latest_tie_count: 3 } as BalanceSnapshot), ['当日改过数', '同时刻多条（金额一致）'])
  assert.deepEqual(w3BalanceFlags({ distinct_amounts: 1, latest_tie_count: 1 } as BalanceSnapshot), [])
})

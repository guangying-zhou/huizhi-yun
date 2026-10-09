import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createAccountNumberReveal, accountNumberRevealError } from '../app/utils/accountNumberReveal.ts'
import { createHostFinanceClient, type FinanceFetchOptions } from '../app/utils/hostFinanceClient.ts'

function fixture(read: (reason: string) => Promise<string>) {
  let now = 0
  let tick = () => { }
  let stopped = 0
  const state = { accountNo: '', pending: false, remainingSeconds: 0, error: '' }
  const controller = createAccountNumberReveal(state, read, { now: () => now, every: (fn) => {
    tick = fn
    return 1 as unknown as ReturnType<typeof setInterval>
  }, stop: () => {
    stopped++
  } })
  return { state, controller, advance(ms: number) {
    now += ms
    tick()
  }, stopped: () => stopped }
}
test('revealed synthetic account clears at 60 seconds and cannot be copied after expiration', async () => {
  const f = fixture(async () => 'CLAUDE-FIXTURE-ACCOUNT')
  await f.controller.reveal('测试查看原因')
  assert.equal(f.state.remainingSeconds, 60)
  f.advance(59000)
  assert.equal(f.controller.value(), 'CLAUDE-FIXTURE-ACCOUNT')
  f.advance(1000)
  assert.equal(f.controller.value(), '')
  assert.equal(f.state.remainingSeconds, 0)
  assert.equal(f.stopped(), 1)
})
test('close, identity/route disposal invalidate a pending reveal and discard late sensitive response', async () => {
  let resolve!: (value: string) => void
  const f = fixture(() => new Promise((done) => {
    resolve = done
  }))
  const pending = f.controller.reveal('测试查看原因')
  f.controller.clear()
  resolve('CLAUDE-FIXTURE-LATE')
  await pending
  assert.equal(f.state.accountNo, '')
  assert.equal(f.state.pending, false)
  assert.equal(f.state.remainingSeconds, 0)
})
test('reveal validates reason before IO and maps 403/404/429/503 without raw errors', async () => {
  let calls = 0
  const f = fixture(async () => {
    calls++
    throw { statusCode: 503 }
  })
  await f.controller.reveal('短')
  assert.equal(calls, 0)
  await f.controller.reveal('测试查看原因')
  assert.equal(f.state.pending, false)
  assert.equal(f.state.accountNo, '')
  assert.match(f.state.error, /保险箱暂不可用/)
  assert.deepEqual([403, 404, 429, 503].map(statusCode => accountNumberRevealError({ statusCode })), ['没有查看完整账号的权限', '该账户没有保存完整账号', '查看次数过多，请稍后再试', '保险箱暂不可用，请稍后重试'])
})
test('reveal transport sends only reason to exact endpoint, with no automatic retries or cache state', async () => {
  const calls: {
    url: string
    options: FinanceFetchOptions
  }[] = []
  const api = createHostFinanceClient(async <T>(url: string, options: FinanceFetchOptions) => {
    calls.push({ url, options })
    return {} as T
  }, path => `/finance/api/v1${path}`)
  await api.revealAccountNo('BA/1', '测试查看原因')
  assert.deepEqual(calls[0], { url: '/finance/api/v1/bank-accounts/BA%2F1/reveal-account-no', options: { method: 'POST', body: { reason: '测试查看原因' }, retry: 0 } })
  const file = new URL('../app/components/host/AccountNumberReveal.vue', import.meta.url)
  const source = readFileSync(file, 'utf8')
  const descriptor = parse(source).descriptor
  assert.doesNotThrow(() => compileScript(descriptor, { id: file.pathname, inlineTemplate: true }))
  assert.match(source, /onScopeDispose/)
  assert.match(source, /sessionScope/)
  assert.match(source, /flush: 'sync'/)
  assert.doesNotMatch(source, /(?:useState\(|localStorage|sessionStorage|console\.(?:log|info)|fetch\([^)]*accountNo)/)
  const page = readFileSync(new URL('../app/components/host/BankAccountDetails.vue', import.meta.url), 'utf8')
  assert.match(page, /hasPermission\('bank_accounts', 'reveal-account-no'\)/)
  assert.match(page, /account\.account_type !== 'cash'/)
})

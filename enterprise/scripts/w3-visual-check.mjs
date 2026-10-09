import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { visualResponse } from '../test/fixtures/w3-visual-data.mjs'

// Run against the credential-free Enterprise dev process only. Playwright is a
// local test dependency (PLAYWRIGHT_MODULE may point at a disposable install).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const origin = 'http://127.0.0.1:3417'
const output = resolve(process.env.W3_VISUAL_OUTPUT || '.git/w3-visual')
await mkdir(output, { recursive: true })
const navSource = await readFile(new URL('../app/utils/enterprise-navigation.ts', import.meta.url), 'utf8')
const navigationIds = [...navSource.matchAll(/"id": "([^"]+)"/g)].map(match => match[1])
const permissions = {
  customer: ['view', 'edit', 'admin'], contract: ['view', 'edit', 'close', 'admin'],
  bank_accounts: ['view', 'edit', 'admin', 'reveal-account-no'], legal_entities: ['view', 'edit', 'admin'],
  migration_exceptions: ['view', 'resolve'], settings: ['admin'], projects: ['view', 'edit']
}
const exactButton = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click()
const cases = [
  { name: 'customers-list', path: '/altoc/customers', ready: 'CU-FIXTURE-0001' },
  { name: 'customers-hierarchy', path: '/altoc/customers', ready: 'CU-FIXTURE-0001', action: page => exactButton(page, '层级') },
  { name: 'customer-detail', path: '/altoc/customers/1', ready: '客户等级：' },
  { name: 'customer-parent-dialog', path: '/altoc/customers/1', ready: '客户等级：', action: page => exactButton(page, '设置上级客户') },
  { name: 'customer-primary-dialog', path: '/altoc/customers/1', ready: '客户等级：', action: page => exactButton(page, '设置或清空主联系人') },
  { name: 'customer-contact-star', path: '/altoc/customers/1', ready: '客户等级：', action: async (page) => {
    await page.getByRole('button', { name: '合成联系人长姓名的操作' }).click()
    await page.getByRole('menuitem', { name: '编辑星级' }).click()
  } },
  { name: 'contracts-list', path: '/altoc/contracts', ready: 'CT-FIXTURE-0001' },
  { name: 'contract-detail', path: '/altoc/contracts/1', ready: '历史导入合同' },
  { name: 'contract-annotate', path: '/altoc/contracts/1', ready: '历史导入合同', action: page => exactButton(page, '补充信息') },
  { name: 'contract-owner', path: '/altoc/contracts/1', ready: '历史导入合同', action: page => exactButton(page, '变更负责人') },
  { name: 'contract-projects', path: '/altoc/contracts/1', ready: '历史导入合同', action: page => exactButton(page, '关联项目') },
  { name: 'contract-complete', path: '/altoc/contracts/1', ready: '历史导入合同', action: page => exactButton(page, '完结') },
  { name: 'contract-terminate', path: '/altoc/contracts/1', ready: '历史导入合同', action: page => exactButton(page, '中止') },
  { name: 'entities-list', path: '/finance/legal-entities', ready: 'LE-FIXTURE-01' },
  { name: 'entity-create', path: '/finance/legal-entities', ready: 'LE-FIXTURE-01', action: page => exactButton(page, '新建主体') },
  { name: 'entity-edit', path: '/finance/legal-entities', ready: 'LE-FIXTURE-01', action: page => exactButton(page, '编辑') },
  { name: 'entity-deactivate', path: '/finance/legal-entities', ready: 'LE-FIXTURE-01', action: page => exactButton(page, '停用') },
  { name: 'accounts-list', path: '/finance/bank-accounts', ready: 'BA-FIXTURE-0001' },
  { name: 'account-create', path: '/finance/bank-accounts', ready: 'BA-FIXTURE-0001', action: page => exactButton(page, '新建账户') },
  { name: 'account-detail', path: '/finance/bank-accounts/BA-FIXTURE-0001', ready: '近10天余额' },
  { name: 'account-edit', path: '/finance/bank-accounts/BA-FIXTURE-0001', ready: '近10天余额', action: page => exactButton(page, '编辑账户') },
  { name: 'account-reveal', path: '/finance/bank-accounts/BA-FIXTURE-0001', ready: '近10天余额', action: page => exactButton(page, '查看完整账号') },
  { name: 'account-revealed', path: '/finance/bank-accounts/BA-FIXTURE-0001', ready: '近10天余额', action: async (page) => {
    await exactButton(page, '查看完整账号')
    await page.getByPlaceholder('请说明本次查看用途').fill('合成视觉验证用途')
    await exactButton(page, '确认查看')
  } },
  { name: 'account-register', path: '/finance/bank-accounts/BA-FIXTURE-0001', ready: '近10天余额', action: page => exactButton(page, '登记余额') },
  { name: 'account-history', path: '/finance/bank-accounts/BA-FIXTURE-0001', ready: '近10天余额', action: page => exactButton(page, page.viewportSize().width === 390 && page.url().includes('BA-FIXTURE') ? '当日流水' : page.url().includes('BA-FIXTURE') ? '流水' : '当日流水') },
  { name: 'balances-list', path: '/finance/bank-accounts/balances', ready: 'BA-FIXTURE-0001' },
  { name: 'balance-register', path: '/finance/bank-accounts/balances', ready: 'BA-FIXTURE-0001', action: page => exactButton(page, '登记余额') },
  { name: 'balance-history', path: '/finance/bank-accounts/balances', ready: 'BA-FIXTURE-0001', action: page => exactButton(page, page.viewportSize().width === 390 && page.url().includes('BA-FIXTURE') ? '当日流水' : page.url().includes('BA-FIXTURE') ? '流水' : '当日流水') },
  { name: 'altoc-migration-people', path: '/altoc/migration', ready: '合成原系统销售员工' },
  { name: 'altoc-identity-confirm', path: '/altoc/migration', ready: '合成原系统销售员工', action: page => exactButton(page, '确认匹配') },
  { name: 'altoc-migration-contacts', path: '/altoc/migration', ready: '合成原系统销售员工', action: page => page.getByRole('button', { name: /^待归属联系人/ }).click() },
  { name: 'altoc-contact-assign', path: '/altoc/migration', ready: '合成原系统销售员工', action: async (page) => {
    await page.getByRole('button', { name: /^待归属联系人/ }).click()
    await exactButton(page, '归属到客户')
  } },
  { name: 'altoc-contact-link', path: '/altoc/migration', ready: '合成原系统销售员工', action: async (page) => {
    await page.getByRole('button', { name: /^待归属联系人/ }).click()
    await exactButton(page, '关联已有联系人')
  } },
  { name: 'altoc-migration-others', path: '/altoc/migration', ready: '合成原系统销售员工', action: page => exactButton(page, '其它事项') },
  { name: 'finance-migration-contract', path: '/finance/migration', ready: 'CT-FIXTURE-0001' },
  { name: 'finance-migration-balances', path: '/finance/migration', ready: 'CT-FIXTURE-0001', action: page => page.getByRole('button', { name: /^余额待认领/ }).click() },
  { name: 'finance-balance-evidence', path: '/finance/migration', ready: 'CT-FIXTURE-0001', action: async (page) => {
    await page.getByRole('button', { name: /^余额待认领/ }).click()
    await exactButton(page, '查看原始登记明细')
  } },
  { name: 'finance-balance-claim', path: '/finance/migration', ready: 'CT-FIXTURE-0001', action: async (page) => {
    await page.getByRole('button', { name: /^余额待认领/ }).click()
    await exactButton(page, '登记余额')
  } },
  { name: 'finance-balance-conflict', path: '/finance/migration', ready: 'CT-FIXTURE-0001', action: page => page.getByRole('button', { name: /^同日余额冲突/ }).click() }
]
cases.push(
  { name: 'contract-complete-confirm', path: '/altoc/contracts/1', ready: '历史导入合同', action: async (page) => {
    await exactButton(page, '完结')
    await exactButton(page, '提交')
  } },
  { name: 'contract-terminate-confirm', path: '/altoc/contracts/1', ready: '历史导入合同', action: async (page) => {
    await exactButton(page, '中止')
    await page.getByRole('dialog').getByRole('textbox').fill('合成视觉验证，中止确认层')
    await exactButton(page, '提交')
  } },
  { name: 'account-edit-more', path: '/finance/bank-accounts/BA-FIXTURE-0001', ready: '近10天余额', action: async (page) => {
    await exactButton(page, '编辑账户')
    await page.getByText('更多账户资料', { exact: true }).click()
  } },
  { name: 'entity-edit-more', path: '/finance/legal-entities', ready: 'LE-FIXTURE-01', action: async (page) => {
    await exactButton(page, '编辑')
    await page.getByRole('dialog').locator('summary').click()
  } },
  { name: 'accounts-complete', path: '/finance/bank-accounts', ready: 'BA-FIXTURE-0001', action: page => page.getByRole('checkbox', { name: '完整结果（最多200条）' }).check() },
  { name: 'altoc-identity-apply', path: '/altoc/migration', ready: '合成原系统销售员工', action: page => exactButton(page, '应用到名下对象'), confirmed: true },
  { name: 'altoc-identity-reject', path: '/altoc/migration', ready: '合成原系统销售员工', action: page => exactButton(page, '标记无对应人员') },
  { name: 'altoc-contact-accept', path: '/altoc/migration', ready: '合成原系统销售员工', action: async (page) => {
    await page.getByRole('button', { name: /^待归属联系人/ }).click()
    await exactButton(page, '接受现状')
  } },
  { name: 'customer-contact-source', path: '/altoc/customers/1', ready: '客户等级：', action: async (page) => {
    await page.getByRole('heading', { name: '联系人', exact: true }).scrollIntoViewIfNeeded()
    if (page.viewportSize().width === 390) await page.locator('details').filter({ has: page.locator('summary').getByText('来源信息', { exact: true }) }).filter({ visible: true }).locator('summary').click()
  } }
)
cases.push(
  { name: 'accounts-empty', path: '/finance/bank-accounts', ready: '暂无记录', emptyAccounts: true },
  { name: 'accounts-no-permission', path: '/finance/bank-accounts', ready: '无权查看', denyAccounts: true },
  { name: 'account-subtype-picker', path: '/finance/bank-accounts/BA-FIXTURE-0001', ready: '近10天余额', action: async (page) => {
    await exactButton(page, '编辑账户')
    await page.getByText('更多账户资料', { exact: true }).click()
    await page.getByRole('dialog').getByRole('combobox').last().click()
  } }
)
cases.push(
  { name: 'altoc-identity-apply-confirm', path: '/altoc/migration', ready: '合成原系统销售员工', confirmed: true, action: async (page) => {
    await exactButton(page, '应用到名下对象')
    await exactButton(page, '确认处理')
  } },
  { name: 'altoc-identity-reject-confirm', path: '/altoc/migration', ready: '合成原系统销售员工', action: async (page) => {
    await exactButton(page, '标记无对应人员')
    await exactButton(page, '确认处理')
  } },
  { name: 'altoc-contact-accept-confirm', path: '/altoc/migration', ready: '合成原系统销售员工', action: async (page) => {
    await page.getByRole('button', { name: /^待归属联系人/ }).click()
    await exactButton(page, '接受现状')
    await exactButton(page, '确认处理')
  } }
)
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const width of (process.env.W3_VISUAL_WIDTHS || '1440,390').split(',').map(Number)) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' })
    await context.addCookies(['uid', 'tenant', 'subject_code', 'policy_ver', 'session_exp'].map((key, index) => ({ name: `hzy_enterprise_${key}`, value: ['fixture-user', 'FIXTURE', 'fixture-user', 'fixture-v1', String(Math.floor(Date.now() / 1000) + 86400)][index], url: origin })))
    const page = await context.newPage()
    let errors = [], unknown = [], blocked = [], currentCase = {}
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`)
    })
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) {
        blocked.push(url.origin)
        return route.abort()
      }
      if (url.pathname === '/enterprise/logo.svg') return route.fulfill({ contentType: 'image/svg+xml', body: await readFile(new URL('../public/logo.svg', import.meta.url), 'utf8') })
      if (!url.pathname.includes('/api/')) return route.continue()
      try {
        const body = request.postData() ? JSON.parse(request.postData()) : undefined
        const response = visualResponse(url, request.method(), body, currentCase.denyAccounts ? { ...permissions, bank_accounts: [] } : permissions, navigationIds)
        if (currentCase.emptyAccounts && url.pathname.endsWith('/bank-accounts')) {
          response.data = []
          response.total = 0
        }
        if (currentCase.confirmed && url.pathname.endsWith('/migration/identities')) response.data.forEach((row) => {
          row.match_status = 'confirmed'
        })
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) })
      } catch (error) {
        unknown.push(error.message)
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'fixture_api_missing' }) })
      }
    })
    for (const item of cases.filter(item => !process.env.W3_VISUAL_CASES || process.env.W3_VISUAL_CASES.split(',').includes(item.name))) {
      errors = []
      unknown = []
      blocked = []
      currentCase = item
      const result = { name: item.name, width, path: item.path }
      try {
        await page.goto(`${origin}${item.path}`, { timeout: 120000 })
        await page.getByText(item.ready, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: 20000 })
        if (item.action) {
          await item.action(page)
          if (!['customers-hierarchy', 'accounts-complete', 'altoc-migration-contacts', 'altoc-migration-others', 'finance-migration-balances', 'finance-balance-conflict', 'customer-contact-source', 'account-subtype-picker'].includes(item.name)) await page.getByRole('dialog').last().waitFor({ timeout: 10000 })
        }
        await page.locator('h1').first().waitFor()
        await page.waitForTimeout(600)
        result.layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, dialogs: [...document.querySelectorAll('[role="dialog"]')].map(el => ({ width: el.getBoundingClientRect().width, scrollWidth: el.scrollWidth, title: el.querySelector('h2')?.textContent })), oversized: [...document.querySelectorAll('input,button,[role="combobox"],h1,h2')].filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width && (r.right > innerWidth + 1 || r.left < -1) && !el.closest('[data-state="closed"]')
        }).map(el => ({ tag: el.tagName, text: (el.textContent || el.getAttribute('aria-label') || '').slice(0, 80) })) }))
        await page.screenshot({ path: `${output}/${item.name}-${width}.png`, fullPage: true })
        if (item.action && await page.getByRole('dialog').count()) {
          const scrolled = await page.evaluate(() => {
            let count = 0
            for (const el of document.querySelectorAll('[role="dialog"] [data-slot="body"]')) if (el.scrollHeight > el.clientHeight + 20) {
              el.scrollTop = el.scrollHeight
              count++
            }
            return count
          })
          if (scrolled) await page.screenshot({ path: `${output}/${item.name}-bottom-${width}.png`, fullPage: true })
        }
        if (item.name === 'contract-detail') {
          await page.getByRole('heading', { name: '下级合同', exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: `${output}/${item.name}-children-${width}.png`, fullPage: true })
        }
        if (item.name === 'customer-detail') {
          await page.getByRole('heading', { name: '联系人', exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: `${output}/${item.name}-contacts-${width}.png`, fullPage: true })
        }
        if (!item.action && /detail$/.test(item.name)) {
          await page.evaluate(() => {
            for (const el of document.querySelectorAll('main,[class*="overflow-y-auto"]')) el.scrollTop = el.scrollHeight
          })
          await page.screenshot({ path: `${output}/${item.name}-bottom-${width}.png`, fullPage: true })
        }
      } catch (error) {
        result.failure = error.message
        await page.screenshot({ path: `${output}/${item.name}-failed-${width}.png` })
      }
      Object.assign(result, { errors: [...new Set(errors)], unknown: [...new Set(unknown)], blocked: [...new Set(blocked)] })
      results.push(result)
      console.log(JSON.stringify(result))
    }
    await context.close()
  }
} finally {
  await browser.close()
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2))
}

const failures = results.filter(result => result.failure || result.errors.length || result.unknown.length || result.blocked.length || result.layout?.document > result.width || result.layout?.oversized.length || result.layout?.dialogs.some(dialog => dialog.width > result.width || dialog.scrollWidth > dialog.width + 1))
console.log(`Visual cases: ${results.length}; failures: ${failures.length}`)
if (failures.length) process.exitCode = 1

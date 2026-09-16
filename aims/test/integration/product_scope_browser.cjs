// Full repository page with mocked APIs;
// does not validate real tenant authorization.
const { chromium } = require(process.env.HZY_PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

const baseURL = new URL(process.env.HZY_PRODUCT_UI_PREVIEW_URL || 'http://127.0.0.1:3317')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(baseURL.hostname))
  throw new Error('Use an isolated local preview');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (const width of [1440, 390]) {
      const p = await browser.newPage({ viewport: { width, height: 900 } })
      const errors = []
      p.on('pageerror', e => errors.push(e.message))
      const keys = []
      let editable = true, publicScope = false, revision = 4, writes = 0, reads = 0
      await p.route('**/api/**', r => r.abort())
      await p.route('**/api/v1/products/P1/**', (r) => {
        const path = new URL(r.request().url()).pathname
        let data
        if (path.endsWith('/visibility')) {
          writes++
          const body = r.request().postDataJSON()
          assert.equal(body.isPublic, true)
          assert.equal(body.expectedRevision, 4)
          keys.push(r.request().headers()['idempotency-key'])
          if (writes === 1) return r.fulfill({ json: { code: 0, data: {} } })
          publicScope = true
          revision++
          return r.fulfill({ json: { code: 0, data: { value: { id: 3, version_id: 2, is_public: true, workspace_revision: 5, revision: 6, scope_revision: 7 } } } })
        }
        if (path.endsWith('/permissions'))
          data = { product_code: 'P1', status: 'active', scope_create: false, accept: true, edit: editable }
        else if (path.endsWith('/features')) {
          reads++
          data = { items: [{ id: 3, version_id: 2, title: '客户反馈关联范围', description: '范围说明', status: 'planned', change_type: null, legacy_unscored: true, planning_item_biz_id: null, is_public: publicScope, acceptance_criteria: '验收通过' }], total: 1, workspace_revision: revision, version_revision: 5, scope_revision: 6 }
        } else
          data = { id: 2, product_code: 'P1', status: 'planning', current_release_record_id: null }
        return r.fulfill({ json: { code: 0, data } })
      })
      await p.goto(new URL('/products/P1/versions/2/features', baseURL).href)
      await p.getByRole('button', { name: '设为公开', exact: true }).click()
      await p.getByLabel('变更原因').fill('公开范围审核通过')
      await p.getByRole('button', { name: '保存公开设置', exact: true }).click()
      await p.getByRole('button', { name: '确认', exact: true }).click()
      await p.getByText('未能确认保存结果。可使用相同内容重试；如版本已变化，请关闭后刷新列表。', { exact: true }).waitFor()
      assert.equal(reads, 1)
      await p.getByRole('button', { name: '保存公开设置', exact: true }).click()
      await p.getByRole('button', { name: '确认', exact: true }).click()
      await p.getByRole('button', { name: '设为内部', exact: true }).waitFor()
      assert.equal(writes, 2)
      assert.ok(keys[0])
      assert.equal(keys[0], keys[1])
      assert.ok(reads >= 2)
      editable = false
      await p.getByRole('button', { name: '重新读取', exact: true }).click()
      await p.getByRole('button', { name: '设为内部', exact: true }).waitFor({ state: 'detached' })
      await p.getByRole('heading', { name: '客户反馈关联范围', exact: true }).waitFor()
      await p.waitForLoadState('networkidle')
      assert.equal(await p.getByRole('button', { name: '设为内部', exact: true }).count(), 0)
      assert.equal(await p.getByRole('button', { name: '补录验收标准', exact: true }).count(), 0)
      assert.deepEqual(errors, [])
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), width)
      assert.equal(await p.getByRole('button', { name: '确认交付', exact: true }).isEnabled(), true)
      console.log('PASS scope page refresh and permissions ' + width)
      await p.close()
    }
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

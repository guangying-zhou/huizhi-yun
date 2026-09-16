// 产品工作台（三工作视角）浏览器回归。
//
// 使用仓库实际的 products/[productCode].vue 外壳、ProductsNavbar、概览页和设置页，
// 在隔离 Nuxt 预览中模拟全部 /api/v1 响应，在 1440 / 390 视口检查：
// 一级视角页签、二级入口、跨视角 view 参数、产品切换器、概览工作视角卡片、
// 设置页归位，以及两个视口都没有横向溢出和 pageerror。
//
// 它不证明真实租户授权、Console 会话或后端契约。
const path = require('node:path')
const assert = require('node:assert/strict')

const previewUrl = process.env.HZY_PRODUCT_UI_PREVIEW_URL || 'http://localhost:3317'
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(previewUrl)) {
  throw new Error('HZY_PRODUCT_UI_PREVIEW_URL 必须是本机回环预览地址')
}
const playwrightModule = process.env.HZY_PLAYWRIGHT_MODULE
const { chromium } = require(playwrightModule ? path.resolve(playwrightModule) : 'playwright')

const CODE = 'HZ-TY-S-002'
const OUT = process.env.HZY_PRODUCT_UI_SCREENSHOT_DIR || '/tmp/hzy-product-browser-qa'

const workspace = {
  product_code: CODE,
  biz_id: 'b1',
  product_name: '统一运维服务平台',
  product_line: 'software',
  product_line_label: '软件产品线',
  positioning: '面向中小型软件企业的统一运维与交付协同平台，覆盖研发、交付与经营三类岗位。',
  target_users: '产品负责人、交付经理、企业负责人',
  value_statement: '一份产品事实，三个岗位视角。',
  status: 'active',
  revision: 7
}

const counts = {
  '/features': 42,
  '/versions': 9,
  '/requests': 5,
  '/objectives': 3
}

async function mockApi(page, state = {}) {
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname.replace(/^\/api\/v1/, '')
    const base = `/products/${encodeURIComponent(CODE)}`

    if (p === '/products') {
      return route.fulfill({ json: { code: 0, data: {
        items: [
          { product_code: CODE, biz_id: 'b1', status: 'active', product_name: '统一运维服务平台', product_line: 'software', product_line_label: '软件产品线', source_status: 'ga' },
          { product_code: 'HZ-TY-S-003', biz_id: 'b2', status: 'active', product_name: '资产管理平台', product_line: 'software', product_line_label: '软件产品线', source_status: 'ga' }
        ],
        total: 2, page: 1, pageSize: 20, catalog_generation: 'g1', catalog_updated_at: '2026-09-10T02:00:00.000Z'
      } } })
    }
    if (p === '/product-permissions') return route.fulfill({ json: { code: 0, data: { onboard: true } } })
    if (p === base) return route.fulfill({ json: { code: 0, data: workspace } })
    if (p === `${base}/permissions`) {
      return route.fulfill({ json: { code: 0, data: { edit: true, archive: true, restore: false, admin: true } } })
    }
    if (p === `${base}/members`) {
      return route.fulfill({ json: { code: 0, data: { items: [{ uid: 'pm', relation_type: 'manager', status: 'active', valid_from: '2026-01-01', valid_until: null, effective: true, revision: 1 }], total: 1, page: 1, pageSize: 20 } } })
    }
    if (p === `${base}/roadmaps/adoption`) {
      // Assets 明确拒绝原用户对象范围：页面必须给出可执行的补权提示。
      if (state.adoption === 'scope-denied') {
        return route.fulfill({ status: 403, json: {
          statusCode: 403,
          message: '当前用户在 Assets 没有交付资产或环境的查看范围，无法查看产品采用。',
          data: { reason: 'assets_object_scope_denied' }
        } })
      }
      // 服务身份/令牌类问题保持 503，页面不得提示用户去申请权限。
      if (state.adoption === 'service-rejected') {
        return route.fulfill({ status: 503, json: {
          statusCode: 503,
          message: '产品采用服务调用未被 Assets 接受，请检查服务授权与部署绑定。',
          data: { reason: 'product_adoption_service_rejected' }
        } })
      }
      return route.fulfill({ json: { code: 0, data: {
        productCode: CODE, queriedAt: '2026-09-10T02:00:00Z', page: 1, pageSize: 20, total: 2,
        summary: { instances: 2, environments: 2, customers: 2, productionInstances: 2, unknownVersionInstances: 0, conflictingVersionInstances: 0 },
        items: [
          { deliveryAssetCode: 'DA-1', environmentCode: 'ENV-PROD-1', customerCode: 'CUST-001', roles: ['production'], deploymentStatuses: ['online'], versions: ['2026.09.01'], adopted: true, production: true, versionUnknown: false, versionConflict: false },
          { deliveryAssetCode: 'DA-2', environmentCode: 'ENV-PROD-2', customerCode: 'CUST-002', roles: ['production'], deploymentStatuses: ['accepted'], versions: ['2026.08.01'], adopted: true, production: true, versionUnknown: false, versionConflict: false }
        ]
      } } })
    }
    if (p === `${base}/planning-items` && route.request().method() === 'POST') {
      state.planningInput = route.request().postDataJSON()
      return route.fulfill({ json: { code: 0 } })
    }
    if ([`${base}/planning-items`, `${base}/planning-cycles`].includes(p)) return route.fulfill({ json: { code: 0, data: { items: [], total: 0, workspace_revision: workspace.revision } } })
    if ([`${base}/planning-items/permissions`, `${base}/planning-cycles/permissions`].includes(p)) return route.fulfill({ json: { code: 0, data: { product_code: CODE, status: 'active', edit: true, prioritize: true } } })
    if (p.endsWith('/sources') || p.endsWith('/merged-sources')) return route.fulfill({ json: { code: 0, data: { items: [], total: 0, page: 1, pageSize: 20 } } })
    for (const [suffix, total] of Object.entries(counts)) {
      if (p === `${base}${suffix}`) {
        const pageSize = Number(url.searchParams.get('pageSize') || 20)
        const size = Math.min(pageSize, total)
        const items = Array.from({ length: size }, (_, i) => (suffix === '/versions'
          ? { id: i + 1, product_code: CODE, version_code: `2026.0${i + 1}.01`, name: null, description: null, status: 'released', planned_release_date: null }
          : { id: i + 1, biz_id: `f${i}`, product_code: CODE, title: `条目 ${i + 1}`, description: null, lifecycle: 'active', component_id: null, revision: 1 }))
        return route.fulfill({ json: { code: 0, data: { items, total, page: 1, pageSize, workspace_revision: workspace.revision, unmerged_total: suffix === '/requests' ? total : undefined } } })
      }
      if (p === `${base}${suffix}/permissions`) {
        return route.fulfill({ json: { code: 0, data: { product_code: CODE, status: 'active', revision: workspace.revision, edit: true, create: true, decide: true, delete: false } } })
      }
    }
    // 预览只允许显式声明的接口，其他一律拒绝，避免误判为真实链路。
    return route.abort()
  })
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      const state = {}
      await mockApi(page, state)

      // 概览：产品身份、五个一级视角、三张工作视角卡片
      await page.goto(`${previewUrl}/products/${CODE}`)
      await page.getByRole('heading', { name: '统一运维服务平台' }).waitFor()
      for (const tab of ['概览', '产品与研发', '销售与交付', '经营与管理', '设置']) {
        await page.getByRole('link', { name: tab, exact: true }).first().waitFor()
      }
      await page.getByRole('heading', { name: '工作视角' }).waitFor()
      await page.getByText('产品负责人、研发负责人').waitFor()
      await page.getByText('销售、售前、项目经理、服务人员').waitFor()
      await page.getByText('企业负责人、业务负责人').waitFor()
      await page.getByText('功能目录').first().waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, '概览出现横向溢出')
      await page.screenshot({ path: `${OUT}/product-workspace-overview-${width}.png`, fullPage: true })

      // 一级视角切换：销售与交付进入客户采用，二级入口按岗位呈现
      await page.getByRole('link', { name: '销售与交付', exact: true }).first().click()
      await page.waitForURL(`**/products/${CODE}/adoption`)
      for (const label of ['客户采用', '已发布能力', '版本发布', '版本差异', '产品资料']) {
        await page.getByRole('link', { name: label, exact: true }).first().waitFor()
      }
      await page.getByText('DA-1', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, '销售与交付出现横向溢出')
      await page.screenshot({ path: `${OUT}/product-workspace-gtm-${width}.png`, fullPage: true })

      // 缺 Assets 对象范围：提示要指出补哪个权限，而不是通用失败
      state.adoption = 'scope-denied'
      await page.getByRole('button', { name: '刷新采用数据' }).click()
      await page.getByText('需要 Assets 交付资产与环境的查看范围').waitFor()
      await page.getByText('deliveries:view', { exact: false }).first().waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, '采用权限提示出现横向溢出')
      await page.screenshot({ path: `${OUT}/product-workspace-adoption-denied-${width}.png`, fullPage: true })

      // 服务侧问题：不得出现让用户去申请权限的提示
      state.adoption = 'service-rejected'
      await page.getByRole('button', { name: '刷新采用数据' }).click()
      await page.getByText('需要 Assets 交付资产与环境的查看范围').waitFor({ state: 'hidden' })
      assert.ok(
        !(await page.getByText('需要 Assets 交付资产与环境的查看范围').count()),
        '服务侧失败误报为用户缺权'
      )
      state.adoption = undefined
      await page.getByRole('button', { name: '刷新采用数据' }).click()
      await page.getByText('DA-1', { exact: true }).waitFor()

      // 跨视角复用页面：从销售视角进入版本，URL 带 view=gtm 且视角保持高亮
      await page.getByRole('link', { name: '版本发布', exact: true }).first().click()
      await page.waitForURL(`**/products/${CODE}/versions?view=gtm`)
      await page.getByRole('link', { name: '客户采用', exact: true }).first().waitFor()
      const activeTab = await page.evaluate(() => {
        const active = Array.from(document.querySelectorAll('a')).find(a => a.className.includes('border-primary'))
        return active ? active.textContent.trim() : ''
      })
      assert.equal(activeTab, '销售与交付', '跨视角链接没有保持来源视角高亮')

      // 产品与研发：需求规划收进需求管理
      await page.getByRole('link', { name: '产品与研发', exact: true }).first().click()
      await page.waitForURL(`**/products/${CODE}/features`)
      for (const label of ['功能目录', '产品模块', '需求管理', '产品版本', '关联项目']) {
        await page.getByRole('link', { name: label, exact: true }).first().waitFor()
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, '产品与研发出现横向溢出')
      await page.screenshot({ path: `${OUT}/product-workspace-rd-${width}.png`, fullPage: true })
      await page.getByRole('button', { name: '更多' }).click()
      await page.getByRole('menuitem', { name: '功能版本矩阵' }).waitFor()
      await page.screenshot({ path: `${OUT}/product-workspace-rd-more-${width}.png` })
      await page.keyboard.press('Escape')

      await page.getByRole('link', { name: '需求管理', exact: true }).click()
      await page.getByRole('region', { name: '需求推进' }).waitFor()
      assert.equal(await page.getByRole('link', { name: '规划事项', exact: true }).count(), 0)
      assert.equal(await page.getByRole('link', { name: '规划周期', exact: true }).count(), 0)
      await page.getByRole('button', { name: '条目 1', exact: true }).click()
      await page.getByRole('button', { name: '明确建设范围', exact: true }).click()
      await page.getByRole('dialog', { name: '明确建设范围', exact: true }).waitFor()
      assert.equal(await page.getByRole('textbox', { name: '事项标题' }).inputValue(), '条目 1')
      await page.getByRole('textbox', { name: '本次建设范围' }).fill('统一登录支持 SAML，保留现有 OIDC 登录。')
      await page.getByRole('button', { name: '创建事项', exact: true }).click()
      await page.getByRole('dialog', { name: '明确建设范围', exact: true }).waitFor({ state: 'hidden' })
      assert.deepEqual(state.planningInput.requests, [{ bizId: 'f0', revision: 1 }])
      assert.equal(state.planningInput.expectedRevision, workspace.revision)
      assert.equal(state.planningInput.title, '条目 1')
      await page.getByRole('link', { name: '整理建设范围', exact: true }).click()
      await page.waitForURL(`**/products/${CODE}/planning`)
      await page.getByRole('link', { name: '返回需求管理', exact: true }).waitFor()
      assert.ok((await page.getByRole('link', { name: '需求管理', exact: true }).getAttribute('class')).includes('text-primary'))
      await page.getByRole('link', { name: '安排优先级', exact: true }).click()
      await page.waitForURL(`**/products/${CODE}/cycles`)
      await page.getByRole('button', { name: '刷新周期', exact: true }).waitFor()
      await page.getByRole('link', { name: '返回需求管理', exact: true }).waitFor()
      assert.ok((await page.getByRole('link', { name: '需求管理', exact: true }).getAttribute('class')).includes('text-primary'))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, '需求规划出现横向溢出')
      await page.screenshot({ path: `${OUT}/product-request-planning-${width}.png`, fullPage: true })
      await page.getByRole('link', { name: '返回需求管理', exact: true }).click()
      await page.getByRole('region', { name: '需求推进' }).waitFor()
      await page.screenshot({ path: `${OUT}/product-request-management-${width}.png`, fullPage: true })
      await page.getByRole('link', { name: '功能目录', exact: true }).click()

      // 产品切换器：搜索并切换，保持当前视角
      await page.getByRole('button', { name: '切换产品' }).click()
      await page.getByPlaceholder('搜索产品名称或编码').waitFor()
      await page.getByText('资产管理平台').click()
      await page.waitForURL('**/products/HZ-TY-S-003/features')
      await page.goBack()

      // 设置页承接产品信息维护、生命周期与成员
      await page.goto(`${previewUrl}/products/${CODE}/settings`)
      await page.getByRole('heading', { name: '产品信息' }).waitFor()
      await page.getByRole('button', { name: '编辑产品信息' }).waitFor()
      await page.getByText('pm', { exact: true }).first().waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, '设置页出现横向溢出')
      await page.screenshot({ path: `${OUT}/product-workspace-settings-${width}.png`, fullPage: true })

      assert.deepEqual(errors, [], `${width} 出现 pageerror`)
      console.log(`PASS product workspace ${width}`)
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})

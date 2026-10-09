/**
 * 项目集默认分类契约（PIVR V1.1 §1.4 / B1.6）
 *
 * 项目集通过 default_category 承载执行形态：
 *   - routine 为强约束，日常事务容器分类不可覆盖，否则 §4.4 工时闭合出现缺口
 *   - 其余默认分类仅在调用方未显式指定时生效
 *   - is_product_line 降级为 default_category === 'product_dev' 的派生值
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

const portfoliosGo = read('../../data-runtime/internal/apps/aims/portfolios.go')
const projectCreateGo = read('../../data-runtime/internal/apps/aims/product_versions.go')
const newPage = read('../app/pages/projects/new.vue')
const createModal = read('../app/components/project/ProjectCreateModal.vue')

describe('项目集默认分类：服务端约束', () => {
  test('routine 项目集全局唯一', () => {
    assert.match(portfoliosGo, /func \(a \*Adapter\) ensureSingleRoutinePortfolio/)
    assert.match(portfoliosGo, /routine_portfolio_exists/)
    // 创建与更新都要校验，否则可通过改已有项目集绕开唯一性
    const calls = portfoliosGo.match(/ensureSingleRoutinePortfolio\(ctx,/g) || []
    assert.ok(calls.length >= 2, `创建与更新都必须校验 routine 唯一性，实际调用 ${calls.length} 处`)
  })

  test('系统预置项目集不可删除', () => {
    assert.match(portfoliosGo, /portfolio_is_system/)
    assert.match(portfoliosGo, /SELECT is_system FROM project_portfolios WHERE id = \?/)
  })

  test('improvement 不能作为项目集默认分类', () => {
    assert.match(portfoliosGo, /default_category_deprecated/)
  })

  test('is_product_line 随 default_category 派生写入', () => {
    assert.match(portfoliosGo, /func derivedIsProductLine/)
    assert.match(portfoliosGo, /defaultCategory == "product_dev"/)
  })

  test('routine 分类在项目创建时不可覆盖', () => {
    assert.match(projectCreateGo, /routine_category_locked/)
    assert.match(projectCreateGo, /case defaultCategory == "routine":/)
    // 其余默认分类仅在未显式指定时生效
    assert.match(projectCreateGo, /case defaultCategory != "" && requestedCategory == "":/)
  })
})

describe('项目集默认分类：前端表现', () => {
  for (const [name, source] of [['new.vue', newPage], ['ProjectCreateModal', createModal]] as const) {
    test(`${name} 按 defaultCategory 预设分类且仅 routine 锁定`, () => {
      assert.match(source, /defaultCategory/, `${name} 应读取项目集 defaultCategory`)
      assert.match(source, /=== 'routine'/, `${name} 应只在 routine 时锁定分类`)
      assert.doesNotMatch(
        source,
        /isProductLine/,
        `${name} 不应再依赖 isProductLine，该字段已降级为派生值`
      )
    })
  }

  test('new.vue 的竞态防护仍以 effectiveProjectCategory 为准', () => {
    // 该防护来自 fix(aims) 修复项目模板类别竞态，B1.6 泛化时必须保留
    assert.match(newPage, /const effectiveProjectCategory = computed<ProjectCategory>/)
    assert.match(newPage, /effectiveProjectCategory\.value !== category/)
  })
})

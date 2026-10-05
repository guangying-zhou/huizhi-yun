import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  components,
  features,
  requests,
  planningItems,
  cycles,
  versions,
  flatComponents
} from '../scripts/product-center-demo-content.mjs'
import { productComponentWriteInput } from '../server/utils/productComponentInput.ts'
import { productFeatureCreateInput, productFeatureComponentInput } from '../server/utils/productFeatureInput.ts'
import { productRequestCreateInput } from '../server/utils/productRequestInput.ts'
import { productPlanningCreateInput } from '../server/utils/productPlanningInput.ts'
import { productPlanningCycleCreateInput } from '../server/utils/productPlanningCycleInput.ts'
import { productVersionCreateInput } from '../server/utils/productVersionInput.ts'

// 示例内容最终要经服务端同一套校验器；这里用真实校验器逐条验证，
// 避免脚本跑到一半才因为字段超长、枚举拼错或日期非法而失败。
const revision = 7

function duplicates(values: string[]) {
  const seen = new Set<string>()
  return values.filter(value => seen.size === seen.add(value).size)
}

describe('product center demo content', () => {
  test('模块两级结构可被模块创建校验接受', () => {
    for (const root of components) {
      assert.ok(productComponentWriteInput({ parentId: null, expectedRevision: revision, name: root.name, description: root.description, sortOrder: root.sortOrder }), root.name)
      for (const child of root.children || []) {
        assert.ok(productComponentWriteInput({ parentId: 1, expectedRevision: revision, name: child.name, description: child.description, sortOrder: child.sortOrder }), child.name)
      }
    }
    // 模块最多三级，示例保持两级；同一父下名称唯一，脚本才能按名称跳过已存在项。
    for (const root of components) {
      assert.deepEqual(duplicates((root.children || []).map(child => child.name)), [], root.name)
      for (const child of root.children || []) assert.equal(child.children, undefined)
    }
    assert.deepEqual(duplicates(components.map(root => root.name)), [])
    assert.deepEqual(duplicates(flatComponents().map(item => item.key)), [])
  })

  test('功能条目可被创建与归属命令接受，且模块引用存在', () => {
    const keys = new Set(flatComponents().map(item => item.key))
    const uuid = '00000000-0000-4000-8000-000000000000'
    for (const feature of features) {
      assert.ok(productFeatureCreateInput({ expectedRevision: revision, title: feature.title, description: feature.description }), feature.title)
      assert.ok(keys.has(feature.module), `${feature.title} 引用了不存在的模块 ${feature.module}`)
      assert.ok(productFeatureComponentInput({ componentId: 1, expectedRevision: revision, expectedFeatureRevision: 1, reason: '示例内容：按平台分层归属模块' }, uuid), feature.title)
    }
    assert.deepEqual(duplicates(features.map(item => item.title)), [])
  })

  test('需求条目可被需求创建校验接受', () => {
    for (const row of requests) {
      const input = productRequestCreateInput({ expectedRevision: revision, title: row.title, problemStatement: row.problemStatement, sourceType: row.sourceType, urgencyLevel: row.urgencyLevel })
      assert.ok(input, row.title)
      assert.equal(input.source_type, row.sourceType)
      assert.equal(input.urgency_level, row.urgencyLevel)
    }
    assert.deepEqual(duplicates(requests.map(item => item.title)), [])
  })

  test('规划事项可被规划创建校验接受', () => {
    for (const row of planningItems) {
      const input = productPlanningCreateInput({ expectedRevision: revision, title: row.title, scopeSummary: row.scopeSummary, investmentCategory: row.investmentCategory, urgencyLevel: row.urgencyLevel })
      assert.ok(input, row.title)
      assert.equal(input.investment_category, row.investmentCategory)
    }
    assert.deepEqual(duplicates(planningItems.map(item => item.title)), [])
  })

  test('规划周期可被周期创建校验接受且区间不重叠', () => {
    for (const row of cycles) {
      assert.ok(productPlanningCycleCreateInput({ expectedRevision: revision, title: row.title, startsOn: row.startsOn, endsOn: row.endsOn, goalSummary: row.goalSummary, reviewIntervalDays: row.reviewIntervalDays }), row.title)
    }
    const sorted = [...cycles].sort((a, b) => a.startsOn.localeCompare(b.startsOn))
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i]!.startsOn > sorted[i - 1]!.endsOn, `${sorted[i]!.title} 与上一周期区间重叠`)
    }
    assert.deepEqual(duplicates(cycles.map(item => item.title)), [])
  })

  test('产品版本可被版本创建校验接受，编码唯一且计划日期递增', () => {
    for (const row of versions) {
      const input = productVersionCreateInput({ expectedRevision: revision, versionCode: row.versionCode, name: row.name, description: row.description, plannedReleaseDate: row.plannedReleaseDate })
      assert.ok(input, row.versionCode)
      assert.equal(input.planned_release_date, row.plannedReleaseDate)
      // businessOwnerUid 由命令行提供，缺省时不得出现在请求体里。
      assert.ok(!Object.hasOwn(input, 'business_owner_uid'))
    }
    assert.deepEqual(duplicates(versions.map(item => item.versionCode)), [])
    for (let i = 1; i < versions.length; i++) {
      assert.ok(versions[i]!.plannedReleaseDate > versions[i - 1]!.plannedReleaseDate, versions[i]!.versionCode)
    }
  })

  test('示例内容有足够体量支撑各页签评估', () => {
    assert.ok(components.length >= 4)
    assert.ok(flatComponents().length >= 15)
    assert.ok(features.length >= 25)
    assert.ok(requests.length >= 8)
    assert.ok(planningItems.length >= 5)
    assert.ok(cycles.length >= 2)
    assert.ok(versions.length >= 3)
  })
})

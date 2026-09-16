/**
 * PIVR 里程碑模板契约测试
 *
 * 规范来源：《汇智PIVR项目管理生命周期模型说明书V1.1》§3 业务场景适配映射表
 *
 * 里程碑名称与 mode 的唯一来源是 app/config/milestone.ts。本测试断言
 * data-runtime 的 defaultProjectMilestoneSeeds 与之逐字段一致，防止两侧漂移——
 * 新增项目分类时若只改一侧，本测试失败。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

import { pivrTypeMapping, pivrMilestoneModes, pivrStageOrder } from '../app/config/milestone.ts'

const goSource = readFileSync(
  new URL('../../data-runtime/internal/apps/aims/project_templates.go', import.meta.url),
  'utf8'
)

type GoSeed = { name: string, mode: string, pivrStage: string, sortOrder: number, recurrenceRule: string }

/** 从 Go 源码中提取 defaultProjectMilestoneSeeds 各 case 分支的种子定义 */
function parseGoSeeds(): Map<string, GoSeed[]> {
  const fnStart = goSource.indexOf('func defaultProjectMilestoneSeeds(category string) []defaultProjectMilestoneSeed {')
  assert.ok(fnStart > 0, 'defaultProjectMilestoneSeeds 未找到，Go 侧函数签名可能已变更')
  const fnBody = goSource.slice(fnStart, goSource.indexOf('\n}\n', fnStart))

  const result = new Map<string, GoSeed[]>()
  const casePattern = /case "([a-z_]+)":([\s\S]*?)(?=\n\tcase |\n\tdefault:|$)/g
  for (const match of fnBody.matchAll(casePattern)) {
    const category = match[1]!
    const seeds: GoSeed[] = []
    const seedPattern = /\{Key: "[^"]*", Name: "([^"]*)", Mode: "([^"]*)", PivrStage: "([^"]*)", SortOrder: (\d+)(?:, RecurrenceRule: "([^"]*)")?\}/g
    for (const seed of match[2]!.matchAll(seedPattern)) {
      seeds.push({
        name: seed[1]!,
        mode: seed[2]!,
        pivrStage: seed[3]!,
        sortOrder: Number(seed[4]),
        recurrenceRule: seed[5] || ''
      })
    }
    result.set(category, seeds)
  }
  return result
}

const goSeeds = parseGoSeeds()

describe('PIVR 里程碑模板：前端与 data-runtime 一致性', () => {
  for (const category of Object.keys(pivrMilestoneModes)) {
    test(`${category} 的名称、mode、阶段与顺序两侧一致`, () => {
      const stages = pivrTypeMapping[category as keyof typeof pivrTypeMapping]
      const modes = pivrMilestoneModes[category as keyof typeof pivrMilestoneModes]
      assert.ok(stages && modes, `${category} 缺少规范定义`)

      const expected = pivrStageOrder.map((stage, index) => ({
        name: stages[stage].title,
        mode: modes[stage],
        pivrStage: stage,
        sortOrder: index + 1,
        recurrenceRule: ''
      }))

      const actual = goSeeds.get(category)
      assert.ok(actual, `data-runtime 缺少 ${category} 分支；新增分类需同步两侧`)
      assert.deepEqual(actual, expected, `${category} 的里程碑定义两侧不一致`)
    })
  }

  test('maintenance 为周期单元 + 常驻工单容器，不生成四个 PIVR 里程碑', () => {
    // V1.1 §4.6.1：一个 periodic 里程碑代表一个周期单元，四阶段仅作周期内节奏标签。
    // 若退回四个 periodic，一个周期会产生四次滚动，关期门无法确定作用对象。
    const actual = goSeeds.get('maintenance')
    assert.deepEqual(actual, [
      { name: '工单处理', mode: 'rolling_plan', pivrStage: 'I', sortOrder: 1, recurrenceRule: '' },
      { name: '月度运维周期', mode: 'periodic', pivrStage: 'R', sortOrder: 2, recurrenceRule: 'monthly' }
    ])
    assert.equal(
      actual!.filter(seed => seed.mode === 'periodic').length,
      1,
      'maintenance 只能有一个 periodic 里程碑作为周期单元'
    )
  })

  test('maintenance 保留四阶段名称作为周期内节奏标签', () => {
    const stages = pivrTypeMapping.maintenance
    assert.ok(stages, 'maintenance 需保留四阶段名称供关期检查项与时间线使用')
    assert.equal(stages.P.title, '周期规划')
    assert.equal(stages.R.title, '复盘优化')
    // 但不参与里程碑生成
    assert.equal(pivrMilestoneModes.maintenance, undefined)
  })

  test('routine 不使用 PIVR，两侧均不生成里程碑', () => {
    assert.equal(pivrTypeMapping.routine, undefined, 'routine 不应有 PIVR 阶段语义')
    assert.equal(pivrMilestoneModes.routine, undefined)
    assert.deepEqual(goSeeds.get('routine') ?? [], [], 'data-runtime 的 routine 分支必须返回空')
    assert.match(goSource, /case "routine":/, 'routine 必须有显式 case，不能落入 default 通用模板')
  })

  test('delivery 的 R 阶段为强约束', () => {
    // 曾出现前端 strong_constraint、Go rolling_plan 的分歧
    assert.equal(pivrMilestoneModes.delivery!.R, 'strong_constraint')
    assert.equal(goSeeds.get('delivery')!.find(s => s.pivrStage === 'R')!.mode, 'strong_constraint')
  })

  test('未登记分类落入 default 时有告警日志', () => {
    assert.match(
      goSource,
      /log\.Printf\("\[aims project-template\] category %q 未登记默认里程碑模板/,
      'default 分支必须记录告警，否则新增分类漏配无法被发现'
    )
  })
})

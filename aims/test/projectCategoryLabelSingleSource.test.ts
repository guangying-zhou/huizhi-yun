/**
 * 项目分类字典单一来源约束
 *
 * 背景：B1.4 之前，项目分类名称在 6 个文件里各维护一份，出现 4 套用词
 * （「产品开发」/「产品研发」、「实施交付」/「交付实施」、「维保项目」/「运维保障」），
 * 同一个 improvement 有「持续改进」「改进优化」「内部改善」「改进」四种叫法。
 *
 * 收敛后名称唯一来源是 app/config/project.ts 的 projectCategoryConfig，
 * 取值一律经 getProjectCategoryLabel()。本测试阻止再次分裂。
 *
 * 规范来源：《汇智PIVR项目管理生命周期模型说明书V1.1》§3 业务场景适配映射表
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'

const appDir = fileURLToPath(new URL('../app', import.meta.url))

// config/project.ts 含运行时别名 import，无法在 node --test 中直接加载，
// 改为解析源码提取标签表。
const projectConfigSource = readFileSync(join(appDir, 'config/project.ts'), 'utf8')

function parseCategoryLabels(): Record<string, string> {
  const block = projectConfigSource.match(
    /export const projectCategoryConfig[^=]*=\s*\{([\s\S]*?)\n\}/
  )
  assert.ok(block, 'projectCategoryConfig 未找到，config/project.ts 结构可能已变更')
  const labels: Record<string, string> = {}
  for (const line of block[1]!.matchAll(/(\w+):\s*\{\s*label:\s*'([^']+)'/g)) {
    labels[line[1]!] = line[2]!
  }
  return labels
}

const projectCategoryLabels = parseCategoryLabels()

/** 允许按分类维护映射的文件：各自表达不同维度，不是标签字典 */
const ALLOWED = new Set([
  'config/project.ts', //           分类标签与图标（唯一来源）
  'config/milestone.ts', //         PIVR 阶段名称与里程碑 mode
  'config/deliverable-templates.ts', // 按分类的交付物模板
  'utils/projectModuleConfig.ts' //  按分类的模块开关默认值
])

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, acc)
    else if (/\.(ts|vue)$/.test(entry)) acc.push(full)
  }
  return acc
}

describe('项目分类标签单一来源', () => {
  test('app 目录下没有额外的分类字典', () => {
    // 形如 `product_dev: '产品开发'`
    const offenders = walk(appDir)
      .filter(file => /\bproduct_dev\s*:/.test(readFileSync(file, 'utf8')))
      .map(file => file.slice(appDir.length + 1))
      .filter(rel => !ALLOWED.has(rel))

    assert.deepEqual(
      offenders,
      [],
      '以下文件自建了分类映射，请改用 getProjectCategoryLabel()：\n' + offenders.join('\n')
    )
  })

  test('app 目录下没有额外的分类选项数组', () => {
    // 形如 `{ label: '产品研发', value: 'product_dev' }`。
    // B1.4 初版只查冒号形式，漏掉了 4 处 categoryOptions，导致创建页显示
    // 「运维保障」而列表页显示「维保项目」。
    const offenders = walk(appDir)
      .filter(file => /value:\s*'product_dev'/.test(readFileSync(file, 'utf8')))
      .map(file => file.slice(appDir.length + 1))
      .filter(rel => !ALLOWED.has(rel))

    assert.deepEqual(
      offenders,
      [],
      '以下文件自建了分类选项数组，请改用 projectCategoryOptions / '
      + 'selectableProjectCategoryOptions：\n' + offenders.join('\n')
    )
  })

  test('创建入口不提供已停用与派生分类', () => {
    // improvement 已停用；routine 只能在「日常事务」项目集下创建（V1.1 §1.4）
    const block = projectConfigSource.match(
      /export const selectableProjectCategories[^=]*=\s*\[([\s\S]*?)\]/
    )
    assert.ok(block, 'selectableProjectCategories 未找到')
    assert.doesNotMatch(block[1]!, /'improvement'/, '创建入口不应提供已停用的 improvement')
    assert.doesNotMatch(block[1]!, /'routine'/, 'routine 只能经日常事务项目集创建，不应出现在手工下拉')
    // 筛选器仍需覆盖存量与 routine
    assert.match(projectConfigSource, /export const projectCategoryOptions/)
  })

  test('导出统一取值入口且未知分类可回落', () => {
    assert.match(projectConfigSource, /export const projectCategoryLabels/)
    assert.match(projectConfigSource, /export function getProjectCategoryLabel/)
    // 未知分类回落为原始 code，便于在界面上发现漏配而不是显示空白
    assert.match(projectConfigSource, /\|\|\s*String\(category\)/)
  })

  test('分类标签覆盖说明书 §3 全部分类', () => {
    // routine 为 V1.1 新增；improvement 已停用但保留供存量项目显示
    for (const code of ['product_dev', 'custom_dev', 'delivery', 'maintenance',
      'sales', 'presales', 'improvement', 'compliance', 'routine']) {
      assert.ok(projectCategoryLabels[code], `缺少分类标签：${code}`)
    }
    assert.equal(projectCategoryLabels.routine, '日常事务')
  })
})

#!/usr/bin/env node
/**
 * 受控环境示例内容直写（产品与研发视角）。
 *
 * 这是 seed_product_center_demo.mjs 的旁路版本：直接写 AIMS 数据库，
 * 用于本机／受控测试环境快速铺演示数据。它不是在线业务路径，
 * 也不能替代经用户 API 的写入：
 *
 *   - 不产生命令回执（product_command_receipts 等），因此这些数据没有操作留痕；
 *   - 不经过 Console 授权与数据范围判定，谁能看到仍由运行时读取路径决定；
 *   - 只写展示所需的最小列，其余列留数据库默认值。
 *
 * 生产环境不要使用；需要留痕或验证授权链路时用 API 版本。
 *
 *   node aims/scripts/seed_product_center_demo_sql.mjs --product HZ-TY-S-002 [--apply]
 *
 * 连接信息默认取本机 Runtime 配置（--config 可覆盖），脚本不打印口令。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import mysql from 'mysql2/promise'
import {
  components as demoComponents,
  features as demoFeatures,
  requests as demoRequests,
  planningItems as demoPlanningItems,
  cycles as demoCycles,
  versions as demoVersions
} from './product-center-demo-content.mjs'

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name)
  if (index === -1 || index + 1 >= process.argv.length) return fallback
  return process.argv[index + 1]
}
const apply = process.argv.includes('--apply')
const productCode = argValue('--product', 'HZ-TY-S-002').trim()
const configPath = argValue('--config', path.join(os.homedir(), 'Library/Application Support/HuizhiYun/test-runtime/config.json'))
if (!productCode || productCode.includes('/') || [...productCode].length > 64) throw new Error('无效的 --product')

const runtimeConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const dbConfig = runtimeConfig?.apps?.aims?.db
if (!dbConfig?.database || !dbConfig.user) throw new Error(`${configPath} 缺少 apps.aims.db 连接配置`)
const host = dbConfig.host || '127.0.0.1'
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('该脚本只允许连接本机数据库')

const counts = { components: 0, features: 0, requests: 0, planningItems: 0, cycles: 0, versions: 0 }
const model = JSON.stringify({
  version: 'weighted-value-effort-v1',
  weights: { strategic: 30, user_value: 30, business: 20, risk: 20 },
  effort_unit: 'person_day',
  confidence_values: ['0.50', '0.80', '1.00'],
  minimum_effort_person_days: '0.50'
})

async function main() {
  const conn = await mysql.createConnection({
    host, port: dbConfig.port || 3306, user: dbConfig.user, password: dbConfig.password,
    database: dbConfig.database, multipleStatements: false
  })
  console.log(`数据库 ${dbConfig.database} @ ${host}`)
  console.log(`产品 ${productCode}｜模式：${apply ? '写入' : 'dry-run（加 --apply 才会写入）'}`)
  try {
    const [[workspace]] = await conn.query(
      'SELECT product_code,status,revision,created_by FROM product_workspaces WHERE product_code=?', [productCode])
    if (!workspace) throw new Error(`产品空间 ${productCode} 不存在，请先在产品中心启用产品管理`)
    if (workspace.status !== 'active') throw new Error(`产品空间状态为 ${workspace.status}，只有 active 才写入`)
    const actor = workspace.created_by
    console.log(`操作人取产品空间创建人：${actor}；当前 revision ${workspace.revision}`)

    await conn.beginTransaction()

    // 模块：先根后子，按 product_code + parent + name 去重
    const componentIds = new Map()
    for (const root of demoComponents) {
      const rootId = await upsertComponent(conn, actor, null, root)
      componentIds.set(root.key, rootId)
      for (const child of root.children || []) {
        componentIds.set(child.key, await upsertComponent(conn, actor, rootId, child))
      }
    }

    // 功能：示例描述的是已具备的能力，因此 lifecycle 用 active，并归属到模块
    for (const feature of demoFeatures) {
      const componentId = componentIds.get(feature.module) ?? null
      const [existing] = await conn.query(
        'SELECT id FROM product_features WHERE product_code=? AND title=? LIMIT 1', [productCode, feature.title])
      if (existing.length) continue
      if (apply) {
        await conn.execute(
          `INSERT INTO product_features(biz_id,product_code,component_id,title,description,lifecycle,created_by,updated_by,created_at,updated_at)
           VALUES(UUID(),?,?,?,?,'active',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [productCode, componentId, feature.title, feature.description, actor, actor])
      }
      counts.features++
    }

    for (const row of demoRequests) {
      const [existing] = await conn.query(
        'SELECT id FROM product_requests WHERE product_code=? AND title=? LIMIT 1', [productCode, row.title])
      if (existing.length) continue
      if (apply) {
        await conn.execute(
          `INSERT INTO product_requests(biz_id,product_code,title,problem_statement,source_type,urgency_level,decision_status,created_by,updated_by,created_at,updated_at)
           VALUES(UUID(),?,?,?,?,?,'submitted',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [productCode, row.title, row.problemStatement, row.sourceType, row.urgencyLevel, actor, actor])
      }
      counts.requests++
    }

    for (const row of demoPlanningItems) {
      const [existing] = await conn.query(
        'SELECT id FROM product_planning_items WHERE product_code=? AND title=? LIMIT 1', [productCode, row.title])
      if (existing.length) continue
      if (apply) {
        await conn.execute(
          `INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,urgency_level,investment_category,lifecycle,created_by,updated_by,created_at,updated_at)
           VALUES(UUID(),?,?,?,?,?,'proposed',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [productCode, row.title, row.scopeSummary, row.urgencyLevel, row.investmentCategory, actor, actor])
      }
      counts.planningItems++
    }

    // 周期保持 draft：开放周期是显式命令，会写队列与容量，不在这里伪造终态
    for (const row of demoCycles) {
      const [existing] = await conn.query(
        'SELECT id FROM product_planning_cycles WHERE product_code=? AND title=? LIMIT 1', [productCode, row.title])
      if (existing.length) continue
      if (apply) {
        await conn.execute(
          `INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_version,model_snapshot,review_interval_days,status,created_by,updated_by,created_at,updated_at)
           VALUES(UUID(),?,?,?,?,?,'weighted-value-effort-v1',CAST(? AS JSON),?,'draft',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [productCode, row.title, row.startsOn, row.endsOn, row.goalSummary, model, row.reviewIntervalDays, actor, actor])
      }
      counts.cycles++
    }

    // 版本保持 planning：验收与发布各有专用命令
    for (const [index, row] of demoVersions.entries()) {
      const [existing] = await conn.query(
        'SELECT id FROM product_versions WHERE product_code=? AND version_code=? LIMIT 1', [productCode, row.versionCode])
      if (existing.length) continue
      if (apply) {
        await conn.execute(
          `INSERT INTO product_versions(product_code,version_code,name,description,status,planned_release_date,sort_order,business_owner_uid,created_by,created_at,updated_at)
           VALUES(?,?,?,?,'planning',?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
          [productCode, row.versionCode, row.name, row.description, row.plannedReleaseDate, index, actor, actor])
      }
      counts.versions++
    }

    const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
    if (apply && total > 0) {
      // 产品空间确实被改动，按运行时同样的方式推进一次 revision
      await conn.execute(
        'UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?',
        [actor, productCode])
    }
    if (apply) await conn.commit()
    else await conn.rollback()

    // 计数是"本次新增"，不是"库里现有"：重复执行会全为 0，那是幂等生效而不是失败。
    console.log('\n本次新增（已存在的按名称／编码跳过）')
    console.log(`  模块 ${counts.components}｜功能 ${counts.features}｜需求 ${counts.requests}｜规划事项 ${counts.planningItems}｜周期 ${counts.cycles}｜版本 ${counts.versions}`)
    if (!apply) console.log('  未写入（dry-run 已回滚）。')
    else if (total > 0) console.log('  已提交，刷新产品中心即可查看。')
    else console.log('  示例内容此前已全部写入，本次无新增，产品中心数据未变化。')
    if (apply) await printExistingTotals(conn)
    console.log('  「关联项目」由真实项目与工作项聚合，本脚本不写入。')
  } finally {
    await conn.end()
  }
}

/** 写入后回读各表现有条数，避免把"本次新增 0"误读成"库里没有数据"。 */
async function printExistingTotals(conn) {
  const tables = [
    ['模块', 'product_components'], ['功能', 'product_features'], ['需求', 'product_requests'],
    ['规划事项', 'product_planning_items'], ['周期', 'product_planning_cycles'], ['版本', 'product_versions']
  ]
  const parts = []
  for (const [label, table] of tables) {
    const [[row]] = await conn.query(`SELECT COUNT(*) n FROM ${table} WHERE product_code=?`, [productCode])
    parts.push(`${label} ${row.n}`)
  }
  console.log(`  当前该产品共有：${parts.join('｜')}`)
}

async function upsertComponent(conn, actor, parentId, node) {
  const [existing] = await conn.query(
    `SELECT id FROM product_components WHERE product_code=? AND name=? AND parent_id ${parentId === null ? 'IS NULL' : '=?'} LIMIT 1`,
    parentId === null ? [productCode, node.name] : [productCode, node.name, parentId])
  if (existing.length) return existing[0].id
  counts.components++
  if (!apply) return null
  const [result] = await conn.execute(
    `INSERT INTO product_components(biz_id,product_code,parent_id,name,description,sort_order,created_by,updated_by,created_at,updated_at)
     VALUES(UUID(),?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
    [productCode, parentId, node.name, node.description, node.sortOrder, actor, actor])
  return result.insertId
}

main().catch((error) => {
  console.error(`\n失败：${error.message}`)
  process.exit(1)
})

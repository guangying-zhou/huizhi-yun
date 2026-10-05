#!/usr/bin/env node
/**
 * 把产品与研发视角的示例内容写入指定产品。
 *
 * 全部写入都走浏览器同款用户 API：授权、数据范围、workspace revision 和幂等键
 * 由服务端按既有规则判定。脚本不直连数据库，不签发服务令牌，也不绕过任何权限，
 * 因此它能写成功，就说明当前账号本来就有对应权限。
 *
 * 默认 dry-run，只打印将要创建的内容；加 --apply 才实际写入。
 * 每类对象先读取现有列表，按名称／编码跳过已存在项，可重复执行。
 *
 *   node aims/scripts/seed_product_center_demo.mjs \
 *     --base-url https://hzy-test.huizhi.yun/aims \
 *     --product HZ-TY-S-002 \
 *     --cookie-file ~/.hzy-session-cookie \
 *     [--business-owner <uid>] [--apply]
 *
 * cookie 文件放浏览器 DevTools 里复制的整条 Cookie 头。脚本不打印它，
 * 也不写入任何文件；用完请自行删除。
 */
import fs from 'node:fs'
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
const baseUrl = argValue('--base-url').trim().replace(/\/+$/, '')
const cookieFile = argValue('--cookie-file').trim()
const businessOwner = argValue('--business-owner').trim()

if (!productCode || productCode.includes('/') || [...productCode].length > 64) throw new Error('无效的 --product')

/** 不给 cookie 也不 --apply 时，离线列出将写入的内容，便于先审内容再连环境。 */
function printOfflinePlan() {
  console.log(`产品 ${productCode} 示例内容（离线预览，未连接任何环境）\n`)
  console.log('产品模块')
  for (const root of demoComponents) {
    console.log(`  ${root.name} — ${root.description}`)
    for (const child of root.children || []) console.log(`    ${child.name} — ${child.description}`)
  }
  const sections = [
    ['功能目录', demoFeatures.map(item => `${item.title}（${item.module}）`)],
    ['需求池', demoRequests.map(item => `[${item.urgencyLevel}/${item.sourceType}] ${item.title}`)],
    ['规划事项', demoPlanningItems.map(item => `[${item.investmentCategory}] ${item.title}`)],
    ['规划周期', demoCycles.map(item => `${item.title}（${item.startsOn} ~ ${item.endsOn}）`)],
    ['产品版本', demoVersions.map(item => `${item.versionCode} ${item.name}（计划 ${item.plannedReleaseDate}）`)]
  ]
  for (const [title, rows] of sections) {
    console.log(`\n${title}（${rows.length}）`)
    for (const row of rows) console.log(`  ${row}`)
  }
  console.log('\n「关联项目」由真实项目与工作项聚合，不由本脚本写入。')
  console.log('\n要实际写入：补上 --base-url 与 --cookie-file 先做联网 dry-run，确认后再加 --apply。')
}

if (!cookieFile && !apply) {
  printOfflinePlan()
  process.exit(0)
}

if (!baseUrl || !/^https?:\/\//.test(baseUrl)) throw new Error('必须提供 --base-url，例如 https://hzy-test.huizhi.yun/aims')
if (!cookieFile) throw new Error('必须提供 --cookie-file')
const cookie = fs.readFileSync(cookieFile, 'utf8').trim()
if (!cookie) throw new Error('cookie 文件为空')

const product = encodeURIComponent(productCode)
const api = `${baseUrl}/api/v1/products/${product}`
const summary = { created: 0, skipped: 0, planned: 0 }

async function call(path, options = {}) {
  const response = await fetch(`${api}${path}`, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      cookie,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  })
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  if (!response.ok || payload?.code !== 0) {
    // 只回显业务消息，不回显响应头或 cookie。
    const message = payload?.message || payload?.data?.message || response.statusText
    throw new Error(`${options.method || 'GET'} ${path} -> ${response.status} ${message}`)
  }
  return payload.data
}

/** 每次写入前读取当前 workspace revision，避免用过期版本号提交 */
async function revisionOf(scope) {
  const data = await call(`/${scope}/permissions`)
  if (!Number.isSafeInteger(data?.revision) || data.revision < 1) throw new Error(`${scope} 权限响应缺少 revision`)
  if (data.status !== 'active') throw new Error(`产品空间状态为 ${data.status}，只有 active 才能写入`)
  return data.revision
}

async function listAll(path, query = {}) {
  const items = []
  for (let page = 1; page <= 50; page++) {
    const search = new URLSearchParams({ ...query, page: String(page), pageSize: '100' })
    const data = await call(`${path}?${search}`)
    const batch = Array.isArray(data?.items) ? data.items : []
    items.push(...batch)
    if (items.length >= Number(data?.total || 0) || batch.length === 0) break
  }
  return items
}

function idempotencyKey(kind, name) {
  // 稳定键：同一条示例重复执行不会产生第二份数据。
  return `demo:${productCode}:${kind}:${name}`.slice(0, 200)
}

async function create(kind, label, scope, path, body) {
  if (!apply) {
    summary.planned++
    console.log(`  + [dry-run] ${label}`)
    return null
  }
  const expectedRevision = await revisionOf(scope)
  const created = await call(path, {
    method: 'POST',
    body: { ...body, expectedRevision },
    idempotencyKey: idempotencyKey(kind, label)
  })
  summary.created++
  console.log(`  + ${label}`)
  return created
}

async function seedComponents() {
  console.log('\n产品模块')
  // 先补齐根模块，再按最新列表取 id 建子模块，避免同一次执行里父模块 id 未知。
  let roots = await listAll('/components')
  for (const root of demoComponents) {
    if (roots.some(item => item.name === root.name)) {
      summary.skipped++
      console.log(`  = ${root.name}（已存在）`)
      continue
    }
    await create('component', root.name, 'components', '/components', {
      parentId: null, name: root.name, description: root.description, sortOrder: root.sortOrder
    })
  }
  if (apply) roots = await listAll('/components')

  const byKey = new Map()
  for (const root of demoComponents) {
    const parent = roots.find(item => item.name === root.name)
    if (!parent) {
      // dry-run 下父模块尚不存在，只能列出子模块计划。
      for (const child of root.children || []) {
        summary.planned++
        console.log(`  + [dry-run] ${root.name} / ${child.name}`)
      }
      continue
    }
    byKey.set(root.key, parent.id)
    let children = await listAll('/components', { parentId: String(parent.id) })
    for (const child of root.children || []) {
      if (children.some(item => item.name === child.name)) {
        summary.skipped++
        console.log(`  = ${root.name} / ${child.name}（已存在）`)
        continue
      }
      await create('component', `${root.name} / ${child.name}`, 'components', '/components', {
        parentId: parent.id, name: child.name, description: child.description, sortOrder: child.sortOrder
      })
    }
    if (apply) children = await listAll('/components', { parentId: String(parent.id) })
    for (const child of root.children || []) {
      const row = children.find(item => item.name === child.name)
      if (row) byKey.set(child.key, row.id)
    }
  }
  return byKey
}

async function seedFeatures(componentIds) {
  console.log('\n功能目录')
  let existing = await listAll('/features')
  for (const feature of demoFeatures) {
    if (existing.some(item => item.title === feature.title)) {
      summary.skipped++
      console.log(`  = ${feature.title}（已存在）`)
      continue
    }
    await create('feature', feature.title, 'features', '/features', {
      title: feature.title, description: feature.description
    })
  }
  if (!apply) return
  // 归属模块是独立命令，用创建后的最新列表执行；已归属的功能不再改动。
  existing = await listAll('/features')
  for (const feature of demoFeatures) {
    const row = existing.find(item => item.title === feature.title)
    const componentId = componentIds.get(feature.module)
    if (!row || !componentId || row.component_id !== null) continue
    const expectedRevision = await revisionOf('features')
    await call(`/features/${encodeURIComponent(row.biz_id)}/component`, {
      method: 'POST',
      body: { componentId, expectedRevision, expectedFeatureRevision: row.revision, reason: '示例内容：按平台分层归属模块' },
      idempotencyKey: idempotencyKey('feature-component', feature.title)
    })
    console.log(`  → ${feature.title} 归入 ${feature.module}`)
  }
}

async function seedSimple(label, kind, scope, path, rows, keyOf, bodyOf) {
  console.log(`\n${label}`)
  const existing = await listAll(path)
  const seen = new Set(existing.map(keyOf))
  for (const row of rows) {
    const key = keyOf(row)
    if (seen.has(key)) {
      summary.skipped++
      console.log(`  = ${key}（已存在）`)
      continue
    }
    await create(kind, key, scope, path, bodyOf(row))
  }
}

async function main() {
  console.log(`产品 ${productCode} @ ${baseUrl}`)
  console.log(apply ? '模式：写入' : '模式：dry-run（加 --apply 才会写入）')
  const componentIds = await seedComponents()
  await seedFeatures(componentIds)
  await seedSimple('需求池', 'request', 'requests', '/requests', demoRequests,
    row => row.title,
    row => ({ title: row.title, problemStatement: row.problemStatement, sourceType: row.sourceType, urgencyLevel: row.urgencyLevel }))
  await seedSimple('规划事项', 'planning-item', 'planning-items', '/planning-items', demoPlanningItems,
    row => row.title,
    row => ({ title: row.title, scopeSummary: row.scopeSummary, investmentCategory: row.investmentCategory, urgencyLevel: row.urgencyLevel }))
  await seedSimple('规划周期', 'cycle', 'planning-cycles', '/planning-cycles', demoCycles,
    row => row.title,
    row => ({ title: row.title, startsOn: row.startsOn, endsOn: row.endsOn, goalSummary: row.goalSummary, reviewIntervalDays: row.reviewIntervalDays }))
  await seedSimple('产品版本', 'version', 'versions', '/versions', demoVersions,
    row => row.version_code || row.versionCode,
    row => ({
      versionCode: row.versionCode, name: row.name, description: row.description,
      plannedReleaseDate: row.plannedReleaseDate, ...(businessOwner ? { businessOwnerUid: businessOwner } : {})
    }))

  console.log('\n汇总')
  if (apply) console.log(`  新建 ${summary.created} 条，跳过已存在 ${summary.skipped} 条`)
  else console.log(`  计划新建 ${summary.planned} 条，跳过已存在 ${summary.skipped} 条`)
  console.log('  「关联项目」由真实项目与工作项聚合，不由本脚本写入。')
}

main().catch((error) => {
  console.error(`\n失败：${error.message}`)
  process.exit(1)
})

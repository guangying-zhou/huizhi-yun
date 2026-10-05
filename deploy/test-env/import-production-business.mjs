// 生产 (oa.wiztek.cn, 租户 C000001) 业务数据 -> 本机测试统一企业库。
// 生产侧只执行 SELECT；本机侧只写入统一库已存在的表，不建表不改结构。
// 默认 dry-run，写入需显式 --apply。凭据只经环境变量在内存中传递，不落盘不打印。
import mysql from 'mysql2/promise'

const apply = process.argv.includes('--apply')
const only = (process.argv.find(a => a.startsWith('--domain=')) || '').split('=')[1] || ''
const TARGET_DB = process.env.HZY_TARGET_DB
if (!TARGET_DB) throw new Error('缺少 HZY_TARGET_DB')

// 跳过项必须写明理由：任何未列明的非空生产表都会导入，漏配会在盘点阶段暴露而不是静默丢数据。
const SKIP = {
  aims: {
    migration_backup_20260520221011_project_user_align_members: '2026-05 迁移备份表，非业务数据',
    migration_backup_20260520221011_project_user_align_projects: '2026-05 迁移备份表，非业务数据',
    workflow_status_catalog: '生产为 matter/target 旧分类，目标库已是 project/milestone/requirement/task/bug 新分类',
    workflow_transitions: '同上，目标库流转定义已按新分类重建',
    work_item_status_catalog: 'item_type 语义由 tier 重构为 type，目标表按新模型留空',
    product_versions: '与测试环境产品线版本(HZ-TY-S-002 4 个版本)冲突，保留测试库',
    product_version_features: '引用生产 product_versions.id，随之跳过',
    product_version_logs: '引用生产 product_versions.id，随之跳过',
    integration_operation: 'Runtime 投递基础设施，不跨环境复制',
    integration_operation_attempt: 'Runtime 投递基础设施，不跨环境复制',
    integration_operation_dead_letter_actionable: 'Runtime 投递基础设施，不跨环境复制',
    service_command_receipt: 'Runtime 回执基础设施，不跨环境复制',
    aims_notification_checkpoint: 'Runtime 通知水位，不跨环境复制'
  },
  assets: {
    product_assets: '两侧 53 行 id+product_code 指纹一致，跳过以免扰动产品线引用',
    integration_operation: 'Runtime 投递基础设施，不跨环境复制',
    integration_operation_attempt: 'Runtime 投递基础设施，不跨环境复制',
    integration_operation_dead_letter_actionable: 'Runtime 投递基础设施，不跨环境复制',
    service_command_receipt: 'Runtime 回执基础设施，不跨环境复制',
    assets_notification_checkpoint: 'Runtime 通知水位，不跨环境复制'
  }
}
// 目标非空且以生产为准的表：先清空再导入。其余表要求目标为空，否则报错停下。
const REPLACE = { aims: new Set(), assets: new Set(['asset_category_groups', 'technology_bases', 'product_asset_bases']) }

// JSON 列若被解析成 JS 对象，批量 VALUES 转义会生成非法 SQL；统一按原始字符串搬运。
const rawJson = (field, next) => (field.type === 'JSON' ? field.string() : next())
const src = await mysql.createConnection({
  host: '127.0.0.1', port: Number(process.env.HZY_SRC_PORT), user: process.env.HZY_SRC_USER,
  password: process.env.HZY_SRC_PASSWORD, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
  typeCast: rawJson
})
const dst = await mysql.createConnection({
  host: process.env.HZY_DST_HOST, port: Number(process.env.HZY_DST_PORT), user: process.env.HZY_DST_USER,
  password: process.env.HZY_DST_PASSWORD, database: TARGET_DB, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true
})

const q = async (c, sql, args) => (await c.query(sql, args))[0]
const domains = (only ? [only] : ['aims', 'assets']).map(d => ({ domain: d, db: `hzy_${d}` }))
const report = []
let totalRows = 0, blocked = []

for (const { domain, db } of domains) {
  const tables = (await q(src, `SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`, [db])).map(r => r.t)
  for (const table of tables) {
    const [{ n }] = await q(src, `SELECT COUNT(*) n FROM \`${db}\`.\`${table}\``)
    const rows = Number(n)
    const reason = SKIP[domain][table]
    if (reason) { if (rows) report.push({ domain, table, rows, action: '跳过', note: reason }); continue }
    if (!rows) continue
    // 目标表名遵循统一库的 <domain>_<logical> 物理命名
    const target = table.startsWith(`${domain}_`) ? table : `${domain}_${table}`
    const tcols = (await q(dst, `SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [TARGET_DB, target])).map(r => r.c)
    if (!tcols.length) { blocked.push(`${domain}.${table}: 目标库无 ${target}`); continue }
    const scols = (await q(src, `SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [db, table])).map(r => r.c)
    const shared = scols.filter(c => tcols.includes(c))
    const droppedSrc = scols.filter(c => !tcols.includes(c))
    const [{ have }] = await q(dst, `SELECT COUNT(*) have FROM \`${target}\``)
    const existing = Number(have)
    if (existing === rows && !REPLACE[domain].has(table)) { report.push({ domain, table, target, rows, action: '已完成', note: '目标计数与源一致，跳过' }); continue }
    if (existing && !REPLACE[domain].has(table)) { blocked.push(`${domain}.${table}: 目标 ${target} 已有 ${existing} 行且不在覆盖清单`); continue }
    report.push({ domain, table, target, rows, action: existing ? `覆盖(原 ${existing} 行)` : '导入', note: droppedSrc.length ? `丢弃源列 ${droppedSrc.join(',')}` : '' })
    totalRows += rows
    if (!apply) continue
    await dst.query('SET FOREIGN_KEY_CHECKS=0')
    await dst.beginTransaction()
    try {
      if (existing) await dst.query(`DELETE FROM \`${target}\``)
      const list = shared.map(c => `\`${c}\``).join(',')
      const data = await q(src, `SELECT ${list} FROM \`${db}\`.\`${table}\``)
      for (let i = 0; i < data.length; i += 500) {
        const chunk = data.slice(i, i + 500).map(r => shared.map(c => r[c]))
        await dst.query(`INSERT INTO \`${target}\` (${list}) VALUES ?`, [chunk])
      }
      await dst.commit()
    } catch (e) { await dst.rollback(); throw new Error(`${domain}.${table} 导入失败: ${e.message}`) }
    finally { await dst.query('SET FOREIGN_KEY_CHECKS=1') }
  }
}

console.log(`${apply ? '已执行' : 'DRY-RUN（加 --apply 执行）'}  计划导入 ${totalRows} 行\n`)
const w = (s, n) => String(s).padEnd(n)
for (const r of report) console.log(`  ${w(r.domain, 7)}${w(r.table, 46)}${w(r.rows, 7)}${w(r.action, 16)}${r.note}`)
if (blocked.length) { console.log('\n阻断:'); blocked.forEach(b => console.log('  ! ' + b)) }

if (apply) {
  console.log('\n=== 逐表核对 ===')
  let bad = 0
  for (const r of report.filter(x => x.target)) {
    const [{ n }] = await q(src, `SELECT COUNT(*) n FROM \`hzy_${r.domain}\`.\`${r.table}\``)
    const [{ m }] = await q(dst, `SELECT COUNT(*) m FROM \`${r.target}\``)
    const ok = Number(n) === Number(m)
    if (!ok) bad++
    console.log(`  ${ok ? '✓' : '✗'} ${w(r.target, 50)} 源 ${w(n, 7)} 目标 ${m}`)
  }
  console.log(bad ? `\n${bad} 张表计数不一致` : '\n全部表计数一致')
}
await src.end(); await dst.end()
process.exit(blocked.length ? 1 : 0)

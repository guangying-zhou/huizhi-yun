/**
 * 获取区域字典 — 从 Account 模块代理获取
 *
 * 返回结构保持向后兼容：{ id, code, name, parent_id, sort_no, is_enabled }
 * 其中 code 对应 account 的 regionCode（VARCHAR，是新的规范 key）
 * id 字段映射为 regionCode 的复制（字符串），parent_id 固定为 null
 * （Account 区域目前是单层结构）
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  const query = getQuery(event)
  const companyCode = typeof query.companyCode === 'string' ? query.companyCode : undefined

  const regions = await fetchRegions(companyCode)

  const rows = regions.map(r => ({
    id: r.regionCode, // 以 regionCode 作为主键（字符串）
    code: r.regionCode,
    name: r.regionName,
    parent_id: null, // account 区域无层级
    sort_no: r.sortOrder ?? 0,
    is_enabled: 1
  }))

  return { code: 0, message: 'ok', data: rows }
})

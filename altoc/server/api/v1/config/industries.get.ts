/**
 * 获取行业字典 — 从 Account 模块代理获取
 *
 * 返回结构保持向后兼容：{ id, code, name, sort_no, is_enabled }
 * 其中 code 对应 account 的 domainCode（VARCHAR，是新的规范 key）
 * id 字段保留为 domainCode 的复制，供旧前端使用（使用时统一转字符串）
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  const query = getQuery(event)
  const companyCode = typeof query.companyCode === 'string' ? query.companyCode : undefined

  const domains = await fetchIndustries(companyCode)

  const rows = domains.map(d => ({
    id: d.domainCode, // 以 domainCode 作为主键（字符串）
    code: d.domainCode,
    name: d.displayName || d.aliasName || d.domainName,
    category: d.category || null,
    sort_no: d.sortOrder ?? 0,
    is_enabled: 1,
    source: d.source || 'account'
  }))

  return { code: 0, message: 'ok', data: rows }
})

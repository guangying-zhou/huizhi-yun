/**
 * 字典表注册中心 — 统一管理可由设置页 CRUD 的本地字典
 *
 * 注意：行业（industry）和区域（region）不在此处，已迁移到 account 模块。
 * 此 registry 只管 altoc 自有的业务字典：客户等级 / 客户类型 / 商机阶段 / 来源等。
 */

export interface DictTableSpec {
  table: string
  // 可创建/更新的字段（白名单，防 SQL 注入）
  fields: string[]
  // 排序字段
  orderBy?: string
}

export const DICT_REGISTRY: Record<string, DictTableSpec> = {
  customer_level: {
    table: 'customer_level',
    fields: ['code', 'name', 'sort_no', 'is_enabled'],
    orderBy: 'sort_no ASC, id ASC'
  },
  customer_type: {
    table: 'customer_type',
    fields: ['code', 'name', 'is_partner_type', 'is_enabled'],
    orderBy: 'id ASC'
  },
  opportunity_stage: {
    table: 'opportunity_stage',
    fields: ['code', 'name', 'sort_no', 'win_rate', 'is_closed', 'is_won', 'is_lost', 'is_enabled'],
    orderBy: 'sort_no ASC, id ASC'
  }
}

export function getDictSpec(entity: string): DictTableSpec {
  const spec = DICT_REGISTRY[entity]
  if (!spec) {
    throw createError({
      statusCode: 400,
      statusMessage: `未注册的字典：${entity}（合法值：${Object.keys(DICT_REGISTRY).join('/')}）`
    })
  }
  return spec
}

/** 过滤出白名单字段 */
export function pickAllowedFields(spec: DictTableSpec, body: Record<string, unknown>) {
  const cleaned: Record<string, unknown> = {}
  for (const f of spec.fields) {
    if (body[f] !== undefined) {
      cleaned[f] = body[f] === '' ? null : body[f]
    }
  }
  return cleaned
}

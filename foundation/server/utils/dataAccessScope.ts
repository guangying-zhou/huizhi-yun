export type ScopedDataAccessMode = 'all' | 'dept' | 'self' | 'none'

export interface ScopedDataAccessResult {
  access: ScopedDataAccessMode
  deptCodes: string[]
}

export interface ScopedDataAccessAggregationInput {
  // 用户在至少一个匹配 grant 上持有所需权限
  sawPermission: boolean
  // 任一匹配 grant 解析为 subject/self-only 范围
  allowSelf: boolean
  // 解析为部门范围的匹配 grant 收集到的部门编码
  deptCodes: string[]
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(item => String(item || '').trim()).filter(Boolean)))
}

// 跨业务模块统一的数据范围收口规则。
//
// 不变式：已认证且通过权限校验（sawPermission）的用户，绝不因数据范围解析失败被硬拒绝。
// 解析不出更宽范围时，最窄的非空兜底是 self；在此返回 none 会把"范围解析未命中"翻译成对
// 合法用户的 403（单条记录）或静默空列表，正是 2026-06-21 altoc 看板 403 事故的根因。
// 业务模块在循环中遇到 all 时应提前返回；本函数只负责 dept / self / none 的尾部收口。
export function finalizeScopedDataAccess(input: ScopedDataAccessAggregationInput): ScopedDataAccessResult {
  const deptCodes = uniqueStrings(input.deptCodes)
  if (deptCodes.length > 0) return { access: 'dept', deptCodes }
  if (input.allowSelf || input.sawPermission) return { access: 'self', deptCodes: [] }
  return { access: 'none', deptCodes: [] }
}

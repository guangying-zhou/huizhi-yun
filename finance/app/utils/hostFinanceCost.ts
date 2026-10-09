import { createFinanceIntent } from './hostFinanceForms.ts'

export type CostKind = 'project-accounting' | 'project-cost-allocations' | 'employee-costs'
export type CostRow = Record<string, unknown> & {
  project_code?: string
  period_month?: string
  code?: string
  id?: number
}
export interface CostPage {
  data: CostRow[]
  total: number
  page: number
  pageSize: number
}
export interface CostPreview {
  projectCode: string
  periodMonth: string
  expectedVersion: number
  inputHash: string
  currency: string | null
  laborCostAmount: string | null
  readiness: 'ready' | 'not_ready'
  missingInputs: string[]
  batchCode: string
  closed: boolean
}
export type CostAction = 'recalculate' | 'confirm-zero' | 'close'
export const costTitles: Record<CostKind, string> = { 'project-accounting': '项目核算', 'project-cost-allocations': '成本分摊', 'employee-costs': '员工月成本' }
export const validCostMonth = (value: unknown): value is string => typeof value === 'string' && /^(?:20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value)
export function costReasons(raw: unknown): string[] {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return ['输入资料不完整']
    }
  }
  if (!Array.isArray(raw))
    return []
  const labels: Record<string, string> = { missing_aims_time_entries: '尚无工时，需确认零投入', missing_work_calendar: '缺少 CN 工作日历', missing_finance_cost_parameters: '缺少有效成本参数', unreviewed_time_entries: '存在未审核工时', invalid_aims_time_entry: '工时资料不完整', cost_batch_required: '本月尚未生成成本批次', unapproved_time_entries: '存在未审核工时', no_time_entries: '尚无工时，需确认零投入', zero_confirmation_required: '尚无工时，需确认零投入', calendar_missing: '缺少 CN 工作日历', standard_hours_missing: '月标准工时不可用', parameter_missing: '缺少有效成本参数', financial_currency_mismatch: '收支币种不一致，不能换算', other_cost_currency_mismatch: '其它分摊币种不一致', financialCurrency: '收支币种不一致，不能换算' }
  return raw.map(value => labels[String(value)] || (String(value).includes('employee') ? '缺少有效员工资料' : String(value).includes('assignment') ? '缺少月末有效任职' : String(value).includes('rate') ? '缺少有效职级成本' : String(value).includes('currency') ? '币种不一致，不能换算' : String(value).includes('calendar') || String(value).includes('hours') ? '工作日历或工时不完整' : String(value).includes('parameter') ? '成本参数不完整' : '计算输入不完整'))
}
export const costMoney = (value: unknown) => value === null || value === undefined ? '—' : String(value)
export function costPercent(value: unknown) {
  if (value === null || value === undefined) return '—'
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(String(value))
  if (!match) return '—'
  const digits = match[3] || ''
  const whole = (BigInt(match[2]!) * 100n + BigInt(digits.padEnd(4, '0').slice(0, 2))).toString()
  return `${match[1]}${whole}.${digits.padEnd(4, '0').slice(2)}%`
}
export function costReadMessage(error: unknown) {
  const status = costErrorStatus(error)
  return status === 403 ? '无权限：当前财务或人员数据范围不允许查看' : status === 404 ? '记录不存在或已不可用' : '加载失败：服务暂时不可用，请稍后重试'
}
export function costErrorStatus(error: unknown) {
  const e = error as {
    statusCode?: number
    status?: number
    response?: {
      status?: number
    }
  }
  return e?.statusCode || e?.status || e?.response?.status || 0
}
export function costWriteMessage(error: unknown) {
  const status = costErrorStatus(error)
  if (status === 409)
    return '计算输入或版本已变更，已刷新最新预览；项目、月份和原选择已保留，请比较后重新确认'
  if (status === 403)
    return '无权限：当前财务范围已变更，原选择已保留'
  if (status === 400)
    return '当前输入不满足操作要求，请检查预览后重试'
  if (status >= 500)
    return '服务暂时不可用，原请求已保留，请沿用同一请求重试'
  return '保存结果未确认，可能已提交，重试将沿用同一请求安全续行'
}
export function createCostCommand(makeKey = () => crypto.randomUUID()) {
  const intent = createFinanceIntent(makeKey)
  let frozen: {
    action: CostAction
    preview: CostPreview
    body: {
      expectedVersion: number
      expectedInputHash: string
    }
    key: string
  } | null = null
  return {
    current: () => frozen,
    freeze(action: CostAction, preview: CostPreview) {
      if (frozen)
        return frozen
      const body = { expectedVersion: preview.expectedVersion, expectedInputHash: preview.inputHash }
      frozen = { action, preview: { ...preview, missingInputs: [...preview.missingInputs] }, body, key: intent.key({ action, projectCode: preview.projectCode, periodMonth: preview.periodMonth, body }) }
      return frozen
    },
    reset() {
      frozen = null
      intent.reset()
    }
  }
}
export const comparisonFields = [{ key: 'labor_cost_amount', label: '人力成本' }, { key: 'currency_code', label: '币种' }, { key: 'revision', label: '批次版本' }, { key: 'readiness_status', label: '就绪状态' }, { key: 'formula_version', label: '公式版本' }, { key: 'created_at', label: '计算时间' }, { key: 'input_sha256', label: '输入摘要' }]

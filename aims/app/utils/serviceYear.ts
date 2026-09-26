import type { CreateProjectRequest } from '../types/aims'

type ServiceYearInput = Pick<CreateProjectRequest,
  | 'serviceLineCode'
  | 'servicePeriodSeq'
  | 'servicePeriodStart'
  | 'servicePeriodEnd'
  | 'servicePeriodLabel'
>

export function validateServiceYear(input: ServiceYearInput): string {
  if (!input.serviceLineCode?.trim()
    || !input.servicePeriodSeq
    || !input.servicePeriodStart
    || !input.servicePeriodEnd
    || !input.servicePeriodLabel?.trim()) {
    return '请完整填写服务链、年度序号、服务起止日期和展示标签'
  }
  if (!Number.isInteger(input.servicePeriodSeq) || input.servicePeriodSeq < 1) {
    return '年度序号必须为正整数'
  }
  if (input.servicePeriodStart > input.servicePeriodEnd) {
    return '服务年度结束日期不能早于开始日期'
  }

  const startYear = input.servicePeriodStart.slice(0, 4)
  const isCalendarYear = input.servicePeriodStart === `${startYear}-01-01`
    && input.servicePeriodEnd === `${startYear}-12-31`
  if (!isCalendarYear && /^\d{4}$/.test(input.servicePeriodLabel.trim())) {
    return '非自然年合同期不能只写单一年份，请使用“2026.04–2027.03”等明确标签'
  }
  return ''
}

export function decimalInput(value: string, scale: 2 | 4, allowNegative = false) {
  const pattern = new RegExp(`^${allowNegative ? '-?' : ''}\\d{1,${scale === 2 ? 16 : 6}}(?:\\.\\d{1,${scale}})?$`)
  if (!pattern.test(value.trim())) throw new Error(`请输入最多${scale}位小数的有效金额或比例`)
  const [integer, fraction = ''] = value.trim().split('.')
  return `${integer!.replace(/^(-?)0+(?=\d)/, '$1')}.${fraction.padEnd(scale, '0')}`
}
export function validEffectiveRange(start: string, end: string | null) {
  const valid = (value: string) => {
    const date = new Date(`${value}T00:00:00Z`)
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  }
  return valid(start) && (!end || (valid(end) && end >= start))
}
export function createFinanceIntent(makeKey = () => crypto.randomUUID()) {
  let previous = ''
  let key = ''
  return {
    key(payload: unknown) {
      const next = JSON.stringify(payload)
      if (!key || previous !== next) {
        key = makeKey()
        previous = next
      }
      return key
    },
    reset() {
      previous = ''
      key = ''
    }
  }
}
export function financeWriteMessage(error: unknown) {
  const failure = error as { statusCode?: number, status?: number, response?: { status?: number }, data?: { code?: string, data?: { code?: string } } }
  const status = Number(failure?.statusCode || failure?.status || failure?.response?.status || 0)
  const code = failure?.data?.code || failure?.data?.data?.code
  if (code === 'finance_account_fields_unavailable') return '账户扩展资料尚未启用，草稿已保留，请联系管理员'
  if (code === 'finance_legal_entity_invalid') return '法人主体不存在或已停用，请重新选择；草稿已保留'
  if (code === 'finance_balance_date_invalid') return '不能登记未来日期的余额，请调整对账日期'
  if (code === 'finance_account_closed') return '账户已关闭，不能登记余额'
  if (code === 'finance_balance_entry_unavailable') return '余额登记尚未启用，请联系管理员；草稿已保留'
  if (status === 409 && code === 'finance_effective_range_overlap') return '生效区间与已有启用参数重叠，请调整日期；草稿已保留'
  if (status === 409 && code === 'finance_idempotency_conflict') return '请求已变更，请刷新后重试；草稿已保留'
  if (status === 409 && code === 'finance_write_conflict') return '发生并发写入冲突，请重试同一请求；草稿已保留'
  if (status === 409) return '内容已被他人修改，请刷新比较后重试；草稿已保留'
  if (status === 403) return '您没有执行此操作的权限，草稿已保留'
  if (status === 400) return '输入内容不符合要求，请检查后重试'
  if (status >= 500) return '服务暂时不可用，请稍后重试；草稿已保留'
  return '保存结果未确认，可能已提交，重试将沿用同一请求安全续行'
}

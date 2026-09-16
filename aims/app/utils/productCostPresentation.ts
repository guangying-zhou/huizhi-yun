const reasons: Record<string, string> = {
  missing_attribution_rules: '该项目期间尚未配置产品分摊规则',
  product_not_attributed: '当前产品未列入该项目期间的分摊规则',
  project_cost_not_ready: 'Finance 项目成本尚未就绪',
  missing_cost_source_revision: '成本缺少可追溯的来源修订',
  missing_cost_readiness_check: '成本尚未完成就绪检查',
  missing_cost_summary_amount: '项目成本摘要存在缺失金额',
  invalid_or_duplicate_direct_expense: '支出明细标识无效或重复',
  direct_expense_scope_mismatch: '支出明细与项目或期间不一致',
  invalid_direct_expense_status: '支出明细状态尚未支持',
  invalid_direct_expense_amount: '支出金额不符合成本计算口径',
  missing_direct_expense_currency: '支出明细缺少明确币种',
  direct_expense_summary_mismatch: '支出明细与项目摘要不一致，需要重新核算',
  duplicate_cost_allocation: '成本分摊明细重复',
  cost_allocation_scope_mismatch: '成本分摊明细与项目或期间不一致',
  invalid_allocation_fact: '成本分摊明细不完整或金额无效',
  unsupported_cost_currency_source: '部分成本来源尚未提供可验证的币种',
  invalid_cost_source_evidence: '成本来源记录不完整',
  cost_source_evidence_mismatch: '成本来源与当前项目、期间或人员不一致',
  missing_cost_currency: '成本缺少明确币种',
  mixed_cost_source_currencies: '同一笔成本使用了不同币种的来源，尚不能合计',
  cost_summary_allocation_mismatch: '成本明细与项目摘要不一致，需要重新核算',
  invalid_cost_attribution_or_amount: '分摊规则或成本金额校验未通过',
  allocation_reversed: '成本明细已反转，需要重新核算'
}

export function productCostReasonText(reason: string): string {
  return Object.hasOwn(reasons, reason) ? reasons[reason]! : '部分成本证据尚未就绪，请在 Finance 核对后刷新'
}

export const productCostBasisText = '成本采用 Finance 未取消的支出台账和有效成本分摊，包含草稿、待付款支出，不等同于实际已付金额。不同币种分别展示。'

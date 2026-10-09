type RuntimeRow = Record<string, unknown>

function text(value: unknown) {
  return String(value || '').trim()
}

function moneyValue(value: unknown) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

export function mergeProjectWithFinance(
  project: RuntimeRow,
  summary: RuntimeRow | undefined,
  periodMonth: string,
  laborAllocationAmount: number
) {
  const projectCode = text(project.project_code || project.projectCode)
  const projectName = text(project.name || project.project_name || project.projectName || project.short_name || project.shortName)
  const hasSummary = Boolean(summary)
  const summaryLaborCostAmount = moneyValue(summary?.labor_cost_amount || summary?.laborCostAmount)
  const laborCostAmount = summaryLaborCostAmount > 0 ? summaryLaborCostAmount : laborAllocationAmount
  const readinessStatus = text(summary?.cost_readiness_status || summary?.costReadinessStatus)
  const hasLaborCost = readinessStatus === 'ready'
  const financeStatus = hasSummary ? 'summary_ready' : 'summary_pending'
  const costStatus = hasLaborCost ? 'cost_ready' : 'cost_pending'
  const receivedAmount = summary?.received_amount ?? summary?.receivedAmount ?? null
  const directExpenseAmount = summary?.direct_expense_amount ?? summary?.directExpenseAmount ?? null
  const completeGrossProfitAmount = summary?.gross_profit_amount ?? summary?.grossProfitAmount ?? null

  return {
    ...(summary || {}),
    aims_project_id: project.id,
    project_code: projectCode,
    project_name: text(summary?.project_name || summary?.projectName) || projectName || projectCode,
    customer_code: text(summary?.customer_code || summary?.customerCode) || text(project.customer_code || project.customerCode),
    customer_name: text(project.customer_name || project.customerName),
    contract_code: text(summary?.contract_code || summary?.contractCode) || text(project.contract_code || project.contractCode),
    lifecycle_status: text(project.lifecycle_status || project.lifecycleStatus),
    period_month: text(summary?.period_month || summary?.periodMonth) || periodMonth || null,
    contract_amount: summary?.contract_amount ?? summary?.contractAmount ?? null,
    invoice_amount: summary?.invoice_amount ?? summary?.invoiceAmount ?? null,
    received_amount: receivedAmount,
    direct_expense_amount: directExpenseAmount,
    labor_cost_amount: laborCostAmount > 0 ? laborCostAmount.toFixed(2) : null,
    allocated_cost_amount: summary?.allocated_cost_amount ?? summary?.allocatedCostAmount ?? null,
    gross_profit_amount: hasLaborCost ? completeGrossProfitAmount : null,
    gross_margin_rate: hasLaborCost ? (summary?.gross_margin_rate ?? summary?.grossMarginRate ?? null) : null,
    calculated_at: summary?.calculated_at ?? summary?.calculatedAt ?? null,
    finance_status: financeStatus,
    finance_status_label: hasSummary ? '已有财务摘要' : (hasLaborCost ? '已有成本分摊' : '待财务归集'),
    cost_status: costStatus,
    cost_status_label: hasLaborCost ? '人力成本已同步' : '人力成本未就绪',
    cost_readiness_status: readinessStatus || 'not_ready',
    cost_readiness_reasons_json: summary?.cost_readiness_reasons_json ?? summary?.costReadinessReasonsJson ?? null,
    cost_input_hash: summary?.cost_input_hash ?? summary?.costInputHash ?? null,
    cost_readiness_checked_at: summary?.cost_readiness_checked_at ?? summary?.costReadinessCheckedAt ?? null
  }
}

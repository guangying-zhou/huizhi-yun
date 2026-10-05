import type { Ref } from 'vue'
import { financeApiPath } from './useFinanceApi'

interface SyncPeopleCostsResponse {
  aimsTimeEntryRows?: number
  peopleStandardCostRows?: number
  employeeStandardCostsSynced?: number
  laborCostAllocationsSynced?: number
  laborCostAllocationsReversed?: number
  totalAllocatedActualCost?: string
  readinessStatus?: 'ready' | 'not_ready'
  readinessReasons?: Array<{ code?: string }>
}

export function useProjectAccountingOperations(options: {
  periodMonth: Ref<string>
  refresh: () => Promise<void>
}) {
  const toast = useToast()
  const syncingProjectCode = ref('')

  async function syncPeopleCosts(row: Record<string, unknown>) {
    const projectCode = String(row.project_code || row.projectCode || '').trim()
    const periodMonth = options.periodMonth.value.trim()
    if (!projectCode) {
      toast.add({
        title: '缺少 Aims 项目',
        description: '当前行没有可用于核算的人力成本项目编码。',
        color: 'warning'
      })
      return
    }

    syncingProjectCode.value = projectCode
    try {
      const response = await $fetch<{ data?: SyncPeopleCostsResponse }>(financeApiPath('/project-accounting/sync-people-costs'), {
        method: 'POST',
        body: { projectCode, periodMonth }
      })
      const data = response.data || {}
      const ready = data.readinessStatus === 'ready'
      const reasonCodes = (data.readinessReasons || []).map(item => String(item.code || '')).filter(Boolean)
      toast.add({
        title: ready ? '标准人力成本计算完成' : '人力成本未就绪',
        description: ready
          ? `Aims 工时 ${data.aimsTimeEntryRows || 0} 条，People 职级 ${data.peopleStandardCostRows || 0} 条，员工成本 ${data.employeeStandardCostsSynced || 0} 条，分摊 ${data.laborCostAllocationsSynced || 0} 条，反转旧分摊 ${data.laborCostAllocationsReversed || 0} 条。`
          : `缺失输入：${reasonCodes.join('、') || 'unknown'}。旧的人力成本分摊已失效，毛利不会作为完整核算结果展示。`,
        color: ready ? 'success' : 'warning'
      })
      await options.refresh()
    } catch (error) {
      toast.add({
        title: '标准人力成本计算失败',
        description: error instanceof Error ? error.message : '请检查 Aims 项目工时、Finance 人力成本参数和 People 职级设置。',
        color: 'error'
      })
    } finally {
      if (syncingProjectCode.value === projectCode) syncingProjectCode.value = ''
    }
  }

  return { syncingProjectCode, syncPeopleCosts }
}

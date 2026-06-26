import type { MaybeRef } from 'vue'
import type { PivrStage, Milestone } from '~/types/aims'

export interface StageProgress {
  total: number
  completed: number
  progress: number
}

/**
 * 里程碑进度追踪
 * 按 PIVR 阶段计算进度、整体进度、逾期预警
 */
export function useMilestoneProgress(options: { projectId: MaybeRef<number> }) {
  const store = useMilestoneStore()

  const projectId = toRef(options.projectId)

  const milestones = computed(() => store.milestones)
  const loading = computed(() => store.loading)

  // ---- PIVR 阶段进度 ----
  const pivrProgress = computed<Record<PivrStage, StageProgress>>(() => {
    const stages: PivrStage[] = ['P', 'I', 'V', 'R']
    const result = {} as Record<PivrStage, StageProgress>

    for (const stage of stages) {
      const stageMilestones = milestones.value.filter(
        (m: Milestone) => m.pivrStage === stage
      )
      const total = stageMilestones.length
      const completed = stageMilestones.filter(
        (m: Milestone) => m.status === 'completed'
      ).length
      result[stage] = {
        total,
        completed,
        progress: total > 0 ? Math.round((completed / total) * 100) : 0
      }
    }

    return result
  })

  // ---- 整体进度 ----
  const overallProgress = computed(() => {
    const all = milestones.value
    if (all.length === 0) return 0

    // 优先使用里程碑自身的 progress 字段（Roll-up 值）
    const hasRollup = all.some((m: Milestone) => m.progress != null)
    if (hasRollup) {
      const sum = all.reduce((acc: number, m: Milestone) => acc + (m.progress ?? 0), 0)
      return Math.round(sum / all.length)
    }

    // 降级：按完成数计算
    const completed = all.filter((m: Milestone) => m.status === 'completed').length
    return Math.round((completed / all.length) * 100)
  })

  // ---- 逾期预警 ----
  const overdueWarnings = computed(() => {
    const now = new Date()
    return milestones.value.filter((m: Milestone) => {
      if (m.status === 'completed') return false
      if (!m.endDate) return false
      return new Date(m.endDate) < now
    }).map((m: Milestone) => ({
      id: m.id,
      name: m.name,
      endDate: m.endDate!,
      pivrStage: m.pivrStage,
      daysOverdue: Math.ceil(
        (now.getTime() - new Date(m.endDate!).getTime()) / (1000 * 60 * 60 * 24)
      )
    }))
  })

  // 加载数据
  async function refresh() {
    await store.fetchMilestones(projectId.value)
  }

  // projectId 变化时自动刷新
  watch(projectId, () => {
    refresh()
  })

  return {
    milestones,
    loading,
    pivrProgress,
    overallProgress,
    overdueWarnings,
    refresh
  }
}

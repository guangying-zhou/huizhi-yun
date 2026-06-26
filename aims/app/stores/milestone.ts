import { defineStore } from 'pinia'
import type {
  Milestone,
  CreateMilestoneRequest,
  UpdateMilestoneRequest,
  MilestoneMode,
  MilestoneStatus,
  PivrStage
} from '~/types/aims'

interface MilestonesResponse {
  milestones?: RawMilestone[]
  items?: RawMilestone[]
}

type RawMilestone = Partial<Milestone> & {
  project_id?: number
  template_key?: string | null
  pivr_stage?: PivrStage | null
  payment_term_id?: number | null
  start_date?: string | null
  end_date?: string | null
  recurrence_rule?: string | null
  sort_order?: number
  created_by?: string | null
  created_at?: string
  updated_at?: string
}

function normalizeMilestone(raw: RawMilestone): Milestone {
  return {
    id: Number(raw.id),
    projectId: Number(raw.projectId ?? raw.project_id),
    templateKey: raw.templateKey ?? raw.template_key ?? null,
    name: raw.name ?? '',
    description: raw.description ?? null,
    mode: raw.mode ?? 'strong_constraint' as MilestoneMode,
    pivrStage: raw.pivrStage ?? raw.pivr_stage ?? null,
    paymentTermId: raw.paymentTermId ?? raw.payment_term_id ?? null,
    startDate: raw.startDate ?? raw.start_date ?? null,
    endDate: raw.endDate ?? raw.end_date ?? null,
    status: raw.status ?? 'planning' as MilestoneStatus,
    deliverables: raw.deliverables ?? null,
    recurrenceRule: raw.recurrenceRule ?? raw.recurrence_rule ?? null,
    sortOrder: raw.sortOrder ?? raw.sort_order ?? 0,
    createdBy: raw.createdBy ?? raw.created_by ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? '',
    updatedAt: raw.updatedAt ?? raw.updated_at ?? '',
    progress: raw.progress ?? 0
  }
}

function normalizeMilestoneItems(data: MilestonesResponse | RawMilestone[] | null | undefined) {
  if (Array.isArray(data)) return data.map(normalizeMilestone)
  if (Array.isArray(data?.milestones)) return data.milestones.map(normalizeMilestone)
  if (Array.isArray(data?.items)) return data.items.map(normalizeMilestone)
  return []
}

export const useMilestoneStore = defineStore('milestone', () => {
  const milestones = ref<Milestone[]>([])
  const loading = ref(false)

  async function fetchMilestones(projectId: number) {
    loading.value = true
    try {
      const res = await $fetch<{ code: number, data: MilestonesResponse }>(
        `/api/v1/projects/${projectId}/milestones`
      )
      if (res.code === 0) {
        milestones.value = normalizeMilestoneItems(res.data)
      }
    } finally {
      loading.value = false
    }
  }

  async function createMilestone(projectId: number, data: CreateMilestoneRequest) {
    const res = await $fetch<{ code: number, data: { id: number } }>(
      `/api/v1/projects/${projectId}/milestones`,
      { method: 'POST', body: data }
    )
    if (res.code === 0) {
      // 重新拉取以获得完整数据
      await fetchMilestones(projectId)
    }
    return res.data
  }

  async function updateMilestone(id: number, data: UpdateMilestoneRequest, projectId: number) {
    const res = await $fetch<{ code: number, data: null }>(
      `/api/v1/milestones/${id}`,
      { method: 'PUT', body: data }
    )
    if (res.code === 0) {
      await fetchMilestones(projectId)
    }
  }

  async function deleteMilestone(id: number, projectId: number) {
    const res = await $fetch<{ code: number, data: null }>(
      `/api/v1/milestones/${id}`,
      { method: 'DELETE' }
    )
    if (res.code === 0) {
      await fetchMilestones(projectId)
    }
  }

  return {
    milestones,
    loading,
    fetchMilestones,
    createMilestone,
    updateMilestone,
    deleteMilestone
  }
})

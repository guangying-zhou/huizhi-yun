<script setup lang="ts">
const route = useRoute()
const toast = useToast()
const { resolveCurrentAppUrl } = useAppUrls()
const projectId = computed(() => Number(route.params.id))
const milestoneId = computed(() => Number(route.params.milestoneId))

interface Deliverable {
  id: number
  targetId: number | null
  matterId: number | null
  name: string
  description: string | null
  acceptanceCriteria: string | null
  deliverableType: string
  required: boolean
  status: string
  sortOrder: number
}

interface MatterItem {
  id: number
  itemKey: string
  tier: 'matter'
  type: string
  title: string
  description: string | null
  status: string
  priority: string
  assigneeUid: string | null
  startDate: string | null
  dueDate: string | null
  estimatedHours: number | null
  parentId: number | null
  templateKey: string | null
  requirementId: number | null
  deliverables: Deliverable[]
}

interface TargetItem extends Omit<MatterItem, 'tier'> {
  tier: 'target'
  matters: MatterItem[]
}

interface MilestoneDetail {
  id: number
  projectId: number
  templateKey: string | null
  name: string
  description: string | null
  mode: string
  pivrStage: string | null
  startDate: string | null
  endDate: string | null
  status: string
  sortOrder: number
  progress: number
  deliverables: Array<{ id: number, name: string, required: boolean, status: string }>
}

const milestone = ref<MilestoneDetail | null>(null)
const targets = ref<TargetItem[]>([])
const orphanMatters = ref<MatterItem[]>([])
const loading = ref(false)
const expandedTargetIds = ref<Set<number>>(new Set())

const typeLabel: Record<string, string> = {
  requirement: '需求',
  task: '任务',
  bug: '缺陷',
  change_request: '变更'
}
const typeColor: Record<string, string> = {
  requirement: 'primary',
  task: 'info',
  bug: 'error',
  change_request: 'warning'
}
const statusLabel: Record<string, string> = {
  planning: '规划',
  todo: '待办',
  in_progress: '进行中',
  in_review: '评审中',
  completed: '已完成',
  active: '进行中'
}
const statusColor: Record<string, string> = {
  planning: 'neutral',
  todo: 'neutral',
  in_progress: 'primary',
  in_review: 'warning',
  completed: 'success',
  active: 'primary'
}
const pivrLabel: Record<string, string> = {
  P: '规划',
  I: '实施',
  V: '验收',
  R: '交付'
}

const { users: accountUsers } = useAccountUsers()
const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const u of accountUsers.value) {
    map.set(u.uid, u.realName?.trim() || u.nickname?.trim() || u.uid)
  }
  return map
})
function getUserName(uid: string | null | undefined) {
  if (!uid) return '-'
  return userNameMap.value.get(uid) || uid
}

const targetProgress = computed(() => {
  const total = targets.value.length
  const completed = targets.value.filter(t => t.status === 'completed').length
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0
  return { total, completed, percent }
})

const matterProgress = computed(() => {
  const allMatters = [
    ...targets.value.flatMap(t => t.matters),
    ...orphanMatters.value
  ]
  const total = allMatters.length
  const completed = allMatters.filter(m => m.status === 'completed').length
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0
  return { total, completed, percent }
})

async function fetchDetail() {
  loading.value = true
  try {
    const res = await $fetch<{ code: number, data: { milestone: MilestoneDetail, targets: TargetItem[], orphanMatters: MatterItem[] } }>(
      `/api/v1/milestones/${milestoneId.value}/detail`
    )
    if (res.code === 0) {
      milestone.value = res.data.milestone
      targets.value = res.data.targets
      orphanMatters.value = res.data.orphanMatters
      expandedTargetIds.value = new Set(res.data.targets.map(t => t.id))
    }
  } catch (err) {
    console.error('[fetchDetail] failed:', err)
    toast.add({ title: '加载里程碑详情失败', color: 'error' })
  } finally {
    loading.value = false
  }
}

function toggleTarget(id: number) {
  if (expandedTargetIds.value.has(id)) {
    expandedTargetIds.value.delete(id)
  } else {
    expandedTargetIds.value.add(id)
  }
}

// ========== usePageWorkflow：里程碑评审 ==========
// 参考 breakdown 页面模式：bizId 直接用 milestone.id，无独立批次表
// 驳回后 Workflow 返回 rejected（terminal 状态）自动解除锁定，可再次提交
usePageWorkflow({
  appCode: 'aims',
  resourceCode: 'milestones',
  bizId: computed(() => milestone.value ? String(milestone.value.id) : ''),
  bizTitle: computed(() => milestone.value?.name || ''),
  bizUrl: computed(() => {
    if (!milestone.value) return ''
    return resolveCurrentAppUrl(`/projects/${projectId.value}/milestones/${milestoneId.value}`)
  }),
  bizContext: computed(() => ({
    project_id: projectId.value,
    milestone_id: milestoneId.value
  })),
  actions: computed(() => {
    const m = milestone.value
    if (!m || m.status !== 'active') return []

    const issues = computed(() => {
      const list: string[] = []
      const incompleteTargets = targets.value.filter(t => t.status !== 'completed')
      if (incompleteTargets.length > 0) {
        list.push(`里程碑下仍有 ${incompleteTargets.length} 个工作目标未完成`)
      }
      const incompleteMatters = [
        ...targets.value.flatMap(t => t.matters),
        ...orphanMatters.value
      ].filter(mm => mm.status !== 'completed')
      if (incompleteMatters.length > 0) {
        list.push(`里程碑下仍有 ${incompleteMatters.length} 个任务未完成`)
      }
      return list
    })

    return [{
      actionCode: 'milestone_review',
      actionName: '里程碑评审',
      icon: 'i-lucide-flag-triangle-right',
      canSubmit: computed(() => issues.value.length === 0),
      completenessIssues: issues,
      async onApproved() {
        try {
          const res = await $fetch<{ code: number, data: { nextMilestoneId: number | null } }>(
            `/api/v1/milestones/${milestoneId.value}/review-approve`,
            { method: 'POST' }
          )
          if (res.code === 0) {
            toast.add({ title: '里程碑评审已通过，下一里程碑已激活', color: 'success' })
          }
        } catch (err: unknown) {
          const msg = (err as { data?: { message?: string } })?.data?.message || '评审通过回写失败'
          toast.add({ title: msg, color: 'error' })
        } finally {
          await fetchDetail()
        }
      },
      async onRejected() {
        toast.add({ title: '里程碑评审被驳回，可修复后再次提交', color: 'warning' })
        await fetchDetail()
      }
    }]
  })
})

onMounted(async () => {
  await fetchDetail()
})
</script>

<template>
  <UDashboardPanel
    id="milestone-detail"
    :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }"
  >
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <ProjectNavbar />

        <div class="flex-1 min-h-0 overflow-y-auto">
          <div v-if="loading" class="flex justify-center py-12">
            <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
          </div>

          <div v-else-if="!milestone" class="text-center py-16 text-muted">
            里程碑不存在或已被删除
          </div>

          <div v-else class="space-y-6 p-6">
            <!-- <div class="flex items-start gap-3">
              <UButton
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                size="sm"
                :to="`/projects/${projectId}/plan`"
              >
                返回计划
              </UButton>
            </div> -->

            <div class="rounded-xl border border-default p-5 bg-elevated/30">
              <div class="flex items-center gap-3 mb-3">
                <UIcon name="i-lucide-flag" class="size-5 text-primary" />
                <h1 class="text-xl font-bold">
                  {{ milestone.name }}
                </h1>
                <UBadge
                  :color="(statusColor[milestone.status] as any)"
                  variant="subtle"
                >
                  {{ statusLabel[milestone.status] || milestone.status }}
                </UBadge>
                <UBadge
                  v-if="milestone.pivrStage"
                  color="neutral"
                  variant="outline"
                  class="font-mono"
                >
                  PIVR:{{ milestone.pivrStage }} ({{ pivrLabel[milestone.pivrStage] || '' }})
                </UBadge>
              </div>

              <div v-if="milestone.description" class="text-sm text-muted mb-3 whitespace-pre-line">
                {{ milestone.description }}
              </div>

              <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div class="text-xs text-muted">
                    开始日期
                  </div>
                  <div>{{ milestone.startDate || '-' }}</div>
                </div>
                <div>
                  <div class="text-xs text-muted">
                    结束日期
                  </div>
                  <div>{{ milestone.endDate || '-' }}</div>
                </div>
                <div>
                  <div class="text-xs text-muted">
                    目标进度
                  </div>
                  <div class="space-y-1">
                    <div class="flex items-center gap-2">
                      <div class="flex-1 h-2 rounded bg-elevated overflow-hidden">
                        <div class="h-full bg-primary" :style="{ width: `${targetProgress.percent}%` }" />
                      </div>
                      <span>{{ targetProgress.percent }}%</span>
                    </div>
                    <div class="text-xs text-muted">
                      {{ targetProgress.completed }}/{{ targetProgress.total }} 已完成
                    </div>
                  </div>
                </div>
                <div>
                  <div class="text-xs text-muted">
                    任务进度
                  </div>
                  <div class="space-y-1">
                    <div class="flex items-center gap-2">
                      <div class="flex-1 h-2 rounded bg-elevated overflow-hidden">
                        <div class="h-full bg-info" :style="{ width: `${matterProgress.percent}%` }" />
                      </div>
                      <span>{{ matterProgress.percent }}%</span>
                    </div>
                    <div class="text-xs text-muted">
                      {{ matterProgress.completed }}/{{ matterProgress.total }} 已完成
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-if="milestone.deliverables?.length"
                class="mt-4 pt-4 border-t border-default"
              >
                <div class="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  里程碑交付物
                </div>
                <div class="flex flex-wrap gap-2">
                  <UBadge
                    v-for="d in milestone.deliverables"
                    :key="d.id"
                    :color="(d.status === 'approved' ? 'success' : d.required ? 'warning' : 'neutral') as any"
                    variant="subtle"
                  >
                    {{ d.name }}
                    <span v-if="d.required" class="ml-1 text-xs">(必需)</span>
                  </UBadge>
                </div>
              </div>
            </div>

            <!-- <div
              v-if="milestone.status === 'active'"
              class="rounded-xl border border-default p-4 bg-primary/5 text-sm"
            >
              <div class="flex items-center gap-2 mb-1">
                <UIcon name="i-lucide-flag-triangle-right" class="size-4 text-primary" />
                <span class="font-semibold">里程碑评审</span>
              </div>
              <div class="text-muted">
                请在右侧审批面板发起「里程碑评审」。通过后当前里程碑将标记为已完成，下一里程碑自动激活；被驳回可修复后再次提交。
              </div>
            </div> -->

            <div>
              <h2 class="text-base font-semibold mb-3">
                工作目标与任务
              </h2>

              <div v-if="targets.length === 0 && orphanMatters.length === 0" class="text-center py-8 text-muted text-sm">
                该里程碑暂无工作项
              </div>

              <div v-else class="space-y-3">
                <div
                  v-for="target in targets"
                  :key="target.id"
                  class="rounded-lg border border-default overflow-hidden"
                >
                  <div
                    class="flex items-center gap-3 px-4 py-3 bg-elevated/30 cursor-pointer hover:bg-elevated/50"
                    @click="toggleTarget(target.id)"
                  >
                    <UIcon
                      :name="expandedTargetIds.has(target.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                      class="size-4 text-muted"
                    />
                    <UBadge
                      :color="(typeColor[target.type] as any)"
                      variant="subtle"
                      size="xs"
                    >
                      {{ typeLabel[target.type] || target.type }}
                    </UBadge>
                    <span class="font-mono text-xs text-muted">{{ target.itemKey }}</span>
                    <span class="flex-1 font-medium truncate">{{ target.title }}</span>
                    <UBadge
                      :color="(statusColor[target.status] as any)"
                      variant="subtle"
                      size="xs"
                    >
                      {{ statusLabel[target.status] || target.status }}
                    </UBadge>
                    <span class="text-xs text-muted">{{ target.matters.length }} 任务</span>
                  </div>

                  <div v-if="expandedTargetIds.has(target.id)" class="p-4 space-y-3">
                    <div v-if="target.description" class="text-sm text-muted whitespace-pre-line">
                      {{ target.description }}
                    </div>

                    <div v-if="target.deliverables.length > 0" class="space-y-1">
                      <div class="text-xs font-semibold text-muted">
                        工作成果要求
                      </div>
                      <div class="flex flex-wrap gap-2">
                        <UBadge
                          v-for="d in target.deliverables"
                          :key="d.id"
                          :color="(d.status === 'approved' ? 'success' : d.required ? 'warning' : 'neutral') as any"
                          variant="subtle"
                          size="xs"
                        >
                          {{ d.name }}
                          <span v-if="d.required" class="ml-1">*</span>
                        </UBadge>
                      </div>
                    </div>

                    <div v-if="target.matters.length === 0" class="text-xs text-muted italic">
                      暂无任务
                    </div>
                    <div v-else class="space-y-2">
                      <div
                        v-for="matter in target.matters"
                        :key="matter.id"
                        class="rounded border border-default p-3 text-sm"
                      >
                        <div class="flex items-center gap-2 mb-1">
                          <UBadge
                            :color="(typeColor[matter.type] as any)"
                            variant="subtle"
                            size="xs"
                          >
                            {{ typeLabel[matter.type] || matter.type }}
                          </UBadge>
                          <span class="font-mono text-xs text-muted">{{ matter.itemKey }}</span>
                          <span class="flex-1 font-medium truncate">{{ matter.title }}</span>
                          <UBadge
                            :color="(statusColor[matter.status] as any)"
                            variant="subtle"
                            size="xs"
                          >
                            {{ statusLabel[matter.status] || matter.status }}
                          </UBadge>
                          <span class="text-xs text-muted">指派：{{ getUserName(matter.assigneeUid) }}</span>
                        </div>
                        <div
                          v-if="matter.deliverables.length > 0"
                          class="flex flex-wrap gap-1.5 mt-2"
                        >
                          <UBadge
                            v-for="d in matter.deliverables"
                            :key="d.id"
                            :color="(d.status === 'approved' ? 'success' : d.required ? 'warning' : 'neutral') as any"
                            variant="subtle"
                            size="xs"
                          >
                            {{ d.name }}
                            <span v-if="d.required" class="ml-1">*</span>
                          </UBadge>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  v-if="orphanMatters.length > 0"
                  class="rounded-lg border border-default overflow-hidden"
                >
                  <div class="px-4 py-2 bg-elevated/30 text-xs font-semibold text-muted">
                    未归属任何目标的任务
                  </div>
                  <div class="p-4 space-y-2">
                    <div
                      v-for="matter in orphanMatters"
                      :key="matter.id"
                      class="rounded border border-default p-3 text-sm"
                    >
                      <div class="flex items-center gap-2">
                        <UBadge
                          :color="(typeColor[matter.type] as any)"
                          variant="subtle"
                          size="xs"
                        >
                          {{ typeLabel[matter.type] || matter.type }}
                        </UBadge>
                        <span class="font-mono text-xs text-muted">{{ matter.itemKey }}</span>
                        <span class="flex-1 font-medium truncate">{{ matter.title }}</span>
                        <UBadge
                          :color="(statusColor[matter.status] as any)"
                          variant="subtle"
                          size="xs"
                        >
                          {{ statusLabel[matter.status] || matter.status }}
                        </UBadge>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>

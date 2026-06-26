<script setup lang="ts">
import { projectStatusConfig } from '~/config/project'
import {
  deriveProjectLifecycleFromWorkflow,
  projectWorkflowActionOrder
} from '~/utils/projectWorkflow'

const route = useRoute()
const projectStore = useProjectStore()

const projectId = computed(() => Number(route.params.id))

const project = computed(() => projectStore.currentProject)

const statusLabel = Object.fromEntries(
  Object.entries(projectStatusConfig).map(([k, v]) => [k, v.label])
)

const categoryLabel: Record<string, string> = {
  product_dev: '产品研发',
  custom_dev: '定制开发',
  delivery: '交付实施',
  maintenance: '运维保障',
  sales: '销售机会',
  presales: '售前支持',
  improvement: '内部改善',
  compliance: '合规治理'
}

// 查询项目是否存在 "需求" 工作项（基线或变更），用于条件渲染需求 tab
const hasRequirementTarget = ref(false)
async function fetchRequirementTargets() {
  if (!projectId.value) return
  try {
    const res = await $fetch<{ code: number, data: { items?: Array<{ id: number }>, total?: number } }>(
      `/api/v1/projects/${projectId.value}/work-items`,
      {
        params: {
          type: 'requirement',
          tier: 'target',
          pageSize: 1
        }
      }
    )
    hasRequirementTarget.value = res.code === 0 && (res.data.items?.length || 0) > 0
  } catch {
    hasRequirementTarget.value = false
  }
}

const tabs = computed(() => {
  const pid = projectId.value
  const items = [
    { label: '概览', icon: 'i-lucide-layout-dashboard', to: `/projects/${pid}` },
    { label: '里程碑', icon: 'i-lucide-flag', to: `/projects/${pid}/plan` },
    { label: '版本', icon: 'i-lucide-git-branch', to: `/projects/${pid}/releases` },
    { label: '目标', icon: 'i-lucide-target', to: `/projects/${pid}/work-items` },
    { label: '任务', icon: 'i-lucide-calendar-check', to: `/projects/${pid}/board` },
    { label: '文档', icon: 'i-lucide-files', to: `/projects/${pid}/documents` },
    { label: '成果', icon: 'i-lucide-award', to: `/projects/${pid}/output` },
    { label: '工时', icon: 'i-lucide-clock', to: `/projects/${pid}/timesheet` },
    { label: '周报', icon: 'i-lucide-calendar-days', to: `/projects/${pid}/weekly-reports` },
    { label: '设置', icon: 'i-lucide-settings', to: `/projects/${pid}/settings` }
  ]
  if (hasRequirementTarget.value) {
    items.splice(2, 0, { label: '需求', icon: 'i-lucide-clipboard-list', to: `/projects/${pid}/requirements` })
  }
  return items
})

function isActive(tabTo: string) {
  const milestoneDetailPrefix = `/projects/${projectId.value}/milestones/`
  if (tabTo === `/projects/${projectId.value}/plan`) {
    return route.path === tabTo
      || route.path.startsWith(`${tabTo}/`)
      || route.path.startsWith(milestoneDetailPrefix)
  }
  if (tabTo === `/projects/${projectId.value}`) {
    return route.path === tabTo
  }
  return route.path.startsWith(tabTo)
}

onMounted(async () => {
  if (!project.value || project.value.id !== projectId.value) {
    await projectStore.fetchProject(projectId.value)
  }

  // 自动同步审批状态 → 项目生命周期
  syncApprovalStatus()
  fetchRequirementTargets()
})

watch(projectId, () => {
  fetchRequirementTargets()
})

async function syncApprovalStatus() {
  const p = project.value
  if (!p || p.lifecycleStatus === 'archived') return

  try {
    const entries = await Promise.all(
      projectWorkflowActionOrder.map(async (actionCode) => {
        const res = await fetchInstanceByBiz({
          app_code: 'aims',
          resource_code: 'projects',
          biz_id: String(p.id),
          action_code: actionCode,
          include_history: true
        })

        return [actionCode, res.code === 0 ? res.data : null] as const
      })
    )

    const nextLifecycle = deriveProjectLifecycleFromWorkflow(
      p.lifecycleStatus,
      Object.fromEntries(entries)
    )

    if (nextLifecycle && nextLifecycle !== p.lifecycleStatus) {
      await projectStore.updateProject(projectId.value, { lifecycleStatus: nextLifecycle })
    }
  } catch {
    // silent
  }
}
</script>

<template>
  <div class="border-b border-default bg-default">
    <div class="px-6 pt-0 pb-0">
      <template v-if="project">
        <div class="flex items-start justify-between gap-6">
          <!-- 左侧：项目信息（占 2/3） -->
          <div class="min-w-0 w-2/3">
            <!-- 项目编码 + 状态指示灯 -->
            <div class="flex items-center gap-2 mb-2">
              <UBadge color="info" variant="subtle" size="sm">
                {{ categoryLabel[project.category] || project.category }}
              </UBadge>
              <UBadge
                color="neutral"
                variant="outline"
                size="sm"
              >
                项目编码: {{ project.projectCode }}
              </UBadge>
              <div class="flex items-center gap-1.5">
                <span
                  class="inline-block size-2 rounded-full"
                  :class="{
                    'bg-success': project.lifecycleStatus === 'active',
                    'bg-warning': project.lifecycleStatus === 'paused' || project.lifecycleStatus === 'approval_pending',
                    'bg-neutral': project.lifecycleStatus === 'draft' || project.lifecycleStatus === 'archived',
                    'bg-primary': project.lifecycleStatus === 'completed'
                  }"
                />
                <span class="text-sm font-medium">
                  {{ statusLabel[project.lifecycleStatus] || project.lifecycleStatus }}
                </span>
              </div>
              <WorkflowBadge
                app-code="aims"
                resource-code="projects"
                :biz-id="String(project.id)"
                action-code="initiation"
              />
            </div>

            <!-- 项目名称 + 描述 -->
            <UTooltip
              :content="{
                align: 'start',
                side: 'right',
                sideOffset: 8
              }"
              :text="project.description ? project.name + ': ' + project.description : project.name"
            >
              <span class="text-2xl font-bold leading-tight mb-1">
                {{ project.shortName || project.name }}
              </span>
            </UTooltip>
            <span v-if="project.internalCode" class="text-sm text-muted ml-2">
              {{ project.internalCode }}
            </span>
          </div>

          <!-- 右侧：操作按钮插槽 -->
          <div class="shrink-0 flex items-start gap-2 pt-1">
            <slot name="actions" />
          </div>
        </div>
      </template>
      <template v-else>
        <div class="flex items-center gap-3 py-3">
          <span class="text-muted">加载中...</span>
        </div>
      </template>
    </div>

    <!-- Tab 导航 -->
    <div class="flex items-center justify-center gap-0.5 pt-0 px-6 overflow-x-auto">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.label"
        :to="tab.to"
        class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2"
        :class="[
          isActive(tab.to)
            ? 'text-primary border-primary'
            : 'text-muted hover:text-default border-transparent'
        ]"
      >
        <UIcon
          :name="tab.icon"
          class="w-4 h-4"
        />
        {{ tab.label }}
      </NuxtLink>
    </div>
  </div>
</template>

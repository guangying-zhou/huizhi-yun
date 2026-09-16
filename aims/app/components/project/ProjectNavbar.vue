<script setup lang="ts">
import { projectStatusConfig, getProjectCategoryLabel } from '~/config/project'
import {
  deriveProjectLifecycleFromWorkflow,
  projectWorkflowActionOrder
} from '~/utils/projectWorkflow'
import { projectModuleEnabled } from '~/utils/projectModuleConfig'

const route = useRoute()
const projectStore = useProjectStore()
const { currentProjectId, switchProject, exitProject } = useProjectContext()

const projectId = computed(() => Number(route.params.id))
const isProjectSettingsRoute = computed(() => route.path === `/projects/${projectId.value}/settings`)

const project = computed(() => projectStore.currentProject)
const projectSwitcherOpen = ref(false)
const projectSwitcherSearch = ref('')
const projectSwitcherFavoritesOnly = ref(false)

const switchableProjects = computed(() => {
  return projectStore.projects.filter(item =>
    item.canAccess !== false
    && item.lifecycleStatus !== 'archived'
    && Boolean(item.currentUserRole)
  )
})

const projectSwitcherItems = computed(() => {
  const keyword = projectSwitcherSearch.value.trim().toLowerCase()

  return [...switchableProjects.value]
    .sort((a, b) => {
      const aSelected = String(a.id) === currentProjectId.value
      const bSelected = String(b.id) === currentProjectId.value
      if (aSelected !== bSelected) return aSelected ? -1 : 1

      const aFavorite = projectStore.isFavorite(a.id)
      const bFavorite = projectStore.isFavorite(b.id)
      if (aFavorite !== bFavorite) return aFavorite ? -1 : 1

      return a.name.localeCompare(b.name, 'zh-CN')
    })
    .filter((item) => {
      if (projectSwitcherFavoritesOnly.value && !projectStore.isFavorite(item.id)) {
        return false
      }
      if (!keyword) return true
      const haystack = [item.shortName, item.name, item.projectCode]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(keyword)
    })
})

watch(projectSwitcherOpen, (open) => {
  if (!open) {
    projectSwitcherSearch.value = ''
    projectSwitcherFavoritesOnly.value = false
  }
})

async function handleProjectFavoriteToggle(id: number) {
  await projectStore.toggleFavorite(id)
}

async function handleProjectSwitch(id: number) {
  if (id === projectId.value) {
    projectSwitcherOpen.value = false
    return
  }

  projectSwitcherOpen.value = false
  projectSwitcherSearch.value = ''
  await switchProject(id)
}

const statusLabel = Object.fromEntries(
  Object.entries(projectStatusConfig).map(([k, v]) => [k, v.label])
)

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
  const p = project.value
  const moduleConfig = p?.moduleConfig
  const category = p?.category
  if (category === 'routine') {
    return [
      { label: '概览', icon: 'i-lucide-layout-dashboard', to: `/projects/${pid}` },
      { label: '工作项', icon: 'i-lucide-list-checks', to: `/projects/${pid}/board` },
      { label: '工时', icon: 'i-lucide-clock', to: `/projects/${pid}/timesheet` },
      { label: '设置', icon: 'i-lucide-settings', to: `/projects/${pid}/settings` }
    ]
  }
  const items = [
    { label: '概览', icon: 'i-lucide-layout-dashboard', to: `/projects/${pid}` },
    { label: '目标', icon: 'i-lucide-target', to: `/projects/${pid}/work-items` },
    { label: '任务', icon: 'i-lucide-calendar-check', to: `/projects/${pid}/board` },
    { label: '文档', icon: 'i-lucide-files', to: `/projects/${pid}/documents` },
    { label: '成果', icon: 'i-lucide-award', to: `/projects/${pid}/output` },
    { label: '工时', icon: 'i-lucide-clock', to: `/projects/${pid}/timesheet` },
    { label: '周报', icon: 'i-lucide-calendar-days', to: `/projects/${pid}/weekly-reports` },
    { label: '设置', icon: 'i-lucide-settings', to: `/projects/${pid}/settings` }
  ]
  const insertAfterOverview: Array<{ label: string, icon: string, to: string }> = []
  if (projectModuleEnabled(moduleConfig, category, 'milestones')) {
    insertAfterOverview.push({ label: '里程碑', icon: 'i-lucide-flag', to: `/projects/${pid}/plan` })
  }
  if (projectModuleEnabled(moduleConfig, category, 'requirements') && hasRequirementTarget.value) {
    insertAfterOverview.push({ label: '需求', icon: 'i-lucide-clipboard-list', to: `/projects/${pid}/requirements` })
  }
  if (projectModuleEnabled(moduleConfig, category, 'releases')) {
    insertAfterOverview.push({ label: '版本', icon: 'i-lucide-git-branch', to: `/projects/${pid}/releases` })
  }
  if (projectModuleEnabled(moduleConfig, category, 'environments')) {
    insertAfterOverview.push({ label: '环境', icon: 'i-lucide-server-cog', to: `/projects/${pid}/environments` })
  }
  if (projectModuleEnabled(moduleConfig, category, 'service_desk')) {
    insertAfterOverview.push({ label: '工单', icon: 'i-lucide-headset', to: `/projects/${pid}/service-desk` })
  }
  items.splice(1, 0, ...insertAfterOverview)
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

  // 设置页已由右侧 WorkflowPanel 查询当前审批，不再同时扫描所有动作。
  // 其他项目页仍保留生命周期补偿同步。
  if (!isProjectSettingsRoute.value) {
    syncApprovalStatus()
  }
  if (project.value?.category !== 'routine') fetchRequirementTargets()
})

watch(projectId, () => {
  if (project.value?.category !== 'routine') fetchRequirementTargets()
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
                {{ getProjectCategoryLabel(project.category) }}
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
                v-if="!isProjectSettingsRoute"
                app-code="aims"
                resource-code="projects"
                :biz-id="String(project.id)"
                action-code="initiation"
              />
            </div>

            <!-- 项目切换 + 项目名称 + 描述 -->
            <div class="flex min-w-0 items-center gap-1.5">
              <UPopover
                v-model:open="projectSwitcherOpen"
                :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
                :ui="{ content: 'w-[calc(100vw-2rem)] overflow-hidden rounded-2xl p-0 shadow-[0_22px_48px_rgba(15,23,42,0.16)] ring-1 ring-default/70 sm:w-96' }"
              >
                <UButton
                  aria-label="切换项目"
                  title="切换项目"
                  icon="i-lucide-chevrons-up-down"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  square
                />

                <template #content>
                  <div class="border-b border-default px-4 py-3">
                    <div class="flex items-center rounded-xl bg-default">
                      <UButton
                        aria-label="只看常用项目"
                        title="只看常用项目"
                        icon="i-lucide-star"
                        :color="projectSwitcherFavoritesOnly ? 'warning' : 'neutral'"
                        :variant="projectSwitcherFavoritesOnly ? 'soft' : 'ghost'"
                        size="xs"
                        square
                        @click="projectSwitcherFavoritesOnly = !projectSwitcherFavoritesOnly"
                      />

                      <UInput
                        v-model="projectSwitcherSearch"
                        class="min-w-0 flex-1"
                        :ui="{ base: 'border-0 bg-transparent px-3 shadow-none ring-0 focus-visible:ring-0' }"
                        placeholder="搜索项目..."
                        autofocus
                        size="md"
                      />

                      <UIcon name="i-lucide-search" class="mr-3 size-4 shrink-0 text-dimmed" />
                    </div>
                  </div>

                  <div class="max-h-80 overflow-y-auto p-2">
                    <div
                      v-for="item in projectSwitcherItems"
                      :key="item.id"
                      class="flex items-center gap-1 rounded-xl transition-colors hover:bg-elevated"
                      :class="item.id === projectId ? 'bg-elevated' : ''"
                    >
                      <button
                        type="button"
                        class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                        @click="handleProjectSwitch(item.id)"
                      >
                        <UIcon name="i-lucide-folder-kanban" class="size-4 shrink-0 text-dimmed" />
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-[13px] font-medium leading-5 text-highlighted">
                            {{ item.shortName || item.name }}
                          </span>
                          <span class="block truncate text-[11px] leading-4 text-muted">
                            {{ item.projectCode }}
                          </span>
                        </span>
                        <UIcon
                          v-if="item.id === projectId"
                          name="i-lucide-check"
                          class="size-4 shrink-0 text-primary"
                        />
                      </button>

                      <UButton
                        :aria-label="projectStore.isFavorite(item.id) ? '取消常用项目' : '设为常用项目'"
                        :title="projectStore.isFavorite(item.id) ? '取消常用项目' : '设为常用项目'"
                        icon="i-lucide-star"
                        :color="projectStore.isFavorite(item.id) ? 'warning' : 'neutral'"
                        :variant="projectStore.isFavorite(item.id) ? 'soft' : 'ghost'"
                        size="xs"
                        square
                        class="mr-2 shrink-0"
                        @click.stop="handleProjectFavoriteToggle(item.id)"
                      />
                    </div>

                    <div
                      v-if="projectSwitcherItems.length === 0"
                      class="px-4 py-10 text-center text-sm text-muted"
                    >
                      未找到匹配项目
                    </div>
                  </div>

                  <div class="flex items-center justify-between border-t border-default px-4 py-3 text-sm">
                    <span class="text-muted">
                      {{ switchableProjects.length }} 个项目
                    </span>
                    <UButton
                      label="前往项目总览"
                      color="neutral"
                      variant="ghost"
                      trailing-icon="i-lucide-arrow-right"
                      @click="projectSwitcherOpen = false; exitProject()"
                    />
                  </div>
                </template>
              </UPopover>

              <UTooltip
                :content="{
                  align: 'start',
                  side: 'right',
                  sideOffset: 8
                }"
                :text="project.description ? project.name + ': ' + project.description : project.name"
              >
                <span class="truncate text-2xl font-bold leading-tight">
                  {{ project.shortName || project.name }}
                </span>
              </UTooltip>
              <span v-if="project.internalCode" class="shrink-0 text-sm text-muted">
                {{ project.internalCode }}
              </span>
            </div>
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

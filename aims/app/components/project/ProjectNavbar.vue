<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'
import { useProjectStore } from '../../stores/project'
import { useProjectContext } from '../../composables/useProjectContext'
import { projectStatusConfig, getProjectCategoryLabel } from '../../config/project'
import {
  deriveProjectLifecycleFromWorkflow,
  projectWorkflowActionOrder
} from '../../utils/projectWorkflow'
import { useTimeEntryReadPage } from '../../composables/useTimeEntryPage'
import { isProjectProjection, type ProjectGroupPage } from '../../utils/projectOverviewPagination'
import { projectModuleEnabled } from '../../utils/projectModuleConfig'

// 同一份组件供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。
const { moduleUrl, hosted } = useAimsModule()

const route = useRoute()
const projectStore = useProjectStore()
const { currentProjectId, switchProject, exitProject } = useProjectContext()

const projectId = computed(() => Number(route.params.id))
const isProjectSettingsRoute = computed(() => route.path === `/projects/${projectId.value}/settings`)

const project = computed(() => projectStore.currentProject)
const projectSwitcherOpen = ref(false)
const { search: projectSwitcherSearch, debounced: switcherSearch } = useDebouncedSearch()
const switcherPage = ref(1)
const switcherRead = useTimeEntryReadPage<ProjectGroupPage>(isProjectProjection)
const projectSwitcherFavoritesOnly = ref(false)

async function readSwitcher(page = 1) {
  switcherPage.value = page
  await switcherRead.read(moduleUrl('/api/v1/projects'), { projection: 'switcher', participating_only: '1', favoritesOnly: projectSwitcherFavoritesOnly.value ? '1' : undefined, search: switcherSearch.value || undefined, page, pageSize: 20 })
}
watch([switcherSearch, projectSwitcherFavoritesOnly], () => {
  if (hosted && projectSwitcherOpen.value) void readSwitcher()
})
watch(switcherRead.fingerprint, () => {
  projectSwitcherOpen.value = false
  switcherRead.clear()
}, { flush: 'sync' })
const switchableProjects = computed(() => {
  return projectStore.projects.filter(item =>
    item.canAccess !== false
    && item.lifecycleStatus !== 'archived'
    && Boolean(item.currentUserRole)
  )
})

const projectSwitcherItems = computed(() => {
  if (hosted) return (switcherRead.data.value?.items || []).map(projectStore.normalizeProject)
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
  // A deep link lands here without the project list page having loaded the
  // store, so the switcher fetches the accessible projects on first open.
  if (hosted && open) void readSwitcher()
  else if (open && !projectStore.projects.length && !projectStore.loading) {
    void projectStore.fetchProjects({ pageSize: 100 })
  }
  if (!open) {
    projectSwitcherSearch.value = ''
    projectSwitcherFavoritesOnly.value = false
  }
})

async function handleProjectFavoriteToggle(id: number) {
  await projectStore.toggleFavorite(id)
  if (hosted) await readSwitcher(switcherPage.value)
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
  // Host uses the object sidebar, not these legacy requirement tabs.
  if (hosted || !projectId.value) return
  try {
    const res = await $fetch<{ code: number, data: { items?: Array<{ id: number }>, total?: number } }>(
      moduleUrl(`/api/v1/projects/${projectId.value}/work-items`),
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

function visibleHostTabs<T extends { to: string }>(items: T[]): T[] {
  if (!hosted) return items
  const facts = project.value?.projectTabAccess
  return items.filter((item) => {
    const segment = item.to.replace(moduleUrl(`/projects/${projectId.value}`), '').split('/').filter(Boolean)[0]
    if (segment === 'edit') return project.value?.canEditProject === true
    if (segment === 'weekly-reports') return facts?.member === true || facts?.management === true || facts?.anyProjectManager === true
    if (['board', 'work-items', 'requirements', 'risks', 'metrics', 'timesheet'].includes(segment || '')) return facts?.member === true || facts?.management === true
    return true
  })
}
const tabs = computed(() => {
  const pid = projectId.value
  const p = project.value
  const moduleConfig = p?.moduleConfig
  const category = p?.category
  // Host 未注册 /projects/:id/settings，"设置" 改跳 Host 的项目编辑页；独立应用保持原设置页。
  const settingsTab = { label: '设置', icon: 'i-lucide-settings', to: hosted ? moduleUrl(`/projects/${pid}/edit`) : moduleUrl(`/projects/${pid}/settings`) }
  if (category === 'routine') {
    return visibleHostTabs([
      { label: '概览', icon: 'i-lucide-layout-dashboard', to: moduleUrl(`/projects/${pid}`) },
      { label: '工作项', icon: 'i-lucide-list-checks', to: moduleUrl(`/projects/${pid}/board`) },
      { label: '工时', icon: 'i-lucide-clock', to: moduleUrl(`/projects/${pid}/timesheet`) },
      settingsTab
    ])
  }
  const items = [
    { label: '概览', icon: 'i-lucide-layout-dashboard', to: moduleUrl(`/projects/${pid}`) },
    { label: '目标', icon: 'i-lucide-target', to: moduleUrl(`/projects/${pid}/work-items`) },
    { label: '任务', icon: 'i-lucide-calendar-check', to: moduleUrl(`/projects/${pid}/board`) },
    { label: '文档', icon: 'i-lucide-files', to: moduleUrl(`/projects/${pid}/documents`) },
    { label: '成果', icon: 'i-lucide-award', to: moduleUrl(`/projects/${pid}/output`) },
    { label: '工时', icon: 'i-lucide-clock', to: moduleUrl(`/projects/${pid}/timesheet`) },
    { label: '周报', icon: 'i-lucide-calendar-days', to: moduleUrl(`/projects/${pid}/weekly-reports`) },
    settingsTab
  ]
  const insertAfterOverview: Array<{ label: string, icon: string, to: string }> = []
  if (projectModuleEnabled(moduleConfig, category, 'milestones')) {
    insertAfterOverview.push({ label: '里程碑', icon: 'i-lucide-flag', to: moduleUrl(`/projects/${pid}/plan`) })
  }
  if (projectModuleEnabled(moduleConfig, category, 'requirements') && hasRequirementTarget.value) {
    insertAfterOverview.push({ label: '需求', icon: 'i-lucide-clipboard-list', to: moduleUrl(`/projects/${pid}/requirements`) })
  }
  if (projectModuleEnabled(moduleConfig, category, 'releases')) {
    insertAfterOverview.push({ label: '版本', icon: 'i-lucide-git-branch', to: moduleUrl(`/projects/${pid}/releases`) })
  }
  // Host 未注册 /projects/:id/environments，宿主模式下隐藏该入口；独立应用不变。
  if (!hosted && projectModuleEnabled(moduleConfig, category, 'environments')) {
    insertAfterOverview.push({ label: '环境', icon: 'i-lucide-server-cog', to: moduleUrl(`/projects/${pid}/environments`) })
  }
  // Host 同样未注册 /projects/:id/service-desk，宿主模式下隐藏。
  if (!hosted && projectModuleEnabled(moduleConfig, category, 'service_desk')) {
    insertAfterOverview.push({ label: '工单', icon: 'i-lucide-headset', to: moduleUrl(`/projects/${pid}/service-desk`) })
  }
  items.splice(1, 0, ...insertAfterOverview)
  return visibleHostTabs(items)
})

// Tab targets carry the Host prefix (moduleUrl) when hosted, so compare
// against prefixed paths; otherwise the overview tab matches every sub-page.
function isActive(tabTo: string) {
  const projectRoot = moduleUrl(`/projects/${projectId.value}`)
  const planTab = moduleUrl(`/projects/${projectId.value}/plan`)
  if (tabTo === planTab) {
    return route.path === tabTo
      || route.path.startsWith(`${tabTo}/`)
      || route.path.startsWith(moduleUrl(`/projects/${projectId.value}/milestones/`))
  }
  if (tabTo === projectRoot) {
    return route.path === tabTo
  }
  return route.path === tabTo || route.path.startsWith(`${tabTo}/`)
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
  // Host 只提供 aims/tasks/complete 合同。项目生命周期由领域命令维护，
  // 不运行独立 Aims 的 projects 审批轮询及客户端补偿写入。
  if (hosted) return
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
    <div class="px-4 pt-0 pb-0 sm:px-6">
      <template v-if="project">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <!-- 左侧：项目信息（占 2/3） -->
          <div class="min-w-0 w-full sm:w-2/3">
            <!-- 项目编码 + 状态指示灯 -->
            <div class="flex flex-wrap items-center gap-2 mb-2">
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
                v-if="!hosted && !isProjectSettingsRoute"
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

                  <div v-if="hosted" class="space-y-2 px-4 py-2">
                    <span class="text-xs text-muted">共 {{ switcherRead.data.value?.total || 0 }} 条</span>
                    <UPagination
                      :sibling-count="0"
                      size="xs"
                      :page="switcherPage"
                      :items-per-page="20"
                      :total="switcherRead.data.value?.total || 0"
                      @update:page="readSwitcher"
                    />
                    <UButton v-if="switcherRead.error.value" label="读取失败，重试" @click="readSwitcher(switcherPage)" />
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
          <div class="flex flex-wrap items-start gap-2 sm:shrink-0 sm:flex-nowrap sm:pt-1">
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
    <div v-if="!hosted" class="flex items-center justify-center gap-0.5 pt-0 px-6 overflow-x-auto">
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

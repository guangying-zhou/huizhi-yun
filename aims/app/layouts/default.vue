<script setup lang="ts">
import { globalMenuItems, globalUtilityItems } from '~/config/navigation'

// 用户在线心跳
useHeartbeat()

// 平台授权快照
const { loadAuthorization } = useAuthorization()

// 项目上下文
const { hasProjectContext, currentProjectId, currentProject, enterProject, exitProject, switchProject, loadCurrentProject } = useProjectContext()
const projectStore = useProjectStore()
const route = useRoute()

function getProjectIdFromRoutePath(path: string) {
  return path.match(/^(?:\/aims)?\/projects\/(\d+)/)?.[1] || null
}

// 加载权限和项目数据
onMounted(async () => {
  loadAuthorization()
  if (projectStore.projects.length === 0) {
    await projectStore.fetchProjects({ pageSize: 500 }).catch(() => {})
  }
  projectStore.fetchFavorites().catch(() => {})
  const routeProjectId = getProjectIdFromRoutePath(route.path)
  if (routeProjectId && currentProjectId.value !== routeProjectId) {
    currentProjectId.value = routeProjectId
  }
  await loadCurrentProject()
})

// 根据路由自动设置项目上下文
if (import.meta.client) {
  watch(() => route.path, (path) => {
    const id = getProjectIdFromRoutePath(path)
    if (id && currentProjectId.value !== id) {
      projectStore.fetchProject(Number(id)).then((project) => {
        currentProjectId.value = project ? id : null
      })
    }
  }, { immediate: true })
}

// 当前项目名称
const currentProjectName = computed(() => {
  if (!currentProjectId.value) return ''
  const p = currentProject?.value || projectStore.projects.find(p => String(p.id) === currentProjectId.value)
  return p?.shortName || p?.name || ''
})

const projectSwitcherOpen = ref(false)
const projectSwitcherSearch = ref('')
const projectSwitcherFavoritesOnly = ref(false)

const currentProjectIsFavorite = computed(() => {
  if (!currentProjectId.value) return false
  return projectStore.isFavorite(Number(currentProjectId.value))
})

const switchableProjects = computed(() => {
  return projectStore.projects.filter(project => project.canAccess !== false && project.lifecycleStatus !== 'archived')
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
    .filter((project) => {
      if (projectSwitcherFavoritesOnly.value && !projectStore.isFavorite(project.id)) {
        return false
      }
      if (!keyword) return true
      const haystack = `${project.shortName} ${project.name} ${project.projectCode}`.toLowerCase()
      return haystack.includes(keyword)
    })
})

const mainNavigationItems = computed(() => {
  return globalMenuItems
    .filter(item => item.label === '工作台' || item.label === '项目日历' || item.label === '项目总览' || item.label === '项目文档' || item.label === '统计分析')
})

const utilityNavigationItems = globalUtilityItems

// 项目集 store
const portfolioStore = usePortfolioStore()

onMounted(async () => {
  portfolioStore.fetchPortfolios().catch(() => {})
})

// Layout header
// 嵌套路由下 route.meta 的响应性不可靠，改用 router.afterEach 主动同步
const router = useRouter()
const resolvedHeaderTitle = ref('')
const resolvedHeaderProjectSwitcher = ref(true)

function resolveHeaderMeta(to: typeof route) {
  let title = ''
  let switcher = true
  for (const record of to.matched) {
    const t = record?.meta?.layoutHeaderTitle
    if (typeof t === 'string' && t) title = t
    const s = record?.meta?.layoutHeaderProjectSwitcher
    if (s !== undefined) switcher = s !== false
  }
  resolvedHeaderTitle.value = title
  resolvedHeaderProjectSwitcher.value = switcher
}

// 初始化 + 路由切换后同步
resolveHeaderMeta(route)
router.afterEach((to) => {
  resolveHeaderMeta(to as unknown as typeof route)
})

const showHeaderProjectSwitcher = computed(() => {
  return hasProjectContext.value && resolvedHeaderProjectSwitcher.value
})
const layoutHeaderTitle = computed(() => resolvedHeaderTitle.value)

watch(projectSwitcherOpen, (open) => {
  if (!open) {
    projectSwitcherSearch.value = ''
    projectSwitcherFavoritesOnly.value = false
  }
})

async function handleProjectFavoriteToggle(projectId: number) {
  await projectStore.toggleFavorite(projectId)
}

async function handleProjectSwitch(projectId: number) {
  if (String(projectId) === currentProjectId.value) {
    projectSwitcherOpen.value = false
    return
  }
  projectSwitcherOpen.value = false
  projectSwitcherSearch.value = ''
  await switchProject(projectId)
}
</script>

<template>
  <UDashboardGroup unit="rem">
    <LayoutSidebar>
      <template #menu="{ collapsed, menuOverlayEnabled, navigationUi }">
        <!-- 项目菜单模式 -->
        <template v-if="hasProjectContext">
          <LayoutProjectSidebar
            :project-id="currentProjectId!"
            :collapsed="collapsed"
            :menu-overlay-enabled="menuOverlayEnabled"
            :navigation-ui="navigationUi"
            @exit-project="exitProject()"
          />
        </template>

        <!-- 主菜单模式 -->
        <template v-else>
          <UNavigationMenu
            class="pt-2"
            :collapsed="collapsed"
            :items="mainNavigationItems"
            orientation="vertical"
            :tooltip="menuOverlayEnabled"
            :popover="menuOverlayEnabled"
            :ui="navigationUi"
          />
        </template>
      </template>

      <template #extra="{ collapsed }">
        <template v-if="!hasProjectContext">
          <div v-show="!collapsed" class="my-2 border-t border-default" />

          <LayoutPortfolioTree
            :collapsed="collapsed"
            @enter-project="enterProject($event)"
          />
        </template>
      </template>

      <template #utility="{ collapsed, menuOverlayEnabled, navigationUi }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="utilityNavigationItems"
          orientation="vertical"
          :tooltip="menuOverlayEnabled"
          :popover="menuOverlayEnabled"
          :ui="navigationUi"
        />
      </template>

      <!-- 导航栏左侧：项目切换器 -->
      <template #navbar-left>
        <div class="flex min-w-0 items-center gap-3 px-2 sm:px-4">
          <div v-if="showHeaderProjectSwitcher" class="-ml-2 flex min-w-0 items-center gap-2">
            <UPopover
              v-model:open="projectSwitcherOpen"
              :content="{ align: 'start', side: 'bottom', sideOffset: 10 }"
              :ui="{ content: '-ml-2 w-[25rem] overflow-hidden rounded-2xl p-0 shadow-[0_22px_48px_rgba(15,23,42,0.16)] ring-1 ring-default/70' }"
            >
              <UButton
                class="max-w-80 justify-between rounded-xl px-3 text-[12px]"
                variant="ghost"
                color="neutral"
                trailing-icon="i-lucide-chevrons-up-down"
                size="sm"
                :label="currentProjectName || '选择项目'"
              />

              <template #content>
                <div class="border-b border-default pt-2 pb-0 px-5">
                  <div class="flex items-center rounded-xl bg-default">
                    <button
                      class="flex size-5 items-center justify-center transition-colors"
                      :class="projectSwitcherFavoritesOnly ? 'text-warning' : 'text-dimmed hover:text-highlighted'"
                      @click="projectSwitcherFavoritesOnly = !projectSwitcherFavoritesOnly"
                    >
                      <UIcon name="i-lucide-star" class="size-4" />
                    </button>

                    <UInput
                      v-model="projectSwitcherSearch"
                      class="min-w-0 flex-1"
                      :ui="{ base: 'border-0 bg-transparent px-4 shadow-none ring-0 focus-visible:ring-0' }"
                      placeholder="搜索项目..."
                      autofocus
                      size="md"
                    />

                    <UIcon name="i-lucide-search" class="size-4 shrink-0 text-dimmed" />
                  </div>
                </div>

                <div class="max-h-96 overflow-y-auto p-2">
                  <button
                    v-for="project in projectSwitcherItems"
                    :key="project.id"
                    class="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-elevated"
                    :class="String(project.id) === currentProjectId ? 'bg-elevated' : ''"
                    @click="handleProjectSwitch(project.id)"
                  >
                    <div class="flex min-w-0 items-center gap-3">
                      <UIcon name="i-lucide-leaf" class="size-4 shrink-0 text-dimmed" />
                      <div class="min-w-0">
                        <div class="truncate text-[13px] font-medium leading-5 text-highlighted">
                          {{ project.shortName || project.name }}
                        </div>
                        <div class="truncate text-[11px] leading-4 text-muted">
                          {{ project.projectCode }}
                        </div>
                      </div>
                    </div>

                    <div class="flex shrink-0 items-center gap-2">
                      <UBadge
                        v-if="projectStore.isFavorite(project.id)"
                        color="warning"
                        variant="subtle"
                        size="xs"
                      >
                        常用
                      </UBadge>
                      <UButton
                        :icon="projectStore.isFavorite(project.id) ? 'i-lucide-star' : 'i-lucide-star'"
                        :color="projectStore.isFavorite(project.id) ? 'warning' : 'neutral'"
                        :variant="projectStore.isFavorite(project.id) ? 'soft' : 'ghost'"
                        size="xs"
                        square
                        @click.stop="handleProjectFavoriteToggle(project.id)"
                      />
                      <UIcon
                        v-if="String(project.id) === currentProjectId"
                        name="i-lucide-check"
                        class="size-4 text-primary"
                      />
                    </div>
                  </button>

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
                    label="前往项目列表"
                    color="neutral"
                    variant="ghost"
                    trailing-icon="i-lucide-arrow-right"
                    @click="projectSwitcherOpen = false; exitProject()"
                  />
                </div>
              </template>
            </UPopover>

            <UButton
              :icon="currentProjectIsFavorite ? 'i-lucide-star' : 'i-lucide-star'"
              :color="currentProjectIsFavorite ? 'warning' : 'neutral'"
              :variant="currentProjectIsFavorite ? 'soft' : 'ghost'"
              size="sm"
              square
              @click="handleProjectFavoriteToggle(Number(currentProjectId))"
            />
          </div>

          <div v-if="showHeaderProjectSwitcher && layoutHeaderTitle" class="h-5 w-px shrink-0 bg-default" />

          <div class="min-w-0 flex-1">
            <p class="truncate text-base font-semibold text-highlighted">
              {{ layoutHeaderTitle }}
            </p>
          </div>
        </div>
      </template>

      <!-- 导航栏右侧：额外操作按钮 -->
      <template #navbar-right>
        <div id="aims-layout-header-actions" class="flex items-center gap-2" />
        <PivrHelpButton />
      </template>

      <!-- 页面内容 -->
      <template #default>
        <slot />
        <NotificationsSlideover />
      </template>
    </LayoutSidebar>
  </UDashboardGroup>
</template>

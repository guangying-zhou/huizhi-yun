<script setup lang="ts">
import { globalMenuItems, globalUtilityItems } from '~/config/navigation'
import { matchRouteRule, routeRuleRequirements } from '~/config/permissions'

// 用户在线心跳
useHeartbeat()

// 平台授权快照
const { loadAuthorization } = useAuthorization()
const { hasPermission } = usePermissions()

// 项目上下文
const { hasProjectContext, currentProjectId, enterProject, exitProject, loadCurrentProject } = useProjectContext()
const projectStore = useProjectStore()
const route = useRoute()
const { refreshHandler } = usePageActions()

type NavigationItem = {
  label: string
  icon?: string
  to?: string
  target?: string
  children?: NavigationItem[]
  defaultOpen?: boolean
  [key: string]: unknown
}

function isRouteInMenu(item: NavigationItem, path: string): boolean {
  if (item.target) return false

  if (typeof item.to === 'string') {
    const menuPath = item.to.split(/[?#]/, 1)[0]?.replace(/\/+$/, '') || '/'
    if (menuPath.startsWith('/') && (
      path === menuPath
      || (menuPath !== '/' && path.startsWith(`${menuPath}/`))
    )) return true
  }

  return item.children?.some(child => isRouteInMenu(child, path)) ?? false
}

function expandCurrentRouteGroups(items: NavigationItem[]): NavigationItem[] {
  return items.map((item) => {
    const result = { ...item }
    if (result.children) {
      result.children = expandCurrentRouteGroups(result.children)
      if (isRouteInMenu(result, route.path)) {
        result.defaultOpen = true
      }
    }
    return result
  })
}

function getProjectIdFromRoutePath(path: string) {
  return path.match(/^(?:\/aims)?\/projects\/(\d+)/)?.[1] || null
}

// 加载权限和项目数据
onMounted(async () => {
  await loadAuthorization({ force: true })
  if (projectStore.projects.length === 0) {
    await projectStore.fetchProjects({ pageSize: 500, participatingOnly: true }).catch(() => {})
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

const mainNavigationItems = computed(() => {
  const items = (globalMenuItems
    .filter(item => item.label === '工作台' || item.label === '项目日历' || item.label === '项目总览' || item.label === '产品中心' || item.label === '项目文档' || item.label === '质量检查' || item.label === '统计分析') as NavigationItem[])
    .filter(item => item.label !== '产品中心' || hasPermission('products', 'view') || hasPermission('products', 'onboard'))
    .map(item => item.label === '产品中心' && !hasPermission('products', 'view') ? { ...item, to: '/product-setup' } : item)
    .filter(item => item.label !== '质量检查' || hasPermission('quality_reviews', 'view') || hasPermission('quality_reviews', 'review') || hasPermission('quality_reviews', 'waive') || hasPermission('quality_reviews', 'configure'))
  return expandCurrentRouteGroups(items)
})

function canAccessUtilityRoute(to?: string) {
  if (!to) {
    return true
  }

  const rule = matchRouteRule(to)
  if (!rule) return true

  return routeRuleRequirements(rule).some(item => hasPermission(item.resource, item.action))
}

function navigationTo(item: unknown) {
  if (!item || typeof item !== 'object' || !('to' in item)) return undefined
  const to = (item as { to?: unknown }).to
  return typeof to === 'string' ? to : undefined
}

const utilityNavigationItems = computed(() => {
  const items = globalUtilityItems
    .map((item) => {
      if (!item.children?.length) {
        return canAccessUtilityRoute(navigationTo(item)) ? item : null
      }

      const children = item.children.filter(child => canAccessUtilityRoute(navigationTo(child)))
      return children.length ? { ...item, children } : null
    })
    .filter((item): item is (typeof globalUtilityItems)[number] => Boolean(item))
  return expandCurrentRouteGroups(items as NavigationItem[])
})

// 项目集 store
const portfolioStore = usePortfolioStore()

onMounted(async () => {
  portfolioStore.fetchPortfolios().catch(() => {})
})

// Layout header
// 嵌套路由下 route.meta 的响应性不可靠，改用 router.afterEach 主动同步
const router = useRouter()
const resolvedHeaderTitle = ref('')
const resolvedHeaderActions = ref(false)

function resolveHeaderMeta(to: typeof route) {
  let title = ''
  let actions = false
  for (const record of to.matched) {
    const t = record?.meta?.layoutHeaderTitle
    if (typeof t === 'string' && t) title = t
    const a = record?.meta?.layoutHeaderActions
    if (a !== undefined) actions = a === true
  }
  resolvedHeaderTitle.value = title
  resolvedHeaderActions.value = actions
}

// 初始化 + 路由切换后同步
resolveHeaderMeta(route)
router.afterEach((to) => {
  resolveHeaderMeta(to as unknown as typeof route)
})

const hideEmbeddedNavbar = computed(() => !resolvedHeaderActions.value)
const layoutHeaderTitle = computed(() => resolvedHeaderTitle.value)
</script>

<template>
  <UDashboardGroup unit="rem">
    <LayoutSidebar
      :hide-navbar-when-embedded="hideEmbeddedNavbar"
      :refresh-handler="refreshHandler || undefined"
    >
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
            :key="route.path"
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
          :key="route.path"
          :collapsed="collapsed"
          :items="utilityNavigationItems"
          orientation="vertical"
          :tooltip="menuOverlayEnabled"
          :popover="menuOverlayEnabled"
          :ui="navigationUi"
        />
      </template>

      <!-- 导航栏左侧：页面标题；项目切换器由 ProjectNavbar 承载 -->
      <template #navbar-left>
        <div class="flex min-w-0 items-center px-2 sm:px-4">
          <div class="min-w-0 flex-1">
            <p class="truncate text-base font-semibold text-highlighted">
              {{ layoutHeaderTitle }}
            </p>
          </div>
        </div>
      </template>

      <!-- 导航栏右侧：额外操作按钮 -->
      <template #navbar-right>
        <div class="flex items-center gap-2">
          <div id="aims-layout-header-actions" class="flex items-center gap-2" />
          <UButton
            v-if="refreshHandler"
            data-page-refresh
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            square
            aria-label="刷新当前页面"
            title="刷新当前页面"
            @click="refreshHandler?.()"
          />
        </div>
      </template>

      <!-- 页面内容 -->
      <template #default>
        <slot />
      </template>
    </LayoutSidebar>
  </UDashboardGroup>
</template>

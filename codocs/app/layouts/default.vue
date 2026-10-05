<script setup lang="ts">
import { menus as rawMenus } from '~/config/permissions'

interface MenuItemWithSelect {
  to?: string
  target?: string
  children?: MenuItemWithSelect[]
  onSelect?: () => void
  defaultOpen?: boolean
  [key: string]: unknown
}

const route = useRoute()
const { refreshHandler } = usePageActions()
const { headerActions } = useLayoutHeaderActions()
const { embedded: applicationShellEmbedded } = useApplicationShell()
const visibleHeaderActions = computed(() => {
  return headerActions.value.filter(action => action.show !== false)
})
const hideEmbeddedNavbar = computed(() => visibleHeaderActions.value.length === 0)
const embeddedNavbarMobileOnly = computed(() => {
  return visibleHeaderActions.value.length > 0
    && visibleHeaderActions.value.every((action) => {
      return String(action.class || '').split(/\s+/).includes('md:hidden')
    })
})
const showLocalRefresh = computed(() => (
  Boolean(refreshHandler.value) && !applicationShellEmbedded.value
))

// 用户在线心跳
useHeartbeat('codocs')

// RBAC 权限
const { loadPermissions, filterMenus } = usePermissions()

// 加载权限
onMounted(() => {
  void loadPermissions()
})

// 为菜单项添加 onSelect，并根据当前路由展开父级菜单
function isRouteInMenu(item: MenuItemWithSelect, path: string): boolean {
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

function addOnSelect(items: MenuItemWithSelect[]): MenuItemWithSelect[] {
  return items.map((item) => {
    const result = { ...item }
    if (result.to && !result.target) {
      result.onSelect = () => {}
    }
    if (result.children) {
      result.children = addOnSelect(result.children)
      if (isRouteInMenu(result, route.path)) {
        result.defaultOpen = true
      }
    }
    return result
  })
}

// 动态计算过滤后的菜单
const links = computed(() => {
  const filtered = filterMenus(rawMenus)
  return [
    addOnSelect((filtered[0] || []) as MenuItemWithSelect[]),
    addOnSelect((filtered[1] || []) as MenuItemWithSelect[])
  ]
})

const primaryLinks = computed(() => links.value[0] || [])
const utilityLinks = computed(() => links.value[1] || [])

const groups = computed(() => [{
  id: 'links',
  label: '导航',
  items: [...primaryLinks.value, ...utilityLinks.value]
}])
</script>

<template>
  <UDashboardGroup unit="rem">
    <LayoutSidebar
      :primary-links="primaryLinks"
      :utility-links="utilityLinks"
      :hide-navbar-when-embedded="hideEmbeddedNavbar"
      :embedded-navbar-mobile-only="embeddedNavbarMobileOnly"
    >
      <template #menu="{ collapsed, menuOverlayEnabled, navigationUi }">
        <UNavigationMenu
          v-if="primaryLinks.length"
          :key="route.path"
          :collapsed="collapsed"
          :items="primaryLinks"
          orientation="vertical"
          :tooltip="menuOverlayEnabled"
          :popover="menuOverlayEnabled"
          :ui="navigationUi"
        />
      </template>

      <template #navbar-right>
        <div class="flex items-center gap-2">
          <UButton
            v-if="showLocalRefresh"
            data-page-refresh
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            square
            @click="refreshHandler?.()"
          />
          <UButton
            v-for="action in visibleHeaderActions"
            :key="action.key"
            :icon="action.icon"
            :label="action.label"
            :aria-label="action.ariaLabel"
            :title="action.title"
            :color="action.color || 'neutral'"
            :variant="action.variant || 'ghost'"
            :size="action.size || 'sm'"
            :square="action.square"
            :class="action.class"
            @click="action.onClick"
          />
        </div>
      </template>
      <template #utility="{ collapsed, menuOverlayEnabled, navigationUi }">
        <MyDocumentStatsMini :collapsed="collapsed" />
        <UNavigationMenu
          v-if="utilityLinks?.length"
          :key="route.path"
          :collapsed="collapsed"
          :items="utilityLinks"
          orientation="vertical"
          :tooltip="menuOverlayEnabled"
          :popover="menuOverlayEnabled"
          :ui="navigationUi"
        />
      </template>
      <template #default>
        <UDashboardSearch :groups="groups" />
        <slot />
      </template>
    </LayoutSidebar>
  </UDashboardGroup>
</template>

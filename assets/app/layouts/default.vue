<script setup lang="ts">
import { menus as rawMenus } from '~/config/permissions'
import type { MenuItemDefinition } from '~/config/permissions'

type NavigationMenuItem = Omit<MenuItemDefinition, 'children'> & {
  label: string
  children?: NavigationMenuItem[]
  onSelect?: () => void
  defaultOpen?: boolean
}

// 用户在线心跳
useHeartbeat('assets')

// RBAC 权限
const { loadPermissions, filterMenus } = usePermissions()
const pageTitle = usePageTitle()
const { refreshHandler } = usePageActions()
const route = useRoute()

onMounted(() => {
  loadPermissions()
})

function isRouteInMenu(item: NavigationMenuItem, path: string): boolean {
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

function addOnSelect(items: MenuItemDefinition[]): NavigationMenuItem[] {
  return items.map((item) => {
    const result: NavigationMenuItem = { ...item }
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

const links = computed(() => {
  const filtered = filterMenus(rawMenus)
  return filtered.map(group => addOnSelect(group as MenuItemDefinition[]))
})

const groups = computed(() => [{
  id: 'links',
  label: '导航',
  items: links.value.flat()
}])
</script>

<template>
  <UDashboardGroup unit="rem">
    <LayoutSidebar>
      <template #menu="{ collapsed, menuOverlayEnabled, navigationUi }">
        <UNavigationMenu
          :key="route.path"
          :collapsed="collapsed"
          :items="links[0]"
          orientation="vertical"
          :tooltip="menuOverlayEnabled"
          :popover="menuOverlayEnabled"
          :ui="navigationUi"
        />
      </template>

      <template #utility="{ collapsed, menuOverlayEnabled, navigationUi }">
        <UNavigationMenu
          :key="route.path"
          :collapsed="collapsed"
          :items="links[1]"
          orientation="vertical"
          :tooltip="menuOverlayEnabled"
          :popover="menuOverlayEnabled"
          :ui="navigationUi"
        />
      </template>

      <template #navbar-left>
        <h1 v-if="pageTitle" class="truncate text-base font-semibold">
          {{ pageTitle }}
        </h1>
        <div v-else id="assets-layout-header-title" class="flex min-w-0 flex-1 items-center gap-2 px-2 sm:px-4" />
      </template>

      <template #navbar-right>
        <UButton
          v-if="refreshHandler"
          data-page-refresh
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          square
          aria-label="刷新"
          @click="refreshHandler?.()"
        />
      </template>

      <template #default>
        <UDashboardSearch :groups="groups" />
        <slot />
      </template>
    </LayoutSidebar>
  </UDashboardGroup>
</template>

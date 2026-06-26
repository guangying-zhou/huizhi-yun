<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, NavigationMenuItem } from '@nuxt/ui'
import { menus as rawMenus } from '~/config/permissions'

// RBAC 权限
const { loadPermissions, filterMenus, loaded: permissionsLoaded, hasPermission } = usePermissions()
const route = useRoute()

onMounted(() => {
  loadPermissions()
})

const workspaceMenu = [[
  {
    label: '工作台',
    icon: 'i-lucide-house',
    to: '/'
  },
  {
    label: '个人资料',
    icon: 'i-lucide-user-round',
    to: '/profile'
  }
], [
  {
    label: '技术支持',
    icon: 'i-lucide-message-circle',
    to: 'mailto:admin@wiztek.cn',
    target: '_blank'
  }
]] satisfies NavigationMenuItem[][]

const isWorkspaceRoute = computed(() => route.path === '/' || route.path === '/profile')
const layoutAppTitle = computed(() => isWorkspaceRoute.value ? '汇智云' : undefined)
const appRailCurrentCode = computed(() => isWorkspaceRoute.value ? 'workspace' : 'console')
const canViewAdmin = computed(() => permissionsLoaded.value && hasPermission('console_overview', 'view'))
const appRailFixedItems = [{
  appCode: 'workspace',
  appName: '工作台',
  icon: 'i-lucide-house',
  homeUrl: '/',
  external: false
}]
const appRailOverrides = computed(() => ({
  console: {
    homeUrl: '/admin',
    external: false,
    hidden: !canViewAdmin.value
  }
}))

// 动态计算过滤后的菜单
const links = computed(() => {
  if (isWorkspaceRoute.value) {
    return workspaceMenu
  }

  return filterMenus(rawMenus) as NavigationMenuItem[][]
})

const primaryLinks = computed(() => links.value[0] || [])
const utilityLinks = computed(() => links.value.slice(1).flat())

const groups = computed(() => [{
  id: 'links',
  label: '导航',
  items: links.value.flat() as unknown as CommandPaletteItem[]
}] satisfies CommandPaletteGroup<CommandPaletteItem>[])
</script>

<template>
  <UDashboardGroup unit="rem">
    <LayoutSidebar :app-title="layoutAppTitle">
      <template #app-rail>
        <AppRail
          :current-app-code="appRailCurrentCode"
          :fixed-items="appRailFixedItems"
          :app-overrides="appRailOverrides"
        />
      </template>

      <template #menu="{ collapsed, menuOverlayEnabled, navigationUi }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="primaryLinks"
          orientation="vertical"
          :tooltip="menuOverlayEnabled"
          :popover="menuOverlayEnabled"
          :ui="navigationUi"
        />
      </template>

      <template #utility="{ collapsed, menuOverlayEnabled, navigationUi }">
        <UNavigationMenu
          v-if="utilityLinks.length"
          :collapsed="collapsed"
          :items="utilityLinks"
          orientation="vertical"
          :tooltip="menuOverlayEnabled"
          :popover="menuOverlayEnabled"
          :ui="navigationUi"
        />
      </template>

      <template #navbar-right>
        <AuthorizationSimulationLauncher />
      </template>

      <template #default>
        <UDashboardSearch :groups="groups" />
        <AuthorizationSimulationBar />
        <slot />
      </template>
    </LayoutSidebar>
  </UDashboardGroup>
</template>

<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem, NavigationMenuItem } from '@nuxt/ui'
import { menus as rawMenus } from '~/config/permissions'

// RBAC 权限
const { loadPermissions, filterMenus } = usePermissions()
const route = useRoute()
useHeartbeat('console')

onMounted(() => {
  loadPermissions()
})

// Console is the standalone administration console (ADR-018a D8): its home is
// /admin and the employee workbench lives in Enterprise, so there is no
// workbench entry or application rail here.
const workspaceMenu = [[
  {
    label: '个人资料',
    icon: 'i-lucide-user-round',
    to: '/profile'
  },
  {
    label: '消息中心',
    icon: 'i-lucide-message-square-text',
    to: '/notifications'
  }
], [
  {
    label: '技术支持',
    icon: 'i-lucide-message-circle',
    to: 'mailto:admin@wiztek.cn',
    target: '_blank'
  }
]] satisfies NavigationMenuItem[][]

const isWorkspaceRoute = computed(() => (
  route.path === '/'
  || route.path === '/profile'
  || route.path === '/notifications'
  || route.path.startsWith('/notifications/')
))
const layoutAppTitle = computed(() => isWorkspaceRoute.value ? '汇智云' : undefined)
const seamlessLandingHeader = computed(() => route.path === '/' || route.path === '/admin')

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

function expandCurrentRouteGroups(items: NavigationMenuItem[]): NavigationMenuItem[] {
  return items.map(item => ({
    ...item,
    defaultOpen: item.children?.length ? isRouteInMenu(item, route.path) : item.defaultOpen
  }))
}

// 动态计算过滤后的菜单
const links = computed(() => {
  if (isWorkspaceRoute.value) {
    return workspaceMenu
  }

  return (filterMenus(rawMenus) as NavigationMenuItem[][])
    .map(group => expandCurrentRouteGroups(group))
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
    <LayoutSidebar
      app-navigation="none"
      :app-title="layoutAppTitle"
      :hide-page-title="seamlessLandingHeader"
      :seamless-top-header="seamlessLandingHeader"
    >
      <template #menu="{ collapsed, menuOverlayEnabled, navigationUi }">
        <UNavigationMenu
          :key="route.path"
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
          :key="route.path"
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

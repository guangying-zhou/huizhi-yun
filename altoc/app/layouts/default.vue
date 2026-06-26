<script setup lang="ts">
import { menus as rawMenus } from '~/config/permissions'
import type { MenuItem } from '~/config/permissions'

type NavigationMenuItem = Omit<MenuItem, 'children'> & {
  label: string
  children?: NavigationMenuItem[]
  onSelect?: () => void
}

// 用户在线心跳
useHeartbeat('altoc')

// RBAC 权限
const { loadPermissions, filterMenus } = usePermissions()

onMounted(() => {
  loadPermissions()
})

function addOnSelect(items: MenuItem[]): NavigationMenuItem[] {
  return items.map((item) => {
    const result: NavigationMenuItem = { ...item }
    if (result.to && !result.target) {
      result.onSelect = () => {}
    }
    if (result.children) {
      result.children = addOnSelect(result.children)
    }
    return result
  })
}

const links = computed(() => {
  const filtered = filterMenus(rawMenus)
  return filtered.map(group => addOnSelect(group as MenuItem[]))
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
          :collapsed="collapsed"
          :items="links[1]"
          orientation="vertical"
          :tooltip="menuOverlayEnabled"
          :popover="menuOverlayEnabled"
          :ui="navigationUi"
        />
      </template>

      <!-- 页面级标题挂载点：各页面通过 Teleport 注入标题/返回按钮 -->
      <template #navbar-left>
        <div id="altoc-layout-header-title" class="flex min-w-0 flex-1 items-center gap-2 px-2 sm:px-4" />
      </template>

      <!-- 页面级头部操作按钮挂载点：各页面通过 Teleport 注入 -->
      <template #navbar-right>
        <div id="altoc-layout-header-actions" class="flex items-center gap-2" />
      </template>

      <template #default>
        <UDashboardSearch :groups="groups" />
        <slot />
      </template>
    </LayoutSidebar>
  </UDashboardGroup>
</template>

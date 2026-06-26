<script setup lang="ts">
import type { MenuItem } from '~/config/permissions'
import { menus as rawMenus } from '~/config/permissions'

// 用户在线心跳
useHeartbeat()

// RBAC 权限
const { loadPermissions, filterMenus } = usePermissions()

onMounted(() => {
  loadPermissions()
})

// 为菜单项添加 onSelect（关闭移动端侧边栏）
function addOnSelect(items: MenuItem[]): MenuItem[] {
  return items.map((item) => {
    const result = { ...item }
    if (result.to && !result.target) {
      result.onSelect = () => {}
    }
    if (result.children) {
      result.children = addOnSelect(result.children)
    }
    return result
  })
}

// 动态计算过滤后的菜单
const links = computed(() => {
  const filtered = filterMenus(rawMenus) as MenuItem[][]
  return filtered.map(group => addOnSelect(group))
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
          :items="links[0] || []"
          orientation="vertical"
          :tooltip="menuOverlayEnabled"
          :popover="menuOverlayEnabled"
          :ui="navigationUi"
        />
      </template>

      <template #utility="{ collapsed, menuOverlayEnabled, navigationUi }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="links[1] || []"
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

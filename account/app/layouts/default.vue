<script setup lang="ts">
import { menus as rawMenus } from '~/config/permissions'
import type { MenuItem } from '~/config/permissions'

// 用户在线心跳
useHeartbeat()

// RBAC Permissions
const { loadPermissions, filterMenus } = usePermissions()

onMounted(() => {
  loadPermissions()
})

// Add onSelect to menu items (closes sidebar on mobile)
function addOnSelect(items: MenuItem[]): MenuItem[] {
  return items.map((item) => {
    const result: MenuItem = { ...item }
    if (result.to && !result.target) {
      result.onSelect = () => {}
    }
    if (result.children) {
      result.children = addOnSelect(result.children)
    }
    return result
  })
}

// Dynamically compute filtered menus
const links = computed(() => {
  const filtered = filterMenus(rawMenus)
  return filtered.map(group => addOnSelect(group))
})

const primaryLinks = computed<Array<Record<string, unknown>>>(() => {
  return (links.value[0] || []) as Array<Record<string, unknown>>
})

const utilityLinks = computed<Array<Record<string, unknown>>>(() => {
  return links.value.slice(1).flat() as Array<Record<string, unknown>>
})

const groups = computed(() => [{
  id: 'links',
  label: '导航',
  items: links.value.flat() as Array<Record<string, unknown>>
}])
</script>

<template>
  <UDashboardGroup unit="rem">
    <LayoutSidebar :primary-links="primaryLinks" :utility-links="utilityLinks">
      <template #default>
        <UDashboardSearch :groups="groups" />
        <slot />
        <NotificationsSlideover />
      </template>
    </LayoutSidebar>
  </UDashboardGroup>
</template>

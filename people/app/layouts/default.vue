<script setup lang="ts">
import { menus as rawMenus } from '~/config/permissions'
import type { MenuItemDefinition } from '~/config/permissions'

type NavigationMenuItem = Omit<MenuItemDefinition, 'children'> & {
  label: string
  children?: NavigationMenuItem[]
  onSelect?: () => void
}

useHeartbeat('people')

const { loadPermissions, filterMenus } = usePermissions()
const { ensurePeoplePermission } = usePeopleAuthorization()

onMounted(() => {
  void ensurePeoplePermission('dashboard', 'view').catch(() => loadPermissions())
})

function addOnSelect(items: MenuItemDefinition[]): NavigationMenuItem[] {
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

      <template #navbar-left>
        <div
          id="people-layout-header-title"
          class="flex min-w-0 flex-1 items-center gap-2 px-2 sm:px-4"
        />
      </template>

      <template #navbar-right>
        <div
          id="people-layout-header-actions"
          class="flex items-center gap-2"
        />
      </template>

      <template #default>
        <UDashboardSearch :groups="groups" />
        <slot />
      </template>
    </LayoutSidebar>
  </UDashboardGroup>
</template>

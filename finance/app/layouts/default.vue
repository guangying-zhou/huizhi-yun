<script setup lang="ts">
import { menus as rawMenus } from '~/config/permissions'
import type { MenuItemDefinition } from '~/config/permissions'

useHeartbeat('finance')

const { loadPermissions, filterMenus } = usePermissions()
const { refreshHandler } = usePageActions()
const route = useRoute()
const hidePageNavbar = computed(() => route.meta.hidePageNavbar === true)

onMounted(() => {
  loadPermissions()
})

function isRouteInMenu(item: MenuItemDefinition, path: string): boolean {
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

function addOnSelect(items: MenuItemDefinition[]): MenuItemDefinition[] {
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

const links = computed(() => {
  const filtered = filterMenus(rawMenus) as MenuItemDefinition[][]
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
    <LayoutSidebar
      :refresh-handler="refreshHandler || undefined"
      :hide-navbar="hidePageNavbar"
    >
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

      <template #navbar-right>
        <div class="flex items-center gap-2">
          <div
            id="finance-layout-header-actions"
            class="flex items-center gap-2"
          />
          <UButton
            v-if="refreshHandler"
            data-page-refresh
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            square
            @click="refreshHandler?.()"
          />
        </div>
      </template>

      <template #default>
        <UDashboardSearch :groups="groups" />
        <slot />
      </template>
    </LayoutSidebar>
  </UDashboardGroup>
</template>

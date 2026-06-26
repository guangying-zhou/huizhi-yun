<script setup lang="ts">
import { menus as rawMenus } from '~/config/permissions'
import type { MenuItemDefinition } from '~/config/permissions'

useHeartbeat('finance')

const { loadPermissions, filterMenus } = usePermissions()
const { refreshHandler } = usePageActions()

onMounted(() => {
  loadPermissions()
})

function addOnSelect(items: MenuItemDefinition[]): MenuItemDefinition[] {
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
    <LayoutSidebar :refresh-handler="refreshHandler || undefined">
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

      <template #navbar-right>
        <div class="flex items-center gap-2">
          <div
            id="finance-layout-header-actions"
            class="flex items-center gap-2"
          />
          <UButton
            v-if="refreshHandler"
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

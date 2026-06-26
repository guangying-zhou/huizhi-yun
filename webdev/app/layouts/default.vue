<script setup lang="ts">
import { menus as rawMenus } from '~/config/permissions'

type MenuItem = {
  label?: string
  to?: string
  target?: string
  children?: MenuItem[]
  onSelect?: () => void
  [key: string]: unknown
}

useHeartbeat('webdev')

const { loadPermissions, filterMenus } = usePermissions()
const { refreshHandler } = usePageActions()

onMounted(() => {
  loadPermissions()
})

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

const links = computed(() => {
  const filtered = filterMenus(rawMenus)
  return filtered.map((group: MenuItem[]) => addOnSelect(group))
})

const primaryLinks = computed(() => links.value[0] || [])
const utilityLinks = computed(() => links.value.slice(1).flat())

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
          v-if="primaryLinks.length"
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
        <UButton
          v-if="refreshHandler"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          square
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

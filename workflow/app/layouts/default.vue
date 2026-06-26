<script setup lang="ts">
import { menus as rawMenus } from '~/config/permissions'

type MenuItem = {
  label?: string
  to?: string
  target?: string
  onSelect?: () => void
  children?: MenuItem[]
  [key: string]: unknown
}

// 用户在线心跳
useHeartbeat()

// RBAC 权限
const { loadPermissions, filterMenus } = usePermissions()

onMounted(() => {
  loadPermissions()
})

// 页面标题
const pageTitle = usePageTitle()

// 页面操作
const { refreshHandler } = usePageActions()

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
    <LayoutSidebar>
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

      <template #navbar-left>
        <h1 v-if="pageTitle" class="truncate text-base font-semibold">
          {{ pageTitle }}
        </h1>
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

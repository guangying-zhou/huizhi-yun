<script setup lang="ts">
import { menus as rawMenus } from '~/config/permissions'

interface MenuItemWithSelect {
  to?: string
  target?: string
  children?: MenuItemWithSelect[]
  onSelect?: () => void
  defaultOpen?: boolean
  [key: string]: unknown
}

const route = useRoute()
const { refreshHandler } = usePageActions()
const { headerActions } = useLayoutHeaderActions()
const visibleHeaderActions = computed(() => {
  return headerActions.value.filter(action => action.show !== false)
})

// 用户在线心跳
useHeartbeat('codocs')

// RBAC 权限
const { loadPermissions, filterMenus } = usePermissions()

// 待处理 Issue 数量
const pendingIssueCount = ref(0)
const totalIssueCount = ref(0)

async function fetchPendingIssueCount() {
  try {
    const res = await $fetch<{ success: boolean, data: { pending: number, total: number } }>('/api/issues/pending-count')
    pendingIssueCount.value = res.data?.pending || 0
    totalIssueCount.value = res.data?.total || 0
  } catch {
    pendingIssueCount.value = 0
    totalIssueCount.value = 0
  }
}

// 加载权限
onMounted(() => {
  loadPermissions()
  fetchPendingIssueCount()
})

// 为菜单项添加 onSelect + Issue 角标
function isRouteInMenu(item: MenuItemWithSelect, path: string): boolean {
  if (item.target) return false
  if (typeof item.to === 'string' && item.to === path) return true
  return item.children?.some(child => isRouteInMenu(child, path)) ?? false
}

function addOnSelect(items: MenuItemWithSelect[]): MenuItemWithSelect[] {
  return items.map((item) => {
    const result = { ...item }
    if (result.to && !result.target) {
      result.onSelect = () => {}
    }
    if (result.to === '/projects/issues' && totalIssueCount.value > 0) {
      result.badge = {
        color: pendingIssueCount.value > 0 ? 'error' as const : 'neutral' as const,
        variant: 'subtle' as const,
        label: `${pendingIssueCount.value}/${totalIssueCount.value}`
      }
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

// 动态计算过滤后的菜单
const links = computed(() => {
  const filtered = filterMenus(rawMenus)
  return [
    addOnSelect((filtered[0] || []) as MenuItemWithSelect[]),
    addOnSelect((filtered[1] || []) as MenuItemWithSelect[])
  ]
})

const primaryLinks = computed(() => links.value[0] || [])
const guideMenu = computed(() =>
  (links.value[1] || []).find(item => item.label === '使用指南') || null
)
const utilityLinks = computed(() =>
  (links.value[1] || []).filter(item => item.label !== '使用指南')
)
const guideDropdownItems = computed(() => {
  if (!guideMenu.value?.children?.length) return []
  return [
    guideMenu.value.children.map(item => ({
      label: String(item.label || ''),
      icon: typeof item.icon === 'string' ? item.icon : undefined,
      to: typeof item.to === 'string' ? item.to : undefined,
      target: typeof item.target === 'string' ? item.target : undefined
    }))
  ]
})

const groups = computed(() => [{
  id: 'links',
  label: '导航',
  items: [...primaryLinks.value, ...utilityLinks.value]
}])
</script>

<template>
  <UDashboardGroup unit="rem">
    <LayoutSidebar :primary-links="primaryLinks" :utility-links="utilityLinks">
      <template #navbar-right>
        <div class="flex items-center gap-2">
          <UButton
            v-if="refreshHandler"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            square
            @click="refreshHandler?.()"
          />
          <UButton
            v-for="action in visibleHeaderActions"
            :key="action.key"
            :icon="action.icon"
            :label="action.label"
            :aria-label="action.ariaLabel"
            :title="action.title"
            :color="action.color || 'neutral'"
            :variant="action.variant || 'ghost'"
            :size="action.size || 'sm'"
            :square="action.square"
            :class="action.class"
            @click="action.onClick"
          />
          <UDropdownMenu
            v-if="guideDropdownItems.length"
            :items="guideDropdownItems"
            :content="{ align: 'end', collisionPadding: 12 }"
          >
            <UButton
              icon="i-lucide-circle-question-mark"
              color="neutral"
              variant="ghost"
              square
              aria-label="使用指南"
              title="使用指南"
            />
          </UDropdownMenu>
        </div>
      </template>
      <template #utility="{ collapsed, menuOverlayEnabled, navigationUi }">
        <MyDocumentStatsMini :collapsed="collapsed" />
        <UNavigationMenu
          v-if="utilityLinks?.length"
          :collapsed="collapsed"
          :items="utilityLinks"
          orientation="vertical"
          :tooltip="menuOverlayEnabled"
          :popover="menuOverlayEnabled"
          :ui="navigationUi"
        />
      </template>
      <template #default>
        <UDashboardSearch :groups="groups" />
        <slot />
        <NotificationsSlideover />
      </template>
    </LayoutSidebar>
  </UDashboardGroup>
</template>

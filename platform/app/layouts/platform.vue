<script setup lang="ts">
interface NavItem {
  key: string
  label: string
  icon: string
  to: string
  count?: number
  matchPrefix?: boolean
}

interface NavGroup {
  group: string
  items: NavItem[]
}

const NAV_ADMIN: NavGroup[] = [
  {
    group: '工作台',
    items: [
      { key: 'home', label: '工作台', icon: 'i-lucide-house', to: '/admin' }
    ]
  },
  {
    group: '产品',
    items: [
      { key: 'applications', label: '应用', icon: 'i-lucide-box', to: '/admin/applications', count: 9, matchPrefix: true },
      { key: 'plans', label: '订阅计划', icon: 'i-lucide-layers', to: '/admin/plans', count: 4, matchPrefix: true },
      { key: 'enterprise-roles', label: '企业角色', icon: 'i-lucide-users-round', to: '/admin/enterprise-roles', count: 5, matchPrefix: true },
      { key: 'app-roles', label: '应用权限角色', icon: 'i-lucide-shield', to: '/admin/system-roles', count: 12, matchPrefix: true }
    ]
  },
  {
    group: '运营',
    items: [
      { key: 'tenants', label: '租户', icon: 'i-lucide-building-2', to: '/admin/tenants', count: 47, matchPrefix: true },
      { key: 'orders', label: '订单', icon: 'i-lucide-receipt', to: '/admin/orders' },
      { key: 'invoices', label: '发票', icon: 'i-lucide-file-text', to: '/admin/invoices' },
      { key: 'payments', label: '付款', icon: 'i-lucide-credit-card', to: '/admin/payments' },
      { key: 'tickets', label: '工单', icon: 'i-lucide-ticket', to: '/admin/tickets' },
      { key: 'announcements', label: '公告', icon: 'i-lucide-megaphone', to: '/admin/announcements' }
    ]
  },
  {
    group: '平台设置',
    items: [
      { key: 'accounts', label: '平台账号', icon: 'i-lucide-users', to: '/admin/accounts' },
      { key: 'platform-roles', label: '平台角色', icon: 'i-lucide-shield-check', to: '/admin/platform-roles' },
      { key: 'feature-flags', label: 'Feature Flag', icon: 'i-lucide-flag', to: '/admin/feature-flags' },
      { key: 'audit', label: '审计日志', icon: 'i-lucide-activity', to: '/admin/audit' }
    ]
  }
]

const auth = useAuth()
const route = useRoute()

useHeartbeat()

const displayUser = computed(() => String(auth.userRealname.value || auth.user.value || 'admin'))
const initials = computed(() => {
  const u = displayUser.value
  return u.length >= 2 ? u.slice(0, 2).toUpperCase() : u.toUpperCase()
})

const userMenuItems = computed(() => [[
  {
    label: displayUser.value,
    icon: 'i-lucide-user'
  },
  {
    label: '退出登录',
    icon: 'i-lucide-log-out'
  }
]])

function isActive(item: NavItem): boolean {
  if (item.to === '/admin') return route.path === '/admin'
  if (item.matchPrefix) return route.path === item.to || route.path.startsWith(`${item.to}/`)
  return route.path === item.to
}
</script>

<template>
  <div class="console-v2">
    <header class="console-topbar">
      <div class="row gap-1.5">
        <NuxtLink
          to="/"
          class="brand"
        >
          <img
            src="/logo.svg"
            alt="platform"
            class="h-6 w-6"
          >
          <span>汇智云Platform</span>
        </NuxtLink>
        <span class="brand-divider">|</span>
        <UBadge
          color="primary"
          variant="soft"
          size="sm"
          class="font-medium"
        >
          Admin Console
        </UBadge>
      </div>

      <div class="topbar-actions">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-search"
          class="text-muted"
        >
          搜索...
          <UKbd
            value="meta"
            size="sm"
          />
          <UKbd
            value="K"
            size="sm"
          />
        </UButton>
        <UTooltip text="文档">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-circle-help"
            square
          />
        </UTooltip>
        <UTooltip text="通知">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-bell"
            square
          />
        </UTooltip>
        <UDropdownMenu :items="userMenuItems">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            trailing-icon="i-lucide-chevron-down"
            class="pl-1.5"
          >
            <UAvatar
              :alt="displayUser"
              size="xs"
              :ui="{ fallback: 'text-[11px] font-semibold' }"
            >
              {{ initials }}
            </UAvatar>
            <span class="user-name">{{ displayUser }}</span>
          </UButton>
        </UDropdownMenu>
      </div>
    </header>

    <aside class="console-sidebar">
      <div
        v-for="group in NAV_ADMIN"
        :key="group.group"
        class="nav-group"
      >
        <div class="nav-group-label">
          {{ group.group }}
        </div>
        <UButton
          v-for="item in group.items"
          :key="item.key"
          :to="item.to"
          :icon="item.icon"
          :label="item.label"
          :active="isActive(item)"
          :color="isActive(item) ? 'primary' : 'neutral'"
          :variant="isActive(item) ? 'soft' : 'ghost'"
          size="sm"
          block
          class="justify-start"
          :ui="{ trailingIcon: 'ms-auto' }"
        >
          <template
            v-if="item.count != null"
            #trailing
          >
            <UBadge
              color="neutral"
              variant="soft"
              size="sm"
              class="ml-auto font-mono"
            >
              {{ item.count }}
            </UBadge>
          </template>
        </UButton>
      </div>
    </aside>

    <main class="console-main">
      <div class="console-content">
        <slot />
      </div>
    </main>
  </div>
</template>

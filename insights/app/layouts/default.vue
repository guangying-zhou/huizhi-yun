<script setup lang="ts">
const config = useRuntimeConfig()
const { logout, user } = useRepoInsightAuth()

const open = ref(false)

const navigationItems = [
  {
    label: '概览',
    icon: 'i-lucide-layout-dashboard',
    to: '/'
  },
  {
    label: '仓库',
    icon: 'i-lucide-git-branch',
    children: [
      { label: '管理', to: '/repos' },
      { label: '采集', to: '/repos/ingestion' }
    ]
  },
  {
    label: '分析',
    icon: 'i-lucide-bar-chart-3',
    children: [
      { label: '贡献者分析', to: '/dashboard/contributors' },
      { label: '仓库分析', to: '/dashboard/repos' },
      { label: '部门分析', to: '/dashboard/departments' },
      { label: '关系图', to: '/dashboard/relations' }
    ]
  },
  {
    label: '监控',
    icon: 'i-lucide-bell',
    children: [
      { label: '事件', to: '/monitoring/events' },
      { label: '规则', to: '/monitoring/rules' },
      { label: '设置', to: '/monitoring/settings' }
    ]
  },
  {
    label: '报表',
    icon: 'i-lucide-file-text',
    children: [
      { label: '提交报表', to: '/reports/commits' },
      { label: '贡献者报表', to: '/reports/contributors' },
      { label: '部门报表', to: '/reports/departments' },
      { label: '仓库报表', to: '/reports/repos' }
    ]
  },
  {
    label: '设置',
    icon: 'i-lucide-settings',
    to: '/settings'
  }
]
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar
      v-model:open="open"
      collapsible
      resizable
    >
      <template #header="{ collapsed }">
        <NuxtLink
          to="/"
          class="flex items-center gap-2 px-2"
        >
          <img
            :src="config.public.appLogo"
            :alt="config.public.appDisplayName"
            class="h-7 w-auto shrink-0"
          >
          <span
            v-if="!collapsed"
            class="truncate text-lg font-semibold"
          >
            {{ config.public.appDisplayName }}
          </span>
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="navigationItems"
          orientation="vertical"
        />
      </template>

      <template #footer="{ collapsed }">
        <div class="flex items-center gap-2 px-2 py-1">
          <UIcon
            name="i-lucide-user"
            class="size-5 shrink-0 text-muted"
          />
          <span
            v-if="!collapsed"
            class="truncate text-sm text-muted"
          >
            {{ user || '未登录' }}
          </span>
          <UButton
            v-if="!collapsed"
            icon="i-lucide-log-out"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            class="ml-auto"
            @click="logout"
          />
        </div>
      </template>
    </UDashboardSidebar>

    <UDashboardPanel>
      <slot />
    </UDashboardPanel>
  </UDashboardGroup>
</template>

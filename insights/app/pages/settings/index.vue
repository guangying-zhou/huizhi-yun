<script setup lang="ts">
const { apiBase } = useApiBase()

const settingsLinks = [
  { label: '个人资料', icon: 'i-lucide-user', to: `/settings/profile`, description: '管理您的个人信息和偏好设置' },
  { label: '贡献者管理', icon: 'i-lucide-users', to: `/settings/contributors`, description: '管理贡献者信息和账号归并' },
  { label: '部门管理', icon: 'i-lucide-building-2', to: `/settings/departments`, description: '管理组织部门结构' },
  { label: '仓库源配置', icon: 'i-lucide-git-branch', to: `/settings/repo-sources`, description: '配置GitLab/SVN等仓库数据源' },
  { label: '系统参数', icon: 'i-lucide-sliders', to: `/settings/params`, description: '配置系统运行参数' },
  { label: '用户管理', icon: 'i-lucide-shield', to: `/settings/users`, description: '管理系统用户和权限' }
]
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar title="系统设置">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
    </UDashboardNavbar>

    <div class="p-6">
      <div class="grid grid-cols-3 gap-4">
        <NuxtLink
          v-for="link in settingsLinks"
          :key="link.to"
          :to="link.to"
          class="block p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:border-primary-500 hover:shadow-md transition-all"
        >
          <div class="flex items-start gap-3">
            <div class="p-2 bg-primary-50 dark:bg-primary-900/20 rounded-lg">
              <UIcon
                :name="link.icon"
                class="text-xl text-primary-600"
              />
            </div>
            <div>
              <h3 class="font-semibold text-gray-900 dark:text-white">{{ link.label }}</h3>
              <p class="text-sm text-muted-500 mt-1">{{ link.description }}</p>
            </div>
          </div>
        </NuxtLink>
      </div>
    </div>
  </UDashboardPanel>
</template>

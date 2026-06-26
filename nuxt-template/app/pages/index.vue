<script setup lang="ts">
const { user: authUser } = useAuth()
const displayName = computed(() => {
  const realname = useCookie('auth_realname').value
  return realname || authUser.value || '用户'
})
</script>

<template>
  <UDashboardPanel id="home" :ui="{ body: 'sm:gap-3 sm:p-2 m-0' }">
    <template #header>
      <!-- TODO: 修改为实际的应用名称 -->
      <UDashboardNavbar title="汇智云模块" :ui="{ right: 'gap-1' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <UColorModeButton />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UCard class="h-full">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold text-lg">欢迎，{{ displayName }}</span>
          </div>
        </template>
        <div class="text-sm p-2 space-y-3">
          <!-- TODO: 修改为实际的应用说明 -->
          <p>欢迎使用汇智云模块。这是一个基于 Nuxt 4 的模块模板，已集成以下基础功能：</p>
          <ul class="list-disc pl-5 space-y-1">
            <li>Console OIDC 统一认证</li>
            <li>RBAC 权限管理（对接 Console 运行时能力）</li>
            <li>MySQL 数据库连接池</li>
            <li>Console Directory 目录数据</li>
            <li>Workflow 审批代理</li>
            <li>Nuxt UI V4 组件库</li>
          </ul>
        </div>
      </UCard>
    </template>
  </UDashboardPanel>
</template>

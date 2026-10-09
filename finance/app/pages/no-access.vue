<script setup lang="ts">
usePageTitle('汇智云财务 · 访问受限')

const { loadPermissions, hasPermission, clearCache } = usePermissions()

watch(
  () => hasPermission('dashboard', 'view'),
  (allowed) => {
    if (allowed) void navigateTo('/')
  },
  { immediate: true }
)

async function retryAccess() {
  clearCache()
  await loadPermissions()
  if (hasPermission('dashboard', 'view')) {
    await navigateTo('/')
  }
}
</script>

<template>
  <UDashboardPanel
    id="finance-no-access"
    grow
  >
    <template #body>
      <div class="flex min-h-[50vh] items-center justify-center p-4">
        <UAlert
          class="max-w-2xl"
          color="warning"
          variant="soft"
          icon="i-lucide-shield-alert"
          title="当前企业角色没有财务权限"
          description="请切换到系统管理员、财务管理员或会计等已分配财务权限的企业角色；如果角色已配置，请刷新授权后重试。"
          :actions="[{
            label: '重新检查',
            icon: 'i-lucide-refresh-cw',
            color: 'warning',
            variant: 'solid',
            onClick: retryAccess
          }]"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>

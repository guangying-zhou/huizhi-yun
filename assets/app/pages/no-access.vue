<script setup lang="ts">
import { resolveAssetsLandingRoute } from '~/config/permissions'

usePageTitle('资产访问受限')

const { loadPermissions, hasPermission, clearCache } = usePermissions()

async function retryAccess() {
  clearCache()
  await loadPermissions()
  const landingRoute = resolveAssetsLandingRoute(hasPermission)
  if (landingRoute) {
    await navigateTo(landingRoute)
  }
}
</script>

<template>
  <UDashboardPanel
    id="assets-no-access"
    grow
  >
    <template #body>
      <div class="flex min-h-[50vh] items-center justify-center p-4">
        <UAlert
          class="max-w-2xl"
          color="warning"
          variant="soft"
          icon="i-lucide-shield-alert"
          title="当前企业角色没有资产管理权限"
          description="请切换到系统管理员、资产管理员或资产使用人等已分配资产管理权限的企业角色；如果角色已配置，请刷新授权后重试。"
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

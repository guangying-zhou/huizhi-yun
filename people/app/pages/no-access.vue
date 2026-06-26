<script setup lang="ts">
const { ensurePeoplePermission } = usePeopleAuthorization()

async function retryAccess() {
  const result = await ensurePeoplePermission('dashboard', 'view')
  if (result.authorized) {
    await navigateTo('/')
  }
}
</script>

<template>
  <UDashboardPanel
    id="people-no-access"
    grow
  >
    <template #body>
      <Teleport to="#people-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          People 访问受限
        </h1>
      </Teleport>

      <div class="flex min-h-[50vh] items-center justify-center p-4">
        <UAlert
          class="max-w-2xl"
          color="warning"
          variant="soft"
          icon="i-lucide-shield-alert"
          title="当前企业角色没有 People 权限"
          description="请切换到系统管理员、人力资源总监或人事专员等已分配 People 权限的企业角色；如果角色已配置，请刷新授权后重试。"
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

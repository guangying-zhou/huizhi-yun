<script setup lang="ts">
definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '通知中心',
  layoutHeaderProjectSwitcher: false
})
</script>

<template>
  <UDashboardPanel id="notifications">
    <template #body>
      <div class="p-4">
        <div class="text-center py-20 text-muted">
          <UIcon name="i-lucide-bell" class="w-16 h-16 mx-auto mb-4" />
          <h2 class="text-lg font-semibold mb-2">
            通知中心
          </h2>
          <p class="text-sm">
            暂无新通知
          </p>
          <p class="text-xs mt-2">
            任务指派、状态变更、截止提醒将在这里显示
          </p>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>

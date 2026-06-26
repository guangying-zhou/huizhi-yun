<script setup lang="ts">
definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '报表统计',
  layoutHeaderProjectSwitcher: false
})
</script>

<template>
  <UDashboardPanel id="reports">
    <template #body>
      <div class="p-4">
        <div class="text-center py-20 text-muted">
          <UIcon name="i-lucide-bar-chart-3" class="w-16 h-16 mx-auto mb-4" />
          <h2 class="text-lg font-semibold mb-2">
            报表统计
          </h2>
          <p class="text-sm">
            即将上线，敬请期待
          </p>
          <p class="text-xs mt-2">
            将包含：迭代燃尽图、缺陷趋势、工时统计、项目进度等
          </p>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>

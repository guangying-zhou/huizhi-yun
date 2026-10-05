<script setup lang="ts">
definePageMeta({
  layout: 'default'
})

usePageTitle('系统日志')
</script>

<template>
  <UDashboardPanel grow>
    <div class="p-4">
      <UAlert
        title="功能开发中"
        description="系统日志功能即将上线"
        color="primary"
        variant="subtle"
        icon="i-lucide-information-circle-20-solid"
      />
    </div>
  </UDashboardPanel>
</template>

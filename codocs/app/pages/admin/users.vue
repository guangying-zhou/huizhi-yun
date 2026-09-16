<script setup lang="ts">
definePageMeta({
  layout: 'default'
})

usePageTitle('用户管理')
</script>

<template>
  <UDashboardPanel grow>
    <div class="p-4">
      <UAlert
        title="功能开发中"
        description="用户管理功能即将上线"
        color="primary"
        variant="subtle"
        icon="i-lucide-information-circle-20-solid"
      />
    </div>
  </UDashboardPanel>
</template>

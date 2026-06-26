<script setup lang="ts">
const { isNotificationsSlideoverOpen } = useDashboard()
</script>

<template>
  <USlideover v-model:open="isNotificationsSlideoverOpen" title="通知">
    <template #body>
      <div class="text-sm text-muted p-4 text-center">
        暂无通知
      </div>
    </template>
  </USlideover>
</template>

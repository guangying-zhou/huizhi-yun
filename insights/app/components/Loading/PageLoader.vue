<template>
  <div v-show="loading" class="page-loader">
    <div class="loader-content">
      <div class="loader-spinner"></div>
      <p class="loader-text">加载中...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  loading?: boolean
}

withDefaults(defineProps<Props>(), {
  loading: false
})
</script>

<style scoped>
.page-loader {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: var(--ui-bg, #ffffff);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  transition: opacity 0.3s ease;
}

.dark .page-loader {
  background-color: var(--ui-bg, #0f0f0f);
}

.loader-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.loader-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--ui-border, #e5e7eb);
  border-top: 3px solid var(--ui-primary, #3b82f6);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.dark .loader-spinner {
  border-color: var(--ui-border, #374151);
  border-top-color: var(--ui-primary, #3b82f6);
}

.loader-text {
  color: var(--ui-text-dimmed, #6b7280);
  font-size: 0.875rem;
  font-weight: 500;
  margin: 0;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
<script setup lang="ts">
definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '追加任务',
  layoutHeaderProjectSwitcher: false
})

const route = useRoute()
const projectId = computed(() => Number(route.params.id))
const workItemId = computed(() => Number(route.params.workItemId))

onMounted(() => {
  navigateTo(`/projects/${projectId.value}/work-items/${workItemId.value}/breakdown`, { replace: true })
})
</script>

<template>
  <div class="flex items-center justify-center py-20 text-sm text-muted">
    追加任务功能已合并到任务分配页，正在跳转...
  </div>
</template>

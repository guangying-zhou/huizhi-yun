<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  description?: string
}>(), {
  description: '该项目未启用此模块。项目管理员可在设置页调整项目模块。'
})

const route = useRoute()
const projectId = computed(() => route.params.id)
</script>

<template>
  <div class="flex min-h-80 items-center justify-center">
    <CommonEmptyState
      icon="i-lucide-toggle-left"
      :title="title"
      :description="description"
    >
      <UButton
        icon="i-lucide-settings"
        label="前往设置"
        color="neutral"
        variant="soft"
        :to="`/projects/${projectId}/settings`"
      />
    </CommonEmptyState>
  </div>
</template>

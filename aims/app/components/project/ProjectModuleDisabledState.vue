<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'

withDefaults(defineProps<{
  title: string
  description?: string
}>(), {
  description: '该项目未启用此模块。项目管理员可在设置页调整项目模块。'
})

// 同一份组件供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。
const { moduleUrl, hosted } = useAimsModule()
const route = useRoute()
const projectId = computed(() => route.params.id)
// Host 未注册 /projects/:id/settings，改跳 Host 的项目编辑页；独立应用保持原设置页。
const settingsLink = computed(() => hosted
  ? moduleUrl(`/projects/${projectId.value}/edit`)
  : moduleUrl(`/projects/${projectId.value}/settings`))
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
        :to="settingsLink"
      />
    </CommonEmptyState>
  </div>
</template>

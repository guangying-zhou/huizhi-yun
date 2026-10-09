<script setup lang="ts">
import { useAimsModule } from '../../../../../../layer/useAimsModule'

// 同一份代码供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。
const { moduleUrl } = useAimsModule()
definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '追加任务',
  layoutHeaderProjectSwitcher: false
})

const route = useRoute()
const projectId = computed(() => Number(route.params.id))
const workItemId = computed(() => Number(route.params.workItemId))

onMounted(() => {
  navigateTo(moduleUrl(`/projects/${projectId.value}/work-items/${workItemId.value}/breakdown`), { replace: true })
})
</script>

<template>
  <div class="flex items-center justify-center py-20 text-sm text-muted">
    追加任务功能已合并到任务分配页，正在跳转...
  </div>
</template>

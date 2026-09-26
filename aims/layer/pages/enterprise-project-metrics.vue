<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'
const { moduleUrl } = useAimsModule()
const route = useRoute()
const projectId = computed(() => String(route.params.id || ''))
const items = [
  { icon: 'i-lucide-trending-down', title: '燃尽图' },
  { icon: 'i-lucide-gauge', title: '迭代速度' },
  { icon: 'i-lucide-bug', title: '缺陷趋势' },
  { icon: 'i-lucide-git-commit', title: '代码贡献' }
]
</script>

<template>
  <section class="space-y-6">
    <div>
      <UButton :to="moduleUrl(`/projects/${projectId}`)" variant="link" color="neutral" icon="i-lucide-arrow-left">返回项目</UButton>
      <h1 class="mt-1 text-2xl font-semibold text-highlighted">度量分析</h1>
    </div>
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <UCard v-for="item in items" :key="item.title" class="text-center">
        <UIcon :name="item.icon" class="mx-auto size-7 text-primary" />
        <p class="mt-3 font-medium">{{ item.title }}</p>
      </UCard>
    </div>
    <CommonEmptyState icon="i-lucide-chart-no-axes-combined" title="度量分析即将上线" description="目前没有可展示的度量数据。" />
  </section>
</template>

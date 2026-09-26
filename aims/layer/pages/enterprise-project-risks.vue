<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'
const { moduleUrl } = useAimsModule()
const route = useRoute()
const projectId = computed(() => String(route.params.id || ''))
const items = [
  { icon: 'i-lucide-alarm-clock', title: '逾期任务预警' },
  { icon: 'i-lucide-unplug', title: '阻塞依赖' },
  { icon: 'i-lucide-users', title: '资源冲突' }
]
</script>

<template>
  <section class="space-y-6">
    <div>
      <UButton :to="moduleUrl(`/projects/${projectId}`)" variant="link" color="neutral" icon="i-lucide-arrow-left">返回项目</UButton>
      <h1 class="mt-1 text-2xl font-semibold text-highlighted">风险管控</h1>
    </div>
    <div class="grid gap-3 sm:grid-cols-3">
      <UCard v-for="item in items" :key="item.title" class="text-center">
        <UIcon :name="item.icon" class="mx-auto size-7 text-warning" />
        <p class="mt-3 font-medium">{{ item.title }}</p>
      </UCard>
    </div>
    <CommonEmptyState icon="i-lucide-shield-alert" title="风险管控即将上线" description="目前没有可展示的风险数据。" />
  </section>
</template>

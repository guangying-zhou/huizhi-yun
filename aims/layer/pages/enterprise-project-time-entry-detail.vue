<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'

type TimeEntry = Record<string, unknown> & { id: number, entryDate?: string, hours?: number }
const route = useRoute()
const { moduleUrl } = useAimsModule()
const projectId = computed(() => String(route.params.id || ''))
const entryId = computed(() => String(route.params.entryId || ''))
const item = ref<TimeEntry | null>(null)
const loading = ref(true)
const error = ref('')

function value(...keys: string[]) {
  for (const key of keys) {
    const current = item.value?.[key]
    if (current !== undefined && current !== null && String(current).trim()) return String(current)
  }
  return '-'
}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{ code?: number, data?: TimeEntry }>(moduleUrl(`/api/v1/projects/${projectId.value}/time-entries/${entryId.value}`))
    if (response.code !== 0 || !response.data) throw Error('工时详情暂不可用')
    item.value = response.data
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '工时详情暂不可用'
  } finally {
    loading.value = false
  }
}

watch([projectId, entryId], refresh)
onMounted(refresh)
</script>

<template>
  <section class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <UButton :to="moduleUrl(`/projects/${projectId}/timesheet`)" variant="link" color="neutral" icon="i-lucide-arrow-left">返回项目工时</UButton>
        <h1 class="mt-1 text-2xl font-semibold text-highlighted">工时详情</h1>
        <p class="mt-1 text-sm text-muted">{{ value('entryDate') }}</p>
      </div>
      <UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" :loading="loading" @click="refresh">刷新</UButton>
    </div>
    <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" title="无法读取工时" :description="error" />
    <USkeleton v-else-if="loading" class="h-56 w-full" />
    <UCard v-else-if="item">
      <dl class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <div><dt class="text-sm text-muted">人员</dt><dd class="mt-1 font-medium">{{ value('uid') }}</dd></div>
        <div><dt class="text-sm text-muted">工时</dt><dd class="mt-1 font-medium">{{ value('hours') }} 小时</dd></div>
        <div><dt class="text-sm text-muted">审核状态</dt><dd class="mt-1 font-medium">{{ value('reviewStatus') }}</dd></div>
        <div><dt class="text-sm text-muted">工作项</dt><dd class="mt-1 font-medium">{{ value('itemTitle', 'itemKey') }}</dd></div>
        <div><dt class="text-sm text-muted">提交时间</dt><dd class="mt-1 font-medium">{{ value('submittedAt') }}</dd></div>
        <div><dt class="text-sm text-muted">更新时间</dt><dd class="mt-1 font-medium">{{ value('updatedAt') }}</dd></div>
      </dl>
      <p v-if="value('description') !== '-'" class="mt-6 whitespace-pre-wrap text-sm text-default">{{ value('description') }}</p>
    </UCard>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'

interface IngestionLogItem {
  id: number
  runId: number
  level: string
  message: string
  context?: unknown
  createdAt: string
}

interface IngestionLogsResponse {
  data: IngestionLogItem[]
}

const props = defineProps<{
  open: boolean
  loading: boolean
  logs: IngestionLogItem[]
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'start', fullAggregation: boolean): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: val => emit('update:open', val)
})

const toast = useToast()

const fullAggregation = ref(false)
const logsContainerRef = ref<HTMLDivElement | null>(null)

// Auto scroll to bottom when logs update
watch(
  () => props.logs,
  async () => {
    await nextTick()
    const c = logsContainerRef.value
    if (c) {
      c.scrollTop = c.scrollHeight
    }
  },
  { deep: true }
)

function startAggregation() {
  emit('start', fullAggregation.value)
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  const match = dateStr.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/
  )
  if (match) {
    return `${match[1]} ${match[2]}`
  }
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatLogContext(ctx: unknown): string {
  if (typeof ctx === 'string') return ctx
  try {
    return JSON.stringify(ctx, null, 2)
  } catch {
    return String(ctx)
  }
}

function extractProgress(logs: IngestionLogItem[]): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i]
    if (!log?.context) continue
    try {
      const ctx = log.context as Record<string, unknown>
      if (ctx.current && ctx.total) {
        const pct = Math.round((Number(ctx.current) / Number(ctx.total)) * 100)
        return `${ctx.current}/${ctx.total} (${pct}%)`
      }
    } catch {
      // ignore
    }
  }
  return null
}

const progressText = computed(() => {
  return extractProgress(props.logs) || null
})
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :ui="{ content: 'sm:max-w-5xl', footer: 'justify-end' }"
    title="统计聚合"
    description="请在版本数据入库后，触发统计数据聚合任务。关闭窗口不影响后台处理。"
  >
    <template #body>
      <div class="space-y-3">
        <!-- Options -->
        <div class="space-y-2 rounded border border-gray-200 p-3 dark:border-gray-800">
          <div class="flex items-center justify-between pt-2">
            <UCheckbox
              v-model="fullAggregation"
              label="全量重新聚合"
              :disabled="loading"
            />
            <div
              v-if="progressText"
              class="text-sm text-gray-600 dark:text-gray-400"
            >
              进度: {{ progressText }}
            </div>
          </div>
          <div class="text-xs text-gray-500">
            <template v-if="fullAggregation">
              ⚠️ 全量聚合将重新计算所有历史统计数据，耗时较长，请耐心等待。
            </template>
            <template v-else>
              默认增量聚合，只聚合最近导入的未聚合数据。
            </template>
          </div>
        </div>

        <!-- Logs Display -->
        <div
          ref="logsContainerRef"
          class="h-84 overflow-y-auto rounded border border-gray-200 bg-neutral-50 p-2 font-mono text-[12px] leading-5 dark:border-gray-800 dark:bg-neutral-900"
        >
          <div
            v-if="loading && logs.length === 0"
            class="py-10 text-center text-muted-500"
          >
            正在启动...
          </div>
          <div
            v-else-if="!loading && (!logs || logs.length === 0)"
            class="py-10 text-center text-muted-500"
          >
            暂无日志
          </div>
          <div
            v-else
            class="space-y-1"
          >
            <div
              v-for="item in logs"
              :key="item.id"
              class="px-1"
            >
              <span class="text-muted-500">{{
                formatDate(item.createdAt)
              }}</span>
              <span class="mx-1 text-muted-400">·</span>
              <UBadge
                :label="item.level.toUpperCase()"
                :color="item.level === 'ERROR'
                  ? 'error'
                  : item.level === 'WARNING'
                    ? 'warning'
                    : 'neutral'
                "
                variant="subtle"
                class="align-middle"
              />
              <span class="mx-1 text-muted-400">—</span>
              <span
                :class="item.level && item.level.toLowerCase() === 'error'
                  ? 'text-error-600 dark:text-error-400'
                  : 'text-neutral-800 dark:text-neutral-200'
                "
              >
                {{ item.message }}
              </span>
              <span
                v-if="item.context"
                class="mt-1 overflow-x-auto whitespace-nowrap p-2 font-mono text-[11px] text-neutral-800 dark:text-neutral-200"
              >
                - {{ formatLogContext(item.context) }}
              </span>
            </div>
          </div>
        </div>

        <div class="text-[11px] text-muted-500">
          日志每5秒自动刷新，任务完成后自动关闭轮询。
        </div>
      </div>
    </template>

    <template #footer>
      <UButton
        variant="subtle"
        color="neutral"
        @click="isOpen = false"
      >
        关闭窗口
      </UButton>
      <UButton
        color="primary"
        icon="i-lucide-play"
        :loading="loading"
        :disabled="loading"
        @click="startAggregation"
      >
        {{ loading ? '执行中...' : '开始聚合' }}
      </UButton>
    </template>
  </UModal>
</template>

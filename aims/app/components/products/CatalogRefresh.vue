<script setup lang="ts">
interface Batch { refresh_id: string, status: 'staging' | 'active' | 'failed' | 'superseded', row_count: number, revision: number, total: number }
const emit = defineEmits<{ activated: [] }>()
const open = ref(false)
let disposed = false
onBeforeUnmount(() => {
  disposed = true
})
const batch = ref<Batch | null>(null)
const resumeId = ref('')
const busy = ref(false)
const error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '目录刷新操作失败' })
const { confirm } = useConfirm()
let startKey: string | undefined
const labels = { staging: '待继续同步', active: '同步成功', failed: '已终止', superseded: '已被新目录替代' }
async function run(action: 'start' | 'continue' | 'status' | 'cancel') {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    if (action === 'cancel' && !(await confirm({ title: '取消目录刷新', message: '取消当前批次，已生效目录继续可用。', tone: 'warning', confirmLabel: '取消刷新' }))) return
    async function request(next: 'start' | 'continue' | 'status' | 'cancel') {
      if (next === 'start') startKey ||= crypto.randomUUID()
      const body = next === 'start'
        ? { action: next }
        : {
            action: next, refreshId: batch.value?.refresh_id || resumeId.value.trim(),
            ...(next === 'continue' ? { expectedRevision: batch.value?.revision } : {})
          }
      const response = await $fetch<{ code: number, data: Batch }>('/api/v1/products/catalog-refresh', {
        method: 'POST', body, ...(next === 'start' ? { headers: { 'Idempotency-Key': startKey! } } : {})
      })
      if (response.code !== 0 || !response.data?.refresh_id || !Number.isSafeInteger(response.data.revision)) throw new Error('同步状态响应不完整，请读取状态后重试')
      batch.value = response.data
      resumeId.value = response.data.refresh_id
      if (response.data.status === 'active') emit('activated')
      if (response.data.status !== 'staging') startKey = undefined
    }
    await request(action)
    // Bound each user action; stop on errors, no progress, or navigation. The
    // persisted batch can be resumed without creating another refresh.
    if (action === 'start' || action === 'continue') {
      for (let page = 0; page < 10 && !disposed && batch.value?.status === 'staging'; page++) {
        const revision = batch.value.revision
        await request('continue')
        if (batch.value?.status === 'staging' && batch.value.revision <= revision) throw new Error('同步进度未推进，请读取最新状态后继续')
      }
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('目录刷新失败')
  } finally {
    busy.value = false
  }
}
function newBatch() {
  error.value = null
  batch.value = null
  resumeId.value = ''
  startKey = undefined
}
</script>

<template>
  <UButton
    icon="i-lucide-refresh-cw"
    color="neutral"
    variant="outline"
    @click="open = true"
  >
    同步产品目录
  </UButton>
  <UModal
    v-model:open="open"
    title="同步产品目录"
    description="从资产管理同步产品主档；同步成功后，产品中心列表自动更新。"
    :dismissible="!busy"
    :close="!busy"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          系统会分批读取产品。大批量同步可继续处理；离开页面后可凭批次编号恢复。
        </p>
        <UAlert v-if="alert" v-bind="alert" />
        <template v-if="!batch">
          <UButton :loading="busy" @click="run('start')">
            开始同步
          </UButton>
          <div class="flex flex-wrap items-end gap-2">
            <UFormField label="已有批次编号" name="refreshId">
              <UInput v-model="resumeId" :disabled="busy" class="w-full" />
            </UFormField>
            <UButton
              color="neutral"
              variant="outline"
              :disabled="busy || !resumeId.trim()"
              @click="run('status')"
            >
              读取批次
            </UButton>
          </div>
        </template>
        <template v-else>
          <p class="break-all text-xs text-muted">
            批次：{{ batch.refresh_id }}
          </p>
          <p class="text-sm">
            {{ busy && batch.status === 'staging' ? '正在同步…' : labels[batch.status] }} · 已读取 {{ batch.row_count }} 条<span v-if="batch.total >= 0"> / 共 {{ batch.total }} 条</span>
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton v-if="batch.status === 'staging'" :loading="busy" @click="run('continue')">
              继续同步
            </UButton>
            <UButton
              color="neutral"
              variant="outline"
              :disabled="busy"
              @click="run('status')"
            >
              读取最新状态
            </UButton>
            <UButton
              v-if="batch.status === 'staging'"
              color="warning"
              variant="ghost"
              :disabled="busy"
              @click="run('cancel')"
            >
              取消刷新
            </UButton>
            <UButton
              v-else
              color="neutral"
              variant="ghost"
              :disabled="busy"
              @click="newBatch"
            >
              准备新批次
            </UButton>
          </div>
        </template>
      </div>
    </template>
  </UModal>
</template>

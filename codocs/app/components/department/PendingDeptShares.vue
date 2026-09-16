<script setup lang="ts">
import type { FetchError } from 'ofetch'

interface PendingDeptShareItem {
  id: number
  document_title: string
  mode?: 'share' | 'transfer'
  from_uid: string
  from_real_name?: string
  created_at: string
}

interface PendingDeptSharesResponse {
  data: PendingDeptShareItem[]
}

const props = defineProps<{ deptCode: string }>()
const emit = defineEmits<{ (e: 'accepted'): void }>()

const toast = useToast()
const isOpen = ref(false)
const items = ref<PendingDeptShareItem[]>([])
const loading = ref(false)
const accepting = ref<number | null>(null)

const pendingCount = computed(() => items.value.length)

const fetchPending = async () => {
  if (!props.deptCode) return
  loading.value = true
  try {
    const res = await $fetch<PendingDeptSharesResponse>('/api/dept-shares', { params: { deptCode: props.deptCode } })
    items.value = res.data || []
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

const getItemLabel = (item: PendingDeptShareItem) => {
  return item.mode === 'share' ? '共享' : '移交'
}

const handleAction = async (item: PendingDeptShareItem, action: 'accept' | 'reject') => {
  accepting.value = item.id
  try {
    await $fetch(`/api/dept-shares/${item.id}`, { method: 'PATCH', body: { action } })
    const actionLabel = getItemLabel(item)
    toast.add({ title: action === 'accept' ? `已接收${actionLabel}` : `已拒绝${actionLabel}`, color: action === 'accept' ? 'success' : 'neutral' })
    items.value = items.value.filter(i => i.id !== item.id)
    if (action === 'accept') emit('accepted')
  } catch (e: unknown) {
    const fetchErr = e as FetchError
    toast.add({ title: '操作失败', description: fetchErr.data?.message || '', color: 'error' })
  } finally { accepting.value = null }
}

if (import.meta.client) {
  watch(() => props.deptCode, (val) => {
    if (val) fetchPending()
  }, { immediate: true })
}

defineExpose({ pendingCount, refresh: fetchPending })
</script>

<template>
  <UButton
    v-if="pendingCount > 0"
    size="sm"
    icon="i-lucide-inbox"
    color="warning"
    variant="soft"
    @click="isOpen = true"
  >
    待接收 ({{ pendingCount }})
  </UButton>

  <UModal v-model:open="isOpen" title="待接收文档">
    <template #body>
      <div class="space-y-3 p-4">
        <div v-if="loading" class="text-center py-4 text-muted">
          加载中...
        </div>
        <div v-else-if="items.length === 0" class="text-center py-4 text-muted">
          暂无待接收文档
        </div>
        <div
          v-for="item in items"
          :key="item.id"
          class="flex items-center justify-between p-3 rounded-lg border border-default"
        >
          <div>
            <div class="font-medium text-sm">
              {{ item.document_title }}
            </div>
            <div class="text-xs text-muted mt-1">
              由 {{ item.from_real_name || item.from_uid }} {{ getItemLabel(item) }} · {{ new
                Date(item.created_at).toLocaleString('zh-CN') }}
            </div>
          </div>
          <div class="flex gap-2 shrink-0">
            <UButton
              size="xs"
              color="success"
              :loading="accepting === item.id"
              @click="handleAction(item, 'accept')"
            >
              接收
            </UButton>
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              :loading="accepting === item.id"
              @click="handleAction(item, 'reject')"
            >
              拒绝
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>

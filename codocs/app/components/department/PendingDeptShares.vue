<script setup lang="ts">
import type { FetchError } from 'ofetch'
import { useCodocsModule } from '../../../layer/useCodocsModule'

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
const { hosted, moduleUrl } = useCodocsModule()
const { confirm } = useConfirm()
const isOpen = ref(false)
const items = ref<PendingDeptShareItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const accepting = ref<number | null>(null)
const loadError = ref('')
const intentKeys = new Map<string, string>()

const pendingCount = computed(() => total.value)

const fetchPending = async () => {
  if (!props.deptCode) return
  loading.value = true
  loadError.value = ''
  try {
    const res = await $fetch<PendingDeptSharesResponse & { total?: number }>(moduleUrl('/api/dept-shares'), { query: hosted ? { dept_code: props.deptCode, page: page.value, pageSize } : { deptCode: props.deptCode } })
    items.value = res.data || []
    total.value = res.total ?? items.value.length
    if (hosted && total.value > 0 && items.value.length === 0 && page.value > 1) page.value--
  } catch {
    items.value = []
    total.value = 0
    loadError.value = '待接收移交暂不可用，请稍后重试'
  } finally {
    loading.value = false
  }
}

const getItemLabel = (item: PendingDeptShareItem) => {
  return item.mode === 'share' ? '共享' : '移交'
}

const handleAction = async (item: PendingDeptShareItem, action: 'accept' | 'reject') => {
  const message = action === 'accept' ? '接收后将转为部门文档，作者保持不变。确认接收？' : '确认拒绝这条部门移交？拒绝只记录状态。'
  if (!(await confirm({ title: action === 'accept' ? '接收部门移交' : '拒绝部门移交', message, tone: action === 'reject' ? 'danger' : 'default', confirmLabel: action === 'accept' ? '确认接收' : '确认拒绝' }))) return
  accepting.value = item.id
  const intent = `${props.deptCode}:${item.id}:${action}`
  if (!intentKeys.has(intent)) intentKeys.set(intent, crypto.randomUUID())
  try {
    await $fetch(moduleUrl(`/api/dept-shares/${item.id}`), { method: 'PATCH', query: hosted ? { dept_code: props.deptCode } : undefined, headers: hosted ? { 'Idempotency-Key': intentKeys.get(intent)! } : undefined, body: { action } })
    intentKeys.delete(intent)
    const actionLabel = getItemLabel(item)
    toast.add({ title: action === 'accept' ? `已接收${actionLabel}` : `已拒绝${actionLabel}`, color: action === 'accept' ? 'success' : 'neutral' })
    await fetchPending()
    if (action === 'accept') emit('accepted')
  } catch (e: unknown) {
    const fetchErr = e as FetchError
    toast.add({ title: '操作失败', description: fetchErr.data?.message || '', color: 'error' })
    if (fetchErr.statusCode === 409) await fetchPending()
  } finally { accepting.value = null }
}

if (import.meta.client) {
  watch(() => props.deptCode, (val) => {
    intentKeys.clear()
    page.value = 1
    if (val) fetchPending()
  }, { immediate: true })
  watch(page, () => { if (props.deptCode) fetchPending() })
}

defineExpose({ pendingCount, refresh: fetchPending })
</script>

<template>
  <UButton
    v-if="pendingCount > 0 || loadError"
    size="sm"
    icon="i-lucide-inbox"
    color="warning"
    variant="soft"
    @click="isOpen = true"
  >
    {{ loadError ? '待接收暂不可用' : `待接收 (${pendingCount})` }}
  </UButton>

  <UModal v-model:open="isOpen" title="待接收文档">
    <template #body>
      <div class="space-y-3 p-4">
        <div v-if="loading" class="text-center py-4 text-muted">
          加载中...
        </div>
        <div v-else-if="loadError" class="text-center py-4 text-error">
          {{ loadError }}
        </div>
        <div v-else-if="items.length === 0" class="text-center py-4 text-muted">
          暂无待接收文档
        </div>
        <UPagination v-if="hosted && total > pageSize" v-model:page="page" :total="total" :items-per-page="pageSize" size="sm" />
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

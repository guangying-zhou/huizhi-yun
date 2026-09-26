<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'

const { moduleUrl, hosted, cacheKey } = useAimsModule()
const props = defineProps<{ productCode: string, componentId: number, name: string, parentId: number | null, componentRevision: number, workspaceRevision: number }>()
const emit = defineEmits<{ saved: [], cancel: [], busy: [boolean] }>()
interface Target { id: number, name: string, product_code: string, parent_id: number | null }
const trail = ref<{ id: number, name: string }[]>([])
const parent = computed(() => trail.value.at(-1)?.id ?? null)
const page = ref(1), pageSize = 10, saving = ref(false), reason = ref('')
const selection = ref<{ id: number | null, name: string } | null>(null)
const base = computed(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/components`))
const query = computed(() => ({ parentId: parent.value ?? undefined, page: page.value, pageSize }))
const { data, status, error, refresh } = await useFetch(base, { ...(hosted ? { key: computed(() => cacheKey('ComponentMoveForm:1' + ':' + String(props.productCode))) } : {}), server: false, query, transform: (r: { code: number, data: { items: Target[], total: number, parent_id: number | null, page: number, pageSize: number, workspace_revision: number } }) => {
  const v = r.data
  if (r.code !== 0 || !v || !Array.isArray(v.items) || v.parent_id !== parent.value || v.page !== page.value || v.pageSize !== pageSize || !Number.isSafeInteger(v.total) || v.total < 0 || v.items.length > pageSize || v.items.length > v.total || v.workspace_revision !== props.workspaceRevision || v.items.some(item => !item || !Number.isSafeInteger(item.id) || item.id < 1 || item.product_code !== props.productCode || item.parent_id !== parent.value || typeof item.name !== 'string' || !item.name.trim())) throw new Error('目标列表已变化或响应不完整，请关闭表单并刷新模块列表')
  return v
} })
const alert = useApiErrorAlert(error, { fallbackTitle: '目标模块加载失败' })
const saveError = ref<Error | null>(null)
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '模块移动失败' })
const { confirm } = useConfirm()
let retry: { payload: string, key: string } | undefined
function enter(item: Target) {
  if (saving.value || status.value !== 'success' || item.id === props.componentId || trail.value.length >= 1) return
  page.value = 1
  trail.value = [...trail.value, { id: item.id, name: item.name }]
}
function root() {
  if (saving.value) return
  trail.value = []
  page.value = 1
}
function choose(id: number | null, name: string) {
  if (saving.value || status.value !== 'success' || id === props.componentId || id === props.parentId) return
  selection.value = { id, name }
}
async function save() {
  if (saving.value || status.value !== 'success' || !selection.value || !reason.value.trim()) return
  const selected = { ...selection.value }
  const body = { parentId: selected.id, expectedRevision: props.workspaceRevision, expectedComponentRevision: props.componentRevision, reason: reason.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  saving.value = true
  emit('busy', true)
  saveError.value = null
  let done = false
  try {
    if (!await confirm({ title: '移动产品模块', message: `模块：${props.name}\n目标：${selected.name}\n原因：${body.reason}\n子模块将随其移动，功能归属保持不变；整个子树仍须满足三级限制。`, confirmLabel: '确认移动', tone: 'warning' })) return
    const r = await $fetch<{ code: number, data: { value: { id: number, product_code: string, parent_id: number | null, revision: number } } }>(`${base.value}/${props.componentId}/move`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const v = r.data?.value
    if (r.code !== 0 || v?.id !== props.componentId || v.product_code !== props.productCode || v.parent_id !== selected.id || v.revision !== props.componentRevision + 1) throw new Error('移动结果不完整，请使用原请求重试')
    done = true
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('移动失败')
  } finally {
    saving.value = false
    emit('busy', false)
    if (done) emit('saved')
  }
}
</script>

<template>
  <form class="min-w-0 space-y-4" @submit.prevent="save">
    <p class="break-all text-sm">
      移动模块：{{ name }}
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="saveAlert" v-bind="saveAlert" />
    <div class="flex flex-wrap gap-2">
      <UButton
        color="neutral"
        variant="outline"
        :disabled="saving || !trail.length"
        @click="root"
      >
        返回根层
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="saving || parentId === null || status !== 'success'"
        @click="choose(null, '全部模块（根层）')"
      >
        移到根层
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="saving"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新目标
      </UButton>
    </div>
    <p class="break-all text-sm text-muted">
      浏览位置：{{ trail.at(-1)?.name || '根层' }}
    </p>
    <p v-if="status === 'pending'" role="status">
      正在加载目标模块…
    </p>
    <template v-if="status === 'success' && data">
      <CommonEmptyState
        v-if="!data.items.length"
        icon="i-lucide-folder-tree"
        title="本层暂无目标模块"
        description="返回根层选择其他位置。"
      />
      <div v-for="item in data.items" :key="item.id" class="flex min-w-0 flex-wrap items-center gap-2 rounded border border-default p-3">
        <span class="min-w-0 flex-1 break-all">{{ item.name }}</span>
        <span v-if="item.id === componentId" class="text-sm text-muted">当前模块，不可选择</span>
        <template v-else>
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="saving || item.id === parentId"
            @click="choose(item.id, item.name)"
          >
            选为父模块
          </UButton>
          <UButton
            v-if="!trail.length"
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="saving"
            @click="enter(item)"
          >
            查看下级
          </UButton>
        </template>
      </div>
      <p class="text-sm text-muted">
        本层共 {{ data.total }} 个模块
      </p>
      <UPagination
        v-if="data.total > pageSize"
        v-model:page="page"
        :total="data.total"
        :items-per-page="pageSize"
        :sibling-count="0"
        :disabled="saving"
      />
    </template>
    <p class="break-all text-sm">
      目标：{{ selection?.name || '尚未选择' }}
    </p>
    <UFormField label="移动原因" required>
      <UTextarea
        v-model="reason"
        required
        :maxlength="2000"
        :disabled="saving"
        class="w-full"
      />
    </UFormField>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton
        color="neutral"
        variant="outline"
        :disabled="saving"
        @click="emit('cancel')"
      >
        取消
      </UButton>
      <UButton type="submit" :loading="saving" :disabled="!selection || !reason.trim() || status !== 'success'">
        移动模块
      </UButton>
    </div>
  </form>
</template>

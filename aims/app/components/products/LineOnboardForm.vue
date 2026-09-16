<script setup lang="ts">
import type { ProductLineGroup, ProductTreeItem, ProductTreePage } from '~/types/productTree'

const emit = defineEmits<{ onboarded: [] }>()
interface PreviewItem { product_code: string, product_name: string, onboardable: boolean }
interface Preview { line_code: string, label: string, watermark: string, items: PreviewItem[] }
const selected = ref<ProductLineGroup | null>(null)
const open = ref(false), busy = ref(false), loading = ref(false)
const preview = ref<Preview | null>(null), error = ref<Error | null>(null)
const manager = ref<string[]>([]), picked = ref<string[]>([])
// 已单独启用管理的产品不能并入统一空间，运行服务也会再次拒绝。
const managed = ref<Set<string>>(new Set())
const alert = useApiErrorAlert(error, { fallbackTitle: '启用统一产品管理失败' })
const toast = useToast()
let retry: { payload: string, key: string } | undefined
let generation = 0
async function selectLine(line: ProductLineGroup) {
  if (busy.value) return
  selected.value = line
  open.value = true
  preview.value = null
  manager.value = []
  picked.value = []
  managed.value = new Set()
  retry = undefined
  await loadPreview()
}
async function loadManagedCodes(line: string) {
  const codes = new Set<string>()
  for (let page = 1; page <= 20; page++) {
    const response = await $fetch<{ code: number, data: ProductTreePage }>('/api/v1/products', {
      query: { tree: 'true', childLine: line, page: String(page), pageSize: '100' }
    })
    const items: ProductTreeItem[] = response?.code === 0 && Array.isArray(response.data?.items) ? response.data.items : []
    for (const item of items) {
      if (item.status !== 'not_enabled' || item.component_id) codes.add(item.product_code)
    }
    if (!items.length || !Number.isSafeInteger(response.data.total) || page * 100 >= response.data.total) break
  }
  return codes
}
async function loadPreview() {
  if (!selected.value || busy.value) return
  const current = ++generation
  const line = selected.value.line_code
  loading.value = true
  error.value = null
  try {
    const [response, managedCodes] = await Promise.all([
      $fetch<{ code: number, data: Preview }>('/api/v1/product-candidates', { query: { mode: 'line', productLine: line } }),
      loadManagedCodes(line)
    ])
    if (current !== generation) return
    if (response.code !== 0 || response.data?.line_code !== line || !Array.isArray(response.data.items) || !response.data.items.length || !response.data.watermark) throw new Error('产品线预览响应不完整')
    preview.value = response.data
    managed.value = managedCodes
    picked.value = response.data.items.filter(i => i.onboardable && !managedCodes.has(i.product_code)).map(i => i.product_code)
  } catch (cause) {
    if (current === generation) error.value = cause instanceof Error ? cause : new Error('预览加载失败')
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(open, (value) => {
  if (!value) {
    generation++
    loading.value = false
  }
})
function selectable(item: PreviewItem) {
  return item.onboardable && !managed.value.has(item.product_code)
}
function toggle(item: PreviewItem, checked: boolean) {
  if (!selectable(item)) return
  const rest = picked.value.filter(code => code !== item.product_code)
  picked.value = checked ? [...rest, item.product_code] : rest
}
const selectableItems = computed(() => preview.value?.items.filter(selectable) || [])
function pickAll() {
  picked.value = selectableItems.value.map(i => i.product_code)
}
function pickNone() {
  picked.value = []
}
const canSubmit = computed(() => !!preview.value && picked.value.length > 0 && manager.value.length === 1 && !loading.value && !busy.value)
async function save() {
  if (!canSubmit.value || !preview.value) return
  const body = {
    productLine: preview.value.line_code,
    managerUid: manager.value[0],
    productCodes: [...picked.value].sort(),
    expectedWatermark: preview.value.watermark
  }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  error.value = null
  try {
    const response = await $fetch<{ code: number }>('/api/v1/products', { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0) throw new Error('启用结果不完整，请重试')
    open.value = false
    toast.add({ title: '产品线已启用统一产品管理', color: 'success' })
    emit('onboarded')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('统一启用失败')
  } finally { busy.value = false }
}
defineExpose({ selectLine })
</script>

<template>
  <UModal
    v-model:open="open"
    title="启用统一产品管理"
    description="以产品线作为一个整体产品开展需求、规划和版本管理，所选产品将作为功能模块纳入。"
    :dismissible="!busy"
    :close="!busy"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <p class="break-words font-medium">
          {{ selected?.label }} · {{ selected?.line_code }}
        </p>
        <UAlert v-if="alert" v-bind="alert" />
        <p v-if="loading" role="status" class="text-sm text-muted">
          正在核对整条产品线的产品…
        </p>
        <UButton
          v-if="error && !preview"
          color="neutral"
          variant="outline"
          @click="loadPreview()"
        >
          重新读取
        </UButton>
        <template v-if="preview">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm">
              选择纳入统一管理的产品（已选 {{ picked.length }} / 可选 {{ selectableItems.length }}）
            </p>
            <div class="flex gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                :disabled="busy || !selectableItems.length"
                @click="pickAll"
              >
                全选
              </UButton>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                :disabled="busy || !picked.length"
                @click="pickNone"
              >
                清空
              </UButton>
            </div>
          </div>
          <ul class="max-h-64 divide-y divide-default overflow-y-auto rounded-lg border border-default px-3">
            <li v-for="item in preview.items" :key="item.product_code" class="py-2 text-sm break-words">
              <UCheckbox
                :model-value="picked.includes(item.product_code)"
                :disabled="busy || !selectable(item)"
                :label="item.product_name"
                :description="item.product_code"
                @update:model-value="toggle(item, $event === true)"
              />
              <span v-if="!item.onboardable" class="mt-1 block pl-6 text-xs text-error">当前生命周期不允许接入</span>
              <span v-else-if="managed.has(item.product_code)" class="mt-1 block pl-6 text-xs text-muted">已单独启用产品管理，保持独立空间</span>
            </li>
          </ul>
          <p class="text-xs text-muted">
            纳入的产品共享一个产品经理和管理空间，之后不能再单独启用产品管理；未纳入的产品保持现状。产品主档仍在资产管理中维护。
          </p>
          <UFormField label="初始产品经理" required>
            <UserTreeSelector
              v-model="manager"
              selection-mode="single"
              :disabled="busy"
              width-class="w-full"
            />
          </UFormField>
        </template>
        <div class="flex flex-wrap gap-2">
          <UButton type="submit" :loading="busy" :disabled="!canSubmit">
            确认启用统一管理
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="busy"
            @click="open = false"
          >
            取消
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>

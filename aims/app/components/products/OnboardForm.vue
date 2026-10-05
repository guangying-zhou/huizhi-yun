<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'
const { moduleUrl } = useAimsModule()
interface Candidate { product_code: string, product_name: string, product_line_label: string | null, onboardable: boolean, source_status: string }
interface Catalog { items: Candidate[], total: number, watermark: string, nextPage: number | null }
defineProps<{ hideTrigger?: boolean }>()
const directSelection = ref(false)
const emit = defineEmits<{ onboarded: [] }>()
const open = ref(false)
const search = ref('')
const catalog = ref<Catalog | null>(null)
const selected = ref<Pick<Candidate, 'product_code' | 'product_name'> | null>(null)
const page = ref(1)
const manager = ref<string[]>([])
const reason = ref('')
const busy = ref(false)
const error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '产品接入操作失败' })
const toast = useToast()
let submittedSearch = ''
let key: { payload: string, value: string } | undefined
function selectProduct(product: { product_code: string, product_name: string | null }) {
  if (busy.value) return
  selected.value = { product_code: product.product_code, product_name: product.product_name || product.product_code }
  directSelection.value = true
  manager.value = []
  reason.value = ''
  error.value = null
  key = undefined
  open.value = true
}
defineExpose({ selectProduct })
async function searchProducts(next = 1, fresh = false) {
  if (busy.value) return
  busy.value = true
  error.value = null
  if (fresh) submittedSearch = search.value.trim()
  const watermark = fresh ? undefined : catalog.value?.watermark
  try {
    const response = await $fetch<{ code: number, data: Catalog }>(moduleUrl('/api/v1/product-candidates'), {
      query: { keyword: submittedSearch || undefined, page: next, pageSize: 20, watermark }
    })
    if (response.code !== 0 || !Array.isArray(response.data?.items)) throw new Error('产品候选响应不完整')
    catalog.value = response.data
    page.value = next
  } catch (cause) {
    catalog.value = null
    error.value = cause instanceof Error ? cause : new Error('产品候选加载失败')
  } finally {
    busy.value = false
  }
}
async function onboard() {
  if (busy.value || !selected.value || !manager.value[0] || !reason.value.trim()) return
  busy.value = true
  error.value = null
  const body = { productCode: selected.value.product_code, managerUid: manager.value[0], reason: reason.value.trim() }
  const payload = JSON.stringify(body)
  if (key?.payload !== payload) key = { payload, value: crypto.randomUUID() }
  try {
    const response = await $fetch<{ code: number }>(moduleUrl('/api/v1/products'), { method: 'POST', body, headers: { 'Idempotency-Key': key.value } })
    if (response.code !== 0) throw new Error('接入结果不完整，请重试')
    toast.add({ title: '产品管理已启用', color: 'success' })
    open.value = false
    selected.value = null
    manager.value = []
    reason.value = ''
    key = undefined
    emit('onboarded')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('接入失败，请重试')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UButton v-if="!hideTrigger" icon="i-lucide-package-plus" @click="directSelection = false; open = true">
    启用产品管理
  </UButton>
  <UModal
    v-model:open="open"
    title="启用产品管理"
    description="指定初始产品经理，启用后可开展规划、需求和版本管理。产品主档仍在资产管理中维护。"
    :dismissible="!busy"
    :close="!busy"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert v-if="alert" v-bind="alert" />
        <form v-if="!directSelection" class="flex flex-wrap items-end gap-2" @submit.prevent="searchProducts(1, true)">
          <UFormField label="搜索 Assets 产品" name="candidateSearch" class="min-w-0 flex-1">
            <UInput
              v-model="search"
              :disabled="busy"
              :maxlength="200"
              class="w-full"
            />
          </UFormField>
          <UButton type="submit" :loading="busy">
            搜索产品
          </UButton>
        </form>
        <div v-if="!directSelection && catalog && !busy" class="space-y-2">
          <p class="text-xs text-muted">
            共 {{ catalog.total }} 个候选 · 第 {{ page }} 页
          </p>
          <ul class="divide-y divide-default">
            <li v-for="item in catalog.items" :key="item.product_code" class="flex items-center justify-between gap-3 py-2">
              <div class="min-w-0 break-words text-sm">
                <p>{{ item.product_name }}</p><p class="text-xs text-muted">
                  {{ item.product_code }} · {{ item.product_line_label || '未分类' }}
                </p>
              </div>
              <UButton
                :disabled="!item.onboardable"
                color="neutral"
                variant="outline"
                @click="selected = item"
              >
                {{ !item.onboardable ? '状态不允许接入' : selected?.product_code === item.product_code ? '已选择' : '选择' }}
              </UButton>
            </li>
          </ul>
          <CommonEmptyState v-if="!catalog.items.length" title="没有符合条件的产品" icon="i-lucide-package-search" />
          <div class="flex gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="page <= 1"
              @click="searchProducts(page - 1)"
            >
              上一页
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="catalog.nextPage === null"
              @click="searchProducts(catalog.nextPage!)"
            >
              下一页
            </UButton>
          </div>
        </div>
        <form v-if="selected" class="space-y-3" @submit.prevent="onboard">
          <p class="break-words text-sm font-medium">
            产品：{{ selected.product_name }}（{{ selected.product_code }}）
          </p>
          <UFormField label="初始产品经理" required>
            <UserTreeSelector
              v-model="manager"
              selection-mode="single"
              :disabled="busy"
              width-class="w-full"
            />
          </UFormField>
          <UFormField label="启用原因" required>
            <UTextarea
              v-model="reason"
              :disabled="busy"
              :maxlength="2000"
              required
              class="w-full"
            />
          </UFormField>
          <UButton type="submit" :loading="busy" :disabled="!manager.length || !reason.trim()">
            确认启用
          </UButton>
        </form>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="busy"
          @click="open = false"
        >
          取消
        </UButton>
      </div>
    </template>
  </UModal>
</template>

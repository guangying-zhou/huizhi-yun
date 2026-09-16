<script setup lang="ts">
import { objectivePositive as positive } from '~/utils/productObjectiveView'

const props = defineProps<{ productCode: string, itemId: string, workspaceRevision: number, itemRevision: number }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
interface Product { product_code: string, product_name: string | null, status: string }
interface Item { biz_id: string, product_code: string, title: string, lifecycle: string, revision: number }
const products = ref<Product[]>([]), items = ref<Item[]>([]), product = ref<Product | null>(null), selected = ref<Item | null>(null)
const keyword = ref(''), page = ref(1), total = ref(0), targetRevision = ref(0), loading = ref(false), saving = ref(false)
const reason = ref(''), impact = ref(''), error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '新增依赖失败' })
const { confirm } = useConfirm()
let retry: { payload: string, key: string } | undefined
const states: Record<string, string> = { proposed: '待规划', in_delivery: '交付中', delivered: '已交付', cancelled: '已取消', merged: '已合并' }
async function search(reset = false) {
  if (loading.value || saving.value) return
  if (reset) page.value = 1
  loading.value = true
  selected.value = null
  error.value = null
  products.value = []
  items.value = []
  total.value = 0
  const target = product.value?.product_code
  try {
    const response = await $fetch<{ code: number, data: { items: (Product | Item)[], total: number, page: number, pageSize: number, workspace_revision?: number } }>(target ? `/api/v1/products/${encodeURIComponent(target)}/planning-items` : '/api/v1/products', { query: { keyword: keyword.value, page: page.value, pageSize: 20, ...(target ? {} : { status: 'active' }) } })
    const value = response.data
    if (response.code !== 0 || !value || !Array.isArray(value.items) || value.page !== page.value || value.pageSize !== 20 || !Number.isSafeInteger(value.total) || value.total < 0 || value.items.length > 20 || value.items.length > value.total) throw new Error('选择列表响应不完整')
    if (target) {
      if (typeof value.workspace_revision !== 'number' || !positive(value.workspace_revision) || value.items.some(item => !('biz_id' in item) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.biz_id) || item.product_code !== target || typeof item.title !== 'string' || !positive(item.revision) || !Object.hasOwn(states, item.lifecycle))) throw new Error('前置事项响应不完整')
      items.value = value.items as Item[]
      targetRevision.value = value.workspace_revision!
    } else {
      if (value.items.some(item => typeof item.product_code !== 'string' || !item.product_code.trim() || !('status' in item) || item.status !== 'active' || !(item.product_name === null || typeof item.product_name === 'string'))) throw new Error('产品列表响应不完整')
      products.value = value.items as Product[]
    }
    total.value = value.total
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('查询失败')
  } finally {
    loading.value = false
  }
}
async function chooseProduct(value: Product | null) {
  product.value = value
  keyword.value = ''
  await search(true)
}
async function turn(delta: number) {
  page.value += delta
  await search()
}
async function save() {
  if (!selected.value || !product.value || loading.value || saving.value || !reason.value.trim()) return
  const current = { ...selected.value }
  const body = { predecessorProductCode: current.product_code, predecessorId: current.biz_id, expectedRevision: props.workspaceRevision, expectedItemRevision: props.itemRevision, expectedPredecessorProductRevision: targetRevision.value, expectedPredecessorRevision: current.revision, reason: reason.value, impactNote: impact.value }
  const url = `/api/v1/products/${encodeURIComponent(props.productCode)}/cross-dependencies/items/${encodeURIComponent(props.itemId)}`
  const payload = JSON.stringify({ url, body })
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  saving.value = true
  error.value = null
  try {
    if (!await confirm({ title: '新增跨产品依赖', message: `前置事项：${current.title}（${current.product_code}）\n原因：${body.reason}\n影响说明：${body.impactNote || '未填写'}\n本事项范围将发生变化，需要重新核对规划决定。`, tone: 'warning', confirmLabel: '新增依赖' })) return
    const response = await $fetch<{ code: number, data: { value: { biz_id: string, product_code: string, item_biz_id: string, predecessor_product_code: string, predecessor_biz_id: string, revision: number, item_revision: number, workspace_revision: number } } }>(url, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    if (response.code !== 0 || !result || !result.biz_id || result.product_code !== props.productCode || result.item_biz_id !== props.itemId || result.predecessor_product_code !== current.product_code || result.predecessor_biz_id !== current.biz_id || result.revision !== 1 || result.item_revision !== props.itemRevision + 1 || result.workspace_revision !== props.workspaceRevision + 1) throw new Error('新增回执不完整，请重试')
    retry = undefined
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('新增失败，请重试')
  } finally {
    saving.value = false
  }
}
onMounted(() => search())
onBeforeRouteLeave(() => !saving.value && !loading.value)
onBeforeRouteUpdate(() => !saving.value && !loading.value)
</script>

<template>
  <UCard>
    <h2 class="mb-3 font-semibold">
      新增跨产品依赖
    </h2>
    <UAlert v-if="alert" v-bind="alert" class="mb-3" />
    <div class="space-y-3">
      <p v-if="product">
        前置产品：{{ product.product_name || product.product_code }}
      </p>
      <UButton
        v-if="product"
        color="neutral"
        variant="outline"
        :disabled="loading || saving"
        @click="chooseProduct(null)"
      >
        重新选择产品
      </UButton>
      <form class="flex flex-wrap gap-2" @submit.prevent="search(true)">
        <UInput
          v-model="keyword"
          :aria-label="product ? '搜索前置事项' : '搜索产品'"
          :placeholder="product ? '搜索前置事项' : '搜索产品'"
          :maxlength="200"
          :disabled="loading || saving"
        />
        <UButton type="submit" :loading="loading" :disabled="saving">
          搜索
        </UButton>
      </form>
      <p v-if="loading" role="status">
        正在加载…
      </p>
      <template v-else-if="!error">
        <ul v-if="!product" class="space-y-2">
          <li v-for="row in products" :key="row.product_code">
            <UButton
              color="neutral"
              variant="outline"
              :disabled="saving || row.product_code === productCode"
              @click="chooseProduct(row)"
            >
              {{ row.product_name || row.product_code }} · {{ row.product_code }}
            </UButton>
          </li>
        </ul>
        <ul v-else class="space-y-2">
          <li v-for="row in items" :key="row.biz_id">
            <UButton
              :color="selected?.biz_id === row.biz_id ? 'primary' : 'neutral'"
              variant="outline"
              :disabled="saving || ['cancelled', 'merged'].includes(row.lifecycle)"
              @click="selected = { ...row }"
            >
              {{ row.title }} · {{ states[row.lifecycle] }}
            </UButton>
          </li>
        </ul>
        <p v-if="!products.length && !items.length">
          当前页没有可选记录。
        </p>
        <div class="flex gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="saving || page <= 1"
            @click="turn(-1)"
          >
            上一页
          </UButton>
          <span>第 {{ page }} 页</span>
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="saving || page * 20 >= total"
            @click="turn(1)"
          >
            下一页
          </UButton>
        </div>
      </template>
      <p v-if="selected">
        已选择：{{ selected.title }}
      </p>
      <UFormField label="依赖原因" required>
        <UTextarea
          v-model="reason"
          class="w-full"
          :maxlength="2000"
          :disabled="saving"
        />
      </UFormField>
      <UFormField label="影响说明" description="已选入周期或正在交付的事项必须填写。">
        <UTextarea
          v-model="impact"
          class="w-full"
          :maxlength="2000"
          :disabled="saving"
        />
      </UFormField>
      <div class="flex gap-2">
        <UButton :disabled="!selected || !reason.trim() || loading" :loading="saving" @click="save">
          确认新增
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="loading || saving"
          @click="emit('cancel')"
        >
          取消新增
        </UButton>
      </div>
    </div>
  </UCard>
</template>

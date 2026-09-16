<script setup lang="ts">
import { objectivePositive as positive } from '~/utils/productObjectiveView'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '跨产品依赖', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.itemId || ''))
const page = ref(1), pageSize = 20
const creating = ref(false)
const lifecycle: Record<string, string> = { proposed: '待安排', in_delivery: '交付中', delivered: '已交付', cancelled: '已取消', merged: '已合并' }
interface Dependency { biz_id: string, product_code: string, item_biz_id: string, predecessor_product_code: string, predecessor_biz_id: string, predecessor_title: string, predecessor_lifecycle: string, reason: string, revision: number, item_revision: number, workspace_revision: number, predecessor_revision: number, predecessor_product_revision: number }
interface DependencyPage { items: Dependency[], total: number, page: number, pageSize: number, item_biz_id: string, workspace_revision: number, item_revision: number }
watch([code, id], () => {
  page.value = 1
  creating.value = false
})
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/cross-dependencies/items/${encodeURIComponent(id.value)}`, {
  server: false, query: computed(() => ({ page: page.value, pageSize })),
  transform: (response: { code: number, data: DependencyPage }) => {
    const value = response.data
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    if (response.code !== 0 || !value || value.item_biz_id !== id.value || value.page !== page.value || value.pageSize !== pageSize || !positive(value.workspace_revision) || !positive(value.item_revision) || !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.items) || value.items.length > pageSize || value.items.length > value.total || new Set(value.items.map(item => item?.biz_id)).size !== value.items.length || value.items.some(item => !item || !uuid.test(item.biz_id) || item.product_code !== code.value || item.item_biz_id !== id.value || typeof item.predecessor_product_code !== 'string' || !item.predecessor_product_code.trim() || item.predecessor_product_code === code.value || !uuid.test(item.predecessor_biz_id) || typeof item.predecessor_title !== 'string' || typeof item.predecessor_lifecycle !== 'string' || typeof item.reason !== 'string' || !positive(item.revision) || item.item_revision !== value.item_revision || item.workspace_revision !== value.workspace_revision || !positive(item.predecessor_revision) || !positive(item.predecessor_product_revision))) throw new Error('依赖列表响应不完整')
    return value
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '跨产品依赖加载失败' })
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, revision: number, edit: boolean } }>(() => `/api/v1/products/${encodeURIComponent(code.value)}/cross-dependencies/permissions`, { server: false })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '依赖操作权限加载失败' })
const selected = ref<Dependency | null>(null), reason = ref(''), impact = ref(''), saving = ref(false), reloading = ref(false), saveError = ref<Error | null>(null)
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '移除依赖失败' })
const canEdit = computed(() => status.value === 'success' && data.value && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.revision === data.value.workspace_revision && permission.value.data.edit === true)
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
function cancel() {
  if (saving.value) return
  selected.value = null
  reason.value = ''
  impact.value = ''
  saveError.value = null
  retry = undefined
}
watch([code, id], cancel)
async function reload() {
  if (saving.value || reloading.value || selected.value || creating.value) return
  reloading.value = true
  try {
    await Promise.all([refresh(), refreshPermission()])
  } finally {
    reloading.value = false
  }
}
async function remove() {
  if (!selected.value || !canEdit.value || saving.value || reloading.value || !reason.value.trim()) return
  const current = { ...selected.value }
  const body = { predecessorProductCode: current.predecessor_product_code, predecessorId: current.predecessor_biz_id, expectedRevision: current.workspace_revision, expectedItemRevision: current.item_revision, expectedPredecessorProductRevision: current.predecessor_product_revision, expectedPredecessorRevision: current.predecessor_revision, expectedDependencyRevision: current.revision, reason: reason.value, impactNote: impact.value }
  const url = `/api/v1/products/${encodeURIComponent(code.value)}/cross-dependencies/items/${encodeURIComponent(id.value)}/${encodeURIComponent(current.biz_id)}/remove`
  const payload = JSON.stringify({ url, body })
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  saving.value = true
  saveError.value = null
  try {
    if (!await confirm({ title: '移除跨产品依赖', message: `前置事项：${current.predecessor_title}（${current.predecessor_product_code}）\n原因：${body.reason}\n影响说明：${body.impactNote || '未填写'}\n移除会改变本事项范围，需要重新核对原规划决定。`, tone: 'warning', confirmLabel: '移除依赖' })) return
    const response = await $fetch<{ code: number, data: { value: { biz_id: string, product_code: string, item_biz_id: string, removed: boolean, revision: number, item_revision: number, workspace_revision: number } } }>(url, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    if (response.code !== 0 || !result || result.biz_id !== current.biz_id || result.product_code !== code.value || result.item_biz_id !== id.value || result.removed !== true || result.revision !== current.revision + 1 || result.item_revision !== current.item_revision + 1 || result.workspace_revision !== current.workspace_revision + 1) throw new Error('移除回执不完整，请重试')
    selected.value = null
    reason.value = ''
    impact.value = ''
    retry = undefined
    toast.add({ title: '依赖已移除', color: 'success' })
    await Promise.all([refresh(), refreshPermission()])
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('移除失败，请重试')
  } finally { saving.value = false }
}
onBeforeRouteLeave(() => !saving.value && !reloading.value)
onBeforeRouteUpdate(() => !saving.value && !reloading.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-4xl space-y-4 p-4 sm:p-6">
    <UButton :to="`/products/${encodeURIComponent(code)}/planning-items/${encodeURIComponent(id)}`" color="neutral" variant="ghost">
      返回规划事项
    </UButton>
    <h1 class="text-xl font-semibold">
      跨产品依赖
    </h1>
    <p class="text-sm text-muted">
      查看本事项依赖的其他产品事项，仅显示你有权查看的记录。
    </p>
    <UButton
      color="neutral"
      variant="outline"
      :loading="status === 'pending'"
      :disabled="saving || reloading || !!selected || creating"
      @click="reload()"
    >
      刷新依赖
    </UButton>
    <UButton v-if="canEdit && !creating" :disabled="saving || reloading || !!selected" @click="creating = true">
      新增跨产品依赖
    </UButton>
    <ProductsCrossDependencyCreate
      v-if="creating && data"
      :key="`${code}:${id}`"
      :product-code="code"
      :item-id="id"
      :workspace-revision="data.workspace_revision"
      :item-revision="data.item_revision"
      @cancel="creating = false"
      @saved="creating = false; reload()"
    />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UAlert v-if="saveAlert" v-bind="saveAlert" />
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在加载依赖…
    </p>
    <UCard v-if="selected">
      <h2 class="mb-3 font-semibold">
        移除依赖：{{ selected.predecessor_title }}
      </h2>
      <form class="space-y-3" @submit.prevent="remove">
        <UFormField label="移除原因" required>
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
        <div class="flex flex-wrap gap-2">
          <UButton
            type="submit"
            color="error"
            :loading="saving"
            :disabled="!canEdit || !reason.trim() || reloading"
          >
            确认移除
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            :disabled="saving"
            @click="cancel"
          >
            取消
          </UButton>
        </div>
      </form>
    </UCard>
    <template v-if="status === 'success' && data">
      <p class="text-sm text-muted">
        共 {{ data.total }} 条可见依赖
      </p>
      <UCard v-if="!data.items.length">
        <p>当前页没有可见依赖。</p>
      </UCard>
      <ul v-else class="space-y-4">
        <li v-for="item in data.items" :key="item.biz_id">
          <UCard>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="break-words font-semibold">
                {{ item.predecessor_title }}
              </h2>
              <UBadge :color="item.predecessor_lifecycle === 'delivered' ? 'success' : 'neutral'" variant="subtle">
                {{ lifecycle[item.predecessor_lifecycle] || '未知状态' }}
              </UBadge>
            </div>
            <p class="mt-2 break-words text-sm text-muted">
              所属产品：{{ item.predecessor_product_code }}
            </p>
            <p class="mt-2 whitespace-pre-wrap break-words text-sm">
              依赖原因：{{ item.reason }}
            </p>
            <UButton
              class="mt-3"
              :to="`/products/${encodeURIComponent(item.predecessor_product_code)}/planning-items/${encodeURIComponent(item.predecessor_biz_id)}`"
              color="neutral"
              variant="outline"
            >
              查看前置事项
            </UButton>
            <UButton
              v-if="canEdit"
              class="mt-3 ml-2"
              color="error"
              variant="outline"
              :disabled="saving || reloading || !!selected || creating"
              @click="selected = { ...item }"
            >
              移除依赖
            </UButton>
          </UCard>
        </li>
      </ul>
      <UPagination
        v-if="data.total > pageSize && !selected && !saving && !creating"
        v-model:page="page"
        :items-per-page="pageSize"
        :total="data.total"
      />
    </template>
  </div>
</template>

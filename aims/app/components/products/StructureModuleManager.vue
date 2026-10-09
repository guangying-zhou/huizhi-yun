<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'
import ProductsComponentMoveForm from './ComponentMoveForm.vue'

const { moduleUrl, hosted, cacheKey } = useAimsModule()
const emit = defineEmits<{ changed: [], busy: [value: boolean], select: [value: { id: number, name: string }] }>()
interface ComponentRow { sort_order: number, id: number, biz_id: string, product_code: string, parent_id: number | null, name: string, description: string, revision: number, child_count: number }
interface ComponentPage { items: ComponentRow[], total: number, page: number, pageSize: number, parent_id: number | null, workspace_revision: number }
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const trail = ref<{ id: number, name: string }[]>([])
const parentID = computed(() => trail.value.at(-1)?.id ?? null)
const page = ref(1), pageSize = 20
const base = computed(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/components`))
const query = computed(() => ({ parentId: parentID.value ?? undefined, page: page.value, pageSize }))
const positive = (n: unknown) => Number.isSafeInteger(n) && Number(n) > 0
const { data, status, error, refresh } = await useFetch(base, { ...(hosted ? { key: computed(() => cacheKey('StructureModuleManager:1' + ':' + String(code.value))) } : {}), server: false, query, transform: (response: { code: number, data: ComponentPage }) => {
  const result = response.data
  if (response.code !== 0 || !result || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 || result.page !== page.value || result.pageSize !== pageSize || result.parent_id !== parentID.value || !positive(result.workspace_revision) || result.items.length > pageSize || result.items.length > result.total || result.items.some(item => !item || !positive(item.id) || typeof item.biz_id !== 'string' || item.product_code !== code.value || item.parent_id !== parentID.value || typeof item.name !== 'string' || !item.name.trim() || typeof item.description !== 'string' || !Number.isInteger(item.sort_order) || item.sort_order < -2147483648 || item.sort_order > 2147483647 || !positive(item.revision) || !Number.isSafeInteger(item.child_count) || item.child_count < 0) || new Set(result.items.map(item => item.id)).size !== result.items.length) throw new Error('模块列表响应不完整，请刷新重试')
  return result
} })
const alert = useApiErrorAlert(error, { fallbackTitle: '模块列表加载失败' })
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, revision: number, edit: boolean, delete: boolean } }>(() => `${base.value}/permissions`, { ...(hosted ? { key: computed(() => cacheKey('StructureModuleManager:2' + ':' + String(code.value))) } : {}), server: false })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '模块权限加载失败' })
const canCreate = computed(() => status.value === 'success' && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.edit === true && positive(permission.value.data.revision) && data.value?.workspace_revision === permission.value.data.revision)
const canDelete = computed(() => status.value === 'success' && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.delete === true && positive(permission.value.data.revision) && data.value?.workspace_revision === permission.value.data.revision)
const deleting = ref<{ item: ComponentRow, workspaceRevision: number } | null>(null)
const deleteReason = ref('')
const deleteError = ref<Error | null>(null)
const deleteAlert = useApiErrorAlert(deleteError, { fallbackTitle: '模块删除失败' })
const { confirm } = useConfirm()
let deleteRetry: { payload: string, key: string } | undefined
function startDelete(item: ComponentRow) {
  if (!canDelete.value || !data.value || saving.value || item.child_count > 0) return
  deleting.value = { item: { ...item }, workspaceRevision: data.value.workspace_revision }
  deleteReason.value = ''
  deleteError.value = null
  deleteRetry = undefined
}
async function remove() {
  if (!canDelete.value || !deleting.value || saving.value || !deleteReason.value.trim()) return
  const target = deleting.value
  const body = { expectedRevision: target.workspaceRevision, expectedComponentRevision: target.item.revision, reason: deleteReason.value }
  const payload = JSON.stringify({ id: target.item.id, body })
  if (deleteRetry?.payload !== payload) deleteRetry = { payload, key: crypto.randomUUID() }
  saving.value = true
  deleteError.value = null
  try {
    if (!await confirm({ title: '删除产品模块', message: `删除“${target.item.name}”。此操作不能撤销。若模块仍被子模块或功能引用，系统会拒绝删除。\n原因：${body.reason}`, tone: 'danger', confirmLabel: '确认删除' })) return
    const result = await $fetch<{ code: number, data: { value: { id: number, product_code: string, deleted: boolean } } }>(`${base.value}/${target.item.id}`, { method: 'DELETE', body, headers: { 'Idempotency-Key': deleteRetry.key } })
    const value = result.data?.value
    if (result.code !== 0 || value?.id !== target.item.id || value.product_code !== code.value || value.deleted !== true) throw new Error('删除结果不完整，请使用原请求重试')
    deleting.value = null
    deleteRetry = undefined
    toast.add({ title: '产品模块已删除', color: 'success' })
    emit('changed')
    if (data.value?.items.length === 1 && page.value > 1) page.value--
    await Promise.all([refresh(), refreshPermission()])
  } catch (cause) {
    deleteError.value = cause instanceof Error ? cause : new Error('删除失败')
  } finally {
    saving.value = false
  }
}
const editing = ref(false), saving = ref(false)
watch(saving, value => emit('busy', value), { flush: 'sync' })
const draft = reactive({ name: '', description: '', sortOrder: 0, reason: '' })
const frozen = ref<{ parentId: number | null, parentName: string, expectedRevision: number, componentId?: number, componentRevision?: number } | null>(null)
const saveError = ref<Error | null>(null)
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '模块保存失败' })
const toast = useToast()
let retry: { payload: string, key: string } | undefined
const moving = ref<{ item: ComponentRow, workspaceRevision: number } | null>(null)
function startMove(item: ComponentRow) {
  if (!canCreate.value || !data.value || saving.value) return
  moving.value = { item: { ...item }, workspaceRevision: data.value.workspace_revision }
}
async function moved() {
  moving.value = null
  toast.add({ title: '产品模块已移动', color: 'success' })
  emit('changed')
  await reload()
}
function startCreate() {
  if (!canCreate.value || !data.value || saving.value) return
  frozen.value = { parentId: parentID.value, parentName: trail.value.at(-1)?.name ?? '全部模块（根层）', expectedRevision: data.value.workspace_revision }
  Object.assign(draft, { name: '', description: '', sortOrder: 0, reason: '' })
  saveError.value = null
  retry = undefined
  editing.value = true
}
function startEdit(item: ComponentRow) {
  if (!canCreate.value || !data.value || saving.value) return
  frozen.value = { parentId: item.parent_id, parentName: trail.value.at(-1)?.name ?? '全部模块（根层）', expectedRevision: data.value.workspace_revision, componentId: item.id, componentRevision: item.revision }
  Object.assign(draft, { name: item.name, description: item.description, sortOrder: item.sort_order, reason: '' })
  saveError.value = null
  retry = undefined
  editing.value = true
}
async function reload() {
  if (saving.value) return
  await Promise.all([refresh(), refreshPermission()])
}
async function save() {
  if (saving.value || !canCreate.value || !frozen.value || !draft.name.trim() || (frozen.value.componentId && !draft.reason.trim()) || !Number.isInteger(draft.sortOrder) || draft.sortOrder < -2147483648 || draft.sortOrder > 2147483647) return
  saving.value = true
  saveError.value = null
  const target = { ...frozen.value }
  const common = { name: draft.name, description: draft.description, sortOrder: draft.sortOrder, expectedRevision: target.expectedRevision }
  const body = target.componentId ? { ...common, expectedComponentRevision: target.componentRevision, reason: draft.reason } : { ...common, parentId: target.parentId }
  const url = target.componentId ? `${base.value}/${target.componentId}/edit` : base.value
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  try {
    const result = await $fetch<{ code: number, data: { value: ComponentRow & { component?: ComponentRow } } }>(url, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const saved = target.componentId ? result.data?.value?.component : result.data?.value
    if (result.code !== 0 || !saved || !positive(saved.id) || saved.product_code !== code.value || saved.parent_id !== target.parentId || saved.name !== body.name || saved.description !== body.description || saved.sort_order !== body.sortOrder || (target.componentId && (saved.id !== target.componentId || saved.revision !== target.componentRevision! + 1))) throw new Error('保存结果不完整，请重试')
    editing.value = false
    frozen.value = null
    retry = undefined
    toast.add({ title: target.componentId ? '产品模块已更新' : '产品模块已创建', color: 'success' })
    emit('changed')
    await Promise.all([refresh(), refreshPermission()])
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('保存失败，请重试')
  } finally {
    saving.value = false
  }
}
onBeforeRouteLeave(() => !saving.value)
onBeforeRouteUpdate(() => !saving.value)
function enter(item: ComponentRow) {
  if (saving.value || editing.value || status.value !== 'success' || trail.value.length >= 2) return
  page.value = 1
  trail.value = [...trail.value, { id: item.id, name: item.name }]
}
function back(depth: number) {
  if (saving.value || editing.value || status.value === 'pending') return
  page.value = 1
  trail.value = trail.value.slice(0, depth)
}
watch(code, () => {
  deleting.value = null
  deleteRetry = undefined
  deleteError.value = null
  moving.value = null
  editing.value = false
  frozen.value = null
  retry = undefined
  saveError.value = null
  trail.value = []
  page.value = 1
})
</script>

<template>
  <div class="min-w-0 space-y-4">
    <p class="text-sm text-muted">
      按模块组织产品功能，最多支持三级。进入模块查看下一层。
    </p>
    <nav aria-label="模块位置" class="flex min-w-0 flex-wrap items-center gap-2">
      <UButton
        color="neutral"
        variant="link"
        :disabled="status === 'pending' || trail.length === 0"
        @click="back(0)"
      >
        全部模块
      </UButton>
      <template v-for="(item, index) in trail" :key="item.id">
        <span aria-hidden="true" class="text-muted">/</span>
        <UButton
          color="neutral"
          variant="link"
          class="min-w-0 max-w-full whitespace-normal break-all text-left"
          :disabled="status === 'pending' || index === trail.length - 1"
          @click="back(index + 1)"
        >
          {{ item.name }}
        </UButton>
      </template>
    </nav>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-base font-semibold">
        第 {{ trail.length + 1 }} 级模块
      </h2>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :loading="status === 'pending'"
        @click="reload()"
      >
        刷新
      </UButton>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UButton
      v-if="canCreate"
      icon="i-lucide-plus"
      :disabled="saving"
      @click="startCreate"
    >
      新建本层模块
    </UButton>
    <p v-if="status === 'pending'" role="status">
      正在加载模块…
    </p>
    <template v-if="status === 'success' && data">
      <CommonEmptyState
        v-if="!data.items.length"
        icon="i-lucide-folder-tree"
        title="当前层级暂无模块"
        description="可返回上一级查看其他模块。"
      />
      <article v-for="item in data.items" :key="item.id" class="min-w-0 space-y-3 rounded-lg border border-default p-4">
        <h3 class="break-all font-medium">
          {{ item.name }}
        </h3>
        <p class="whitespace-pre-wrap break-all text-sm text-muted">
          {{ item.description || '暂无说明' }}
        </p>
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-sm text-muted">{{ item.child_count }} 个子模块</span>
          <UButton
            v-if="canDelete"
            color="error"
            variant="outline"
            size="sm"
            :disabled="saving || item.child_count > 0"
            @click="startDelete(item)"
          >
            删除模块
          </UButton>
          <UButton
            v-if="canCreate"
            size="sm"
            color="neutral"
            variant="outline"
            :disabled="saving"
            @click="startEdit(item)"
          >
            编辑模块
          </UButton>
          <UButton
            size="sm"
            color="neutral"
            variant="outline"
            :disabled="saving"
            @click="emit('select', { id: item.id, name: item.name })"
          >
            查看功能
          </UButton>
          <UButton
            :to="{ path: moduleUrl(`/products/${encodeURIComponent(code)}/requests`), query: { moduleId: String(item.id), includeDescendants: 'true' } }"
            size="sm"
            color="neutral"
            variant="outline"
            :disabled="saving"
          >
            查看需求
          </UButton>
          <UButton
            v-if="canCreate"
            :to="{ path: moduleUrl(`/products/${encodeURIComponent(code)}/requests`), query: { moduleId: String(item.id), create: 'true' } }"
            size="sm"
            :disabled="saving"
          >
            新增需求
          </UButton>
          <UButton
            v-if="canCreate"
            size="sm"
            color="neutral"
            variant="outline"
            :disabled="saving"
            @click="startMove(item)"
          >
            移动模块
          </UButton>
          <UButton
            v-if="trail.length < 2"
            size="sm"
            color="neutral"
            variant="outline"
            @click="enter(item)"
          >
            查看子模块
          </UButton>
        </div>
      </article>
      <p class="text-sm text-muted">
        本层共 {{ data.total }} 个模块
      </p>
      <UPagination
        v-if="data.total > pageSize"
        v-model:page="page"
        :total="data.total"
        :items-per-page="pageSize"
        :sibling-count="0"
      />
    </template>
    <UModal
      v-model:open="editing"
      :title="frozen?.componentId ? '编辑产品模块' : '新建产品模块'"
      :description="frozen?.componentId ? '修改模块名称、说明或排序；所属位置通过移动操作调整。' : '模块用于组织产品功能，创建后可继续补充子模块。'"
      :dismissible="!saving"
      :close="!saving"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="save">
          <p class="break-all text-sm text-muted">
            所属位置：{{ frozen?.parentName }}
          </p>
          <UAlert v-if="saveAlert" v-bind="saveAlert" />
          <UFormField label="模块名称" required>
            <UInput
              v-model="draft.name"
              required
              :maxlength="255"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
          <UFormField label="模块说明">
            <UTextarea
              v-model="draft.description"
              :maxlength="10000"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
          <UFormField label="排序" description="同一层级按数值从小到大显示。">
            <UInput
              v-model.number="draft.sortOrder"
              type="number"
              :min="-2147483648"
              :max="2147483647"
              :step="1"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
          <UFormField v-if="frozen?.componentId" label="修改原因" required>
            <UTextarea
              v-model="draft.reason"
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
              @click="editing = false"
            >
              取消
            </UButton>
            <UButton type="submit" :loading="saving" :disabled="!draft.name.trim() || !canCreate || (!!frozen?.componentId && !draft.reason.trim())">
              {{ frozen?.componentId ? '保存模块' : '创建模块' }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
    <UModal
      :open="!!moving"
      title="移动产品模块"
      description="选择新的父模块，子模块将一起移动。"
      :dismissible="!saving"
      :close="!saving"
      @update:open="value => { if (!value && !saving) moving = null }"
    >
      <template #body>
        <ProductsComponentMoveForm
          v-if="moving"
          :key="moving.item.id"
          :product-code="code"
          :component-id="moving.item.id"
          :name="moving.item.name"
          :parent-id="moving.item.parent_id"
          :component-revision="moving.item.revision"
          :workspace-revision="moving.workspaceRevision"
          @busy="saving = $event"
          @cancel="moving = null"
          @saved="moved"
        />
      </template>
    </UModal>
    <UModal
      :open="!!deleting"
      title="删除产品模块"
      description="仅能删除没有子模块和功能引用的模块。"
      :dismissible="!saving"
      :close="!saving"
      @update:open="value => { if (!value && !saving) deleting = null }"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="remove">
          <p class="break-all">
            模块：{{ deleting?.item.name }}
          </p>
          <UAlert v-if="deleteAlert" v-bind="deleteAlert" />
          <UFormField label="删除原因" required>
            <UTextarea
              v-model="deleteReason"
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
              @click="deleting = null"
            >
              取消
            </UButton>
            <UButton
              type="submit"
              color="error"
              :loading="saving"
              :disabled="!deleteReason.trim() || !canDelete"
            >
              删除模块
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>

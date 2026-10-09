<script setup lang="ts">
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import { apfServerFieldErrors } from '../utils/apfFormPresentation'
import type { TableColumn } from '@nuxt/ui'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'

const props = defineProps<{ resource: 'lead' | 'opportunity', id: string, version: number, customerId?: string, canEdit: boolean }>()
const emit = defineEmits<{ changed: [] }>()
type Row = Record<string, string | number | boolean | null>
const section = ref('activities')
const sections = computed(() => [{ label: '跟进记录', value: 'activities' }, ...(props.resource === 'opportunity' ? [{ label: '联系人关系', value: 'contact-roles' }, { label: '阶段历史', value: 'stage-history' }] : []), { label: '文档引用', value: 'documents' }])
const emptyState = computed(() => ({
  'activities': { title: '暂无跟进记录', description: '记录拜访、电话或会议的结果，保留下一步跟进安排。' },
  'contact-roles': { title: '暂无联系人关系', description: '关联当前客户的联系人及其决策角色。' },
  'stage-history': { title: '暂无阶段变更', description: '商机推进阶段后将在此展示变更记录。' },
  'documents': { title: '暂无文档引用', description: '只展示当前业务对象的文档关联，不授予额外文档权限。' }
}[section.value] || { title: '暂无资料', description: '请选择需要查看的资料类型。' }))
const page = ref(1)
const rows = ref<Row[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
let epoch = 0
const base = computed(() => `/altoc/api/v1/${props.resource === 'lead' ? 'leads' : 'opportunities'}/${props.id}/${section.value}`)
const scope = useState<string>('enterprise-cache-scope', () => '')
const columns = computed<TableColumn<Row>[]>(() => section.value === 'activities' ? [{ accessorKey: 'subject', header: '主题' }, { accessorKey: 'activity_at', header: '发生时间' }, { accessorKey: 'result_summary', header: '结果' }] : section.value === 'contact-roles' ? [{ accessorKey: 'contact_name', header: '联系人' }, { accessorKey: 'role', header: '角色' }, { accessorKey: 'remark', header: '备注' }, { id: 'actions', header: '操作' }] : section.value === 'stage-history' ? [{ accessorKey: 'from_stage_name', header: '原阶段' }, { accessorKey: 'to_stage_name', header: '目标阶段' }, { accessorKey: 'changed_at', header: '变更时间' }, { accessorKey: 'change_reason', header: '说明' }] : [{ accessorKey: 'document_title', header: '文档' }, { accessorKey: 'link_type', header: '类型' }, { id: 'actions', header: '操作' }])
const roleOptions = [{ label: '决策者', value: 'decision_maker' }, { label: '预算负责人', value: 'economic_buyer' }, { label: '支持者', value: 'sponsor' }, { label: '采购', value: 'procurement' }, { label: '技术影响者', value: 'technical_influencer' }, { label: '使用者', value: 'end_user' }, { label: '竞争方支持者', value: 'competitor_supporter' }]
const typeOptions = [{ label: '方案', value: 'proposal' }, { label: '合同文本', value: 'contract_text' }, { label: '会议纪要', value: 'meeting_memo' }, { label: '招标文档', value: 'tender_doc' }, { label: '证据', value: 'evidence' }, { label: '其他', value: 'general' }]
async function load() {
  const current = ++epoch
  rows.value = []
  total.value = 0
  if (!scope.value) return
  loading.value = true
  error.value = ''
  try {
    const result = await $fetch<{ code: number, data: { items: Row[], total: number } }>(base.value, { query: { page: page.value, pageSize: 20 } })
    if (current !== epoch) return
    rows.value = result.data.items
    total.value = result.data.total
  } catch {
    if (current === epoch) error.value = '关联资料加载失败或无查看权限'
  } finally {
    if (current === epoch) loading.value = false
  }
}
watch(section, () => {
  page.value = 1
})
watch([() => props.id, section, page, scope], load, { immediate: true })
onBeforeUnmount(() => {
  epoch++
  rows.value = []
})
const open = ref(false)
const editingId = ref('')
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})
const saving = ref(false)
const draft = reactive({ contactId: '', role: 'end_user', influence_level: 'medium', attitude: 'neutral', is_primary: false, remark: '', document_uuid: '', link_type: 'general' })
const intent = createConsoleMutationIntent('altoc-sales-support')
const { confirm } = useConfirm()
function begin(row?: Row) {
  if (!props.canEdit || !intent.reset()) return
  editingId.value = row ? String(row.id) : ''
  Object.assign(draft, { contactId: row ? String(row.contact_id) : '', role: row?.role || 'end_user', influence_level: row?.influence_level || 'medium', attitude: row?.attitude || 'neutral', is_primary: Boolean(Number(row?.is_primary || 0)), remark: row?.remark || '', document_uuid: '', link_type: 'general' })
  formError.value = ''
  open.value = true
}
async function mutate(method: 'POST' | 'PATCH' | 'DELETE', childId = '') {
  if (saving.value || !props.canEdit) return
  const body: Record<string, unknown> = { expectedVersion: props.version }
  if (method !== 'DELETE') {
    if (section.value === 'documents') {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(draft.document_uuid)) {
        formError.value = '请输入有效的 Codocs 文档 UUID'
        return
      }
      Object.assign(body, { document_uuid: draft.document_uuid, link_type: draft.link_type })
    } else {
      if (!/^[1-9]\d*$/.test(draft.contactId)) {
        fieldErrors.value.contactId = '请选择本客户的联系人'
        formError.value = '请选择本客户的联系人'
        return
      }
      Object.assign(body, { contactId: draft.contactId, role: draft.role, influence_level: draft.influence_level, attitude: draft.attitude, is_primary: draft.is_primary, remark: draft.remark })
    }
  }
  if (method === 'DELETE' && !await confirm({ title: '移除关联', message: '只移除本业务对象中的关联，不删除联系人或 Codocs 文档。', tone: 'danger' })) return
  saving.value = true
  formError.value = ''
  const path = `${base.value}${childId ? `/${childId}` : ''}`
  try {
    const done = await intent.submit({ method, path, body }, (request, key) => $fetch(request.path, { method, body: request.body, headers: { 'Idempotency-Key': key } }))
    if (!done) return
    open.value = false
    emit('changed')
    await load()
  } catch (failure) {
    fieldErrors.value = apfServerFieldErrors(failure, Object.keys(body))
    formError.value = '操作未完成，请检查权限和资料版本后使用原操作重试'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="min-w-0 space-y-4 border-t border-default pt-5">
    <div class="flex flex-wrap items-center gap-3">
      <USelect
        v-model="section"
        :items="sections"
        class="w-44"
        aria-label="关联资料类型"
      />
      <UButton
        v-if="canEdit && ['contact-roles', 'documents'].includes(section)"
        color="neutral"
        variant="outline"
        @click="begin()"
      >
        {{ section === 'documents' ? '关联文档' : '添加联系人关系' }}
      </UButton>
    </div>
    <UAlert
      v-if="error"
      color="error"
      :title="error"
    />
    <UAlert
      v-if="formError && !open"
      color="error"
      :title="formError"
    />
    <div class="overflow-x-auto">
      <UTable
        :data="rows"
        :columns="columns"
        :loading="loading"
      >
        <template #empty>
          <CommonEmptyState
            :title="emptyState.title"
            :description="emptyState.description"
          />
        </template>
        <template #role-cell="{ row }">
          {{ roleOptions.find(o => o.value === row.original.role)?.label || '未设置' }}
        </template>
        <template #link_type-cell="{ row }">
          {{ typeOptions.find(o => o.value === row.original.link_type)?.label || '其他' }}
        </template>
        <template #actions-cell="{ row }">
          <div
            v-if="canEdit"
            class="flex gap-2"
          >
            <UButton
              v-if="section === 'contact-roles'"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="begin(row.original)"
            >
              编辑
            </UButton><UButton
              color="error"
              variant="ghost"
              size="sm"
              :loading="saving"
              @click="mutate('DELETE', String(row.original.id))"
            >
              移除
            </UButton>
          </div>
        </template>
      </UTable>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
        v-model:page="page"
        :total="total"
        :items-per-page="20"
      />
    </div>
    <UModal
      v-model:open="open"
      :title="section === 'documents' ? '关联文档' : editingId ? '编辑联系人关系' : '添加联系人关系'"
      description="提交时会复核当前业务范围、目标事实与资料版本。"
      :dismissible="!saving"
    >
      <template #body>
        <div class="space-y-4">
          <UAlert
            v-if="formError"
            color="error"
            :title="formError"
          />
          <template v-if="section === 'documents'">
            <UFormField
              label="Codocs 文档 UUID"
              required
            >
              <UInput
                v-model="draft.document_uuid"
                class="w-full"
              />
            </UFormField><UFormField label="文档类型">
              <USelect
                v-model="draft.link_type"
                :items="typeOptions"
                class="w-full"
              />
            </UFormField><p class="text-sm text-muted">
              只能关联您当前可读的文档，关联不会向其他人授予文档权限。
            </p>
          </template>
          <template v-else>
            <UFormField
              label="本客户联系人"
              :error="fieldErrors.contactId"
              required
            >
              <AltocBusinessObjectSelect
                v-model="draft.contactId"
                kind="contacts"
                :parent-id="customerId"
                :enabled="open && canEdit"
              />
            </UFormField><UFormField
              label="角色"
              required
            >
              <USelect
                v-model="draft.role"
                :items="roleOptions"
                class="w-full"
              />
            </UFormField><UFormField label="影响力">
              <USelect
                v-model="draft.influence_level"
                :items="[{ label: '高', value: 'high' }, { label: '中', value: 'medium' }, { label: '低', value: 'low' }]"
                class="w-full"
              />
            </UFormField><UFormField label="态度">
              <USelect
                v-model="draft.attitude"
                :items="[{ label: '支持', value: 'supportive' }, { label: '中立', value: 'neutral' }, { label: '反对', value: 'resistant' }, { label: '未知', value: 'unknown' }]"
                class="w-full"
              />
            </UFormField><UCheckbox
              v-model="draft.is_primary"
              label="主要联系人"
            /><UFormField label="备注">
              <UTextarea
                v-model="draft.remark"
                class="w-full"
              />
            </UFormField>
          </template>
        </div>
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="saving"
          @click="open = false"
        >
          取消
        </UButton><UButton
          :loading="saving"
          @click="mutate(editingId ? 'PATCH' : 'POST', editingId)"
        >
          保存
        </UButton>
      </template>
    </UModal>
  </section>
</template>

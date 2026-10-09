<script setup lang="ts">
import APFUserSelect from './APFUserSelect.vue'
import APFDepartmentSelect from './APFDepartmentSelect.vue'
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import { createReviewMutationIntent } from '@hzy/foundation/shared/utils/reviewMutationIntent'
import { historicalActions, historicalPayload, historicalWriteMessage, historicalConflictCodes } from '../utils/w3HistoricalContract'
import { requireAltocJsonMutationResult, altocContractStatusLabels } from '../utils/altocBusinessObjectPresentation'

const props = defineProps<{ contract: Record<string, unknown>, canEdit: boolean, canClose: boolean }>()
const emit = defineEmits<{ saved: [] }>()
const actions = computed(() => historicalActions(props.contract, props.canEdit, props.canClose))
const draft = reactive<Record<string, string>>({ contact_id: '', remark: '', content_summary: '', owner_uid: '', owner_dept_code: '', reason: '', project_code: '', project_name: '', project_dept: '' })
const open = ref(false)
const action = ref('annotate')
const saving = ref(false)
const error = ref('')
const comparing = ref(false)
const comparison = ref<Record<string, unknown> | null>(null)
const version = ref<Record<string, unknown>>({})
const scope = useState<string>('enterprise-cache-scope', () => '')
let intent = createReviewMutationIntent('historical-contract', historicalConflictCodes)
const { confirm } = useConfirm()
const toast = useToast()
let generation = 0
onScopeDispose(() => {
  generation++
})
function selectProject(row: Record<string, unknown>) {
  draft.project_name = String(row.project_name || row.name || '')
  draft.project_dept = String(row.dept_code || '')
}
const titles: Record<string, string> = { annotate: '补充信息', owner: '变更负责人', projects: '关联项目', complete: '完结合同', terminate: '中止合同' }
function begin(next: string) {
  if (intent.uncertain) {
    open.value = true
    return
  }
  action.value = next
  version.value = { ...props.contract }
  Object.assign(draft, { contact_id: props.contract.contact_id ? String(props.contract.contact_id) : '', remark: String(props.contract.remark || ''), content_summary: String(props.contract.content_summary || ''), owner_uid: '', owner_dept_code: '', reason: '', project_code: '', project_name: '', project_dept: '' })
  error.value = ''
  comparison.value = null
  intent.reset()
  open.value = true
}
async function compare() {
  const token = generation
  comparing.value = true
  try {
    const result = await $fetch<{ data: Record<string, unknown> }>(`/altoc/api/v1/contracts/${encodeURIComponent(String(props.contract.id))}`, { retry: 0 })
    if (token === generation) comparison.value = result.data
  } catch (failure) {
    if (token === generation) error.value = historicalWriteMessage(failure)
  } finally {
    if (token === generation) comparing.value = false
  }
}
function adoptVersion() {
  if (!comparison.value || intent.uncertain) return
  version.value = { ...comparison.value }
  intent.reset()
  comparison.value = null
  error.value = '已采用最新版本，请核对保留的草稿后再提交'
}
async function save() {
  if (saving.value || !(actions.value as Record<string, boolean>)[action.value]) return
  const token = generation
  let body: Record<string, unknown>
  try {
    body = historicalPayload(action.value, version.value, draft)
  } catch (failure) {
    error.value = historicalWriteMessage(failure)
    return
  }
  if (['complete', 'terminate'].includes(action.value) && !intent.uncertain) {
    open.value = false
    await nextTick()
    const accepted = await confirm({ title: titles[action.value], message: `合同「${String(props.contract.contract_no || props.contract.code)}」将${action.value === 'complete' ? '完结' : '中止'}。操作后不可在系统内撤销，不会代替财务结算或变更关联项目。`, tone: action.value === 'terminate' ? 'danger' : 'warning', confirmLabel: titles[action.value] })
    if (token !== generation || !(actions.value as Record<string, boolean>)[action.value]) return
    open.value = true
    if (!accepted) return
  }
  saving.value = true
  error.value = ''
  try {
    const done = await intent.submit({ method: action.value === 'owner' ? 'PATCH' : 'POST', path: `/altoc/api/v1/contracts/${encodeURIComponent(String(props.contract.id))}/${action.value}`, body }, async (request, key) => requireAltocJsonMutationResult(await $fetch(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key }, retry: 0 })))
    if (token !== generation) return
    if (done) {
      open.value = false
      toast.add({ title: titles[action.value] + '成功', color: 'success' })
      emit('saved')
    }
  } catch (failure) {
    if (token !== generation) return
    error.value = historicalWriteMessage(failure)
    if (Number((failure as { statusCode?: number, status?: number }).statusCode || (failure as { status?: number }).status) === 409) await compare()
  } finally {
    saving.value = false
  }
}
watch([scope, () => props.contract.id], () => {
  generation++
  open.value = false
  comparison.value = null
  error.value = ''
  intent = createReviewMutationIntent('historical-contract', historicalConflictCodes)
})
watch([() => props.canEdit, () => props.canClose], () => {
  if (!(actions.value as Record<string, boolean>)[action.value]) open.value = false
})
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <UButton
      v-if="actions.annotate"
      color="neutral"
      variant="outline"
      @click="begin('annotate')"
    >
      补充信息
    </UButton>
    <UButton
      v-if="actions.owner"
      color="neutral"
      variant="outline"
      @click="begin('owner')"
    >
      变更负责人
    </UButton>
    <UButton
      v-if="actions.projects"
      color="neutral"
      variant="outline"
      @click="begin('projects')"
    >
      关联项目
    </UButton>
    <UButton
      v-if="actions.complete"
      color="warning"
      variant="outline"
      @click="begin('complete')"
    >
      完结
    </UButton>
    <UButton
      v-if="actions.terminate"
      color="error"
      variant="outline"
      @click="begin('terminate')"
    >
      中止
    </UButton>
    <USlideover
      v-model:open="open"
      :title="titles[action]"
      description="按当前合同权限与版本办理，失败保留填写内容；历史合同完结或中止不可撤销。"
      :dismissible="!saving"
      :ui="{ content: 'w-full sm:max-w-xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <template v-if="action === 'annotate'">
            <UFormField label="联系人">
              <AltocBusinessObjectSelect
                v-model="draft.contact_id!"
                kind="contacts"
                :parent-id="String(contract.customer_id)"
                :enabled="open && !intent.uncertain"
              /><UButton
                v-if="draft.contact_id"
                variant="link"
                :disabled="intent.uncertain"
                @click="draft.contact_id = ''"
              >
                清空联系人
              </UButton>
            </UFormField>
            <UFormField label="备注">
              <UTextarea
                v-model="draft.remark"
                class="w-full"
                :disabled="intent.uncertain"
                :maxlength="2000"
              />
            </UFormField>
            <UFormField label="内容摘要">
              <UTextarea
                v-model="draft.content_summary"
                class="w-full"
                :disabled="intent.uncertain"
                :maxlength="5000"
              />
            </UFormField>
          </template>
          <template v-else-if="action === 'owner'">
            <UFormField
              label="负责人"
              required
            >
              <APFUserSelect
                v-model="draft.owner_uid!"
                :disabled="intent.uncertain"
              />
            </UFormField>
            <UFormField label="负责人部门（不填则保留）">
              <APFDepartmentSelect
                v-model="draft.owner_dept_code!"
                :disabled="intent.uncertain"
              />
            </UFormField>
          </template>
          <template v-else-if="action === 'projects'">
            <UFormField
              label="交付项目"
              required
            >
              <AltocBusinessObjectSelect
                v-model="draft.project_code!"
                kind="projects"
                :enabled="open && !intent.uncertain"
                @select="selectProject"
              />
            </UFormField>
            <UFormField label="项目名称">
              <UInput
                v-model="draft.project_name"
                class="w-full"
                readonly
              />
            </UFormField>
            <UFormField label="项目部门（可选）">
              <APFDepartmentSelect
                v-model="draft.project_dept!"
                :disabled="intent.uncertain"
              />
            </UFormField>
            <UAlert
              color="info"
              description="仅关联既有项目，还需该项目的 Aims 编辑范围许可；不修改历史合同行或生成里程碑。"
            />
          </template>
          <UFormField
            v-else
            label="原因"
            :required="action === 'terminate'"
          >
            <UTextarea
              v-model="draft.reason"
              class="w-full"
              :maxlength="500"
              :disabled="intent.uncertain"
            />
          </UFormField>
          <UAlert
            v-if="error"
            color="warning"
            :description="error"
          />
          <div
            v-if="comparison"
            class="space-y-2 rounded border border-muted p-3 text-sm"
          >
            <p>最新版本 {{ comparison.row_version }}，状态 {{ altocContractStatusLabels[String(comparison.status)] || '未知状态' }}</p>
            <p class="break-words">
              最新摘要：{{ comparison.content_summary || '未填写' }}
            </p>
            <p class="break-words">
              最新备注：{{ comparison.remark || '未填写' }}
            </p>
            <UButton
              :disabled="intent.uncertain"
              color="neutral"
              @click="adoptVersion"
            >
              采用最新版本，保留草稿
            </UButton>
          </div>
          <UButton
            v-if="error"
            color="neutral"
            variant="outline"
            :loading="comparing"
            @click="compare"
          >
            刷新比较
          </UButton>
        </div>
      </template>
      <template #footer>
        <UButton
          :loading="saving"
          @click="save"
        >
          {{ intent.uncertain ? '原请求重试' : '提交' }}
        </UButton>
      </template>
    </USlideover>
  </div>
</template>

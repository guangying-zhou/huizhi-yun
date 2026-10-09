<script setup lang="ts">
import APFDepartmentSelect from './APFDepartmentSelect.vue'
import APFUserSelect from './APFUserSelect.vue'
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import { apfServerFieldErrors } from '../utils/apfFormPresentation'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'

const props = defineProps<{ kind: 'employees' | 'assignments', row?: Record<string, unknown>, allowed: boolean }>()
const emit = defineEmits<{ saved: [] }>()
const { confirm } = useConfirm()
const open = ref(false)
const busy = ref(false)
const error = ref('')
const fieldErrors = ref<Record<string, string>>({})
const draft = reactive<Record<string, string>>({})
const intent = createConsoleMutationIntent('people-facts')
const fields = computed<[string, string, string][]>(() => props.kind === 'employees' ? [['display_name', '姓名', 'required'], ['dept_code', '部门编码', ''], ['initials', '简拼', ''], ['employment_type', '用工类型', ''], ['onboard_date', '入职日期', 'date'], ['work_location', '工作地点', '']] : [['change_type', '变更类型', 'required'], ['effective_from', '生效日期', 'date-required'], ['dept_code', '目标部门', ''], ['position_code', '目标岗位', ''], ['manager_uid', '负责人', ''], ['remarks', '变更说明', '']])
const selectedEmployee = computed({ get: () => draft.employeeUid ? [draft.employeeUid] : [], set: (uids: string[]) => {
  draft.employeeUid = uids[0] || ''
} })
function edit() {
  if (!props.allowed || !intent.reset())
    return
  Object.keys(draft).forEach((k) => {
    Reflect.deleteProperty(draft, k)
  })
  draft.employeeUid = String(props.row?.employee_uid || '')
  for (const [key] of fields.value)
    if (key)
      draft[key] = String(props.row?.[key] || '')
  if (!props.row) {
    draft.employment_type = 'full_time'
    draft.change_type = 'transfer'
  }
  error.value = ''
  fieldErrors.value = {}
  open.value = true
}
async function send(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: Record<string, unknown>) {
  if (!props.allowed || busy.value)
    return
  busy.value = true
  error.value = ''
  try {
    const done = await intent.submit({ method, path, body }, async (request, key) => {
      await $fetch(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key } })
    })
    if (done) {
      open.value = false
      emit('saved')
    }
  } catch (e) {
    fieldErrors.value = apfServerFieldErrors(e, ['employeeUid', ...fields.value.map(f => f[0])])
    const status = Number((e as { statusCode?: number }).statusCode)
    error.value = status === 409 ? '记录已变化或操作尚未确认，请使用原请求重试或刷新记录' : status === 403 ? '当前权限或人员范围不允许此操作' : status === 400 ? '请检查必填项、日期和字段格式' : '操作结果尚未确认，请保持原内容重试'
  } finally {
    busy.value = false
  }
}
async function save() {
  fieldErrors.value = Object.fromEntries([['employeeUid', '员工', 'required'], ...fields.value].filter(([key, , type]) => type?.includes('required') && !draft[key!]?.trim()).map(([key, label]) => [key!, `请选择或填写${label}`]))
  if (!draft.employeeUid || fields.value.some(([key, , type]) => key && type?.includes('required') && !draft[key])) {
    error.value = '请填写员工、姓名或变更类型和生效日期'
    return
  }
  const body: Record<string, unknown> = { employeeUid: draft.employeeUid }
  for (const [key] of fields.value)
    if (key && (draft[key] || props.row))
      body[key] = draft[key] || ''
  if (props.row)
    body.expectedVersion = Number(props.row.row_version)
  const base = `/enterprise/api/apf/people/${props.kind}`
  await send(props.row ? 'PATCH' : 'POST', props.row ? `${base}/${props.row.id}` : base, body)
}
async function remove() {
  if (!props.row || !await confirm({ title: '删除任职草稿', message: '删除该任职草稿后无法恢复；已进入审批的任职不可删除。', tone: 'danger' }))
    return
  await send('DELETE', `/enterprise/api/apf/people/assignments/${props.row.id}`, { employeeUid: props.row.employee_uid, expectedVersion: Number(props.row.row_version) })
}
async function submit() {
  if (!props.row || !await confirm({ title: '提交任职审批', message: '提交后任职事实被冻结，由正式 Workflow 审批结果决定生效。未来生效日期不会提前投影。', tone: 'warning' }))
    return
  await send('POST', `/enterprise/api/apf/people/assignments/${props.row.id}/submit`, { employeeUid: props.row.employee_uid, expectedVersion: Number(props.row.row_version) })
}
watch(() => props.allowed, (allowed) => {
  if (!allowed) {
    open.value = false
    Object.keys(draft).forEach((key) => {
      Reflect.deleteProperty(draft, key)
    })
    error.value = ''
  }
})
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <UButton
      v-if="allowed && (!row || kind === 'employees' || row.approval_status === 'draft')"
      @click="edit"
    >
      {{ row ? '编辑事实' : kind === 'employees' ? '登记员工事实' : '新增任职草稿' }}
    </UButton>
    <template v-if="allowed && kind === 'assignments' && row?.approval_status === 'draft'">
      <UButton
        color="neutral"
        variant="outline"
        :loading="busy"
        @click="submit"
      >
        提交审批
      </UButton>
      <UButton
        color="error"
        variant="outline"
        :loading="busy"
        @click="remove"
      >
        删除草稿
      </UButton>
    </template>
    <UButton
      disabled
      color="neutral"
      variant="outline"
    >
      账号开通与激活暂未开放
    </UButton>
    <UAlert
      v-if="error && !open"
      color="error"
      :title="error"
    />
    <USlideover
      v-model:open="open"
      :title="row ? '编辑人员事实' : '新增人员事实'"
      description="本阶段只保存 People 业务事实；Directory 操作可靠入队，开通与投递尚未启用。"
      :dismissible="!busy && !intent.uncertain"
      :ui="{ content: 'w-full sm:max-w-2xl' }"
    >
      <template #body>
        <form
          class="space-y-5"
          @submit.prevent="save"
        >
          <UAlert
            v-if="error"
            color="error"
            :title="error"
          />
          <UFormField
            label="员工"
            :error="fieldErrors.employeeUid"
            required
          >
            <UserTreeSelector
              v-if="!row"
              v-model="selectedEmployee"
              selection-mode="single"
              hide-committees
              width-class="w-full"
            /><p
              v-else
              class="text-sm text-muted"
            >
              {{ row.employee_uid }}
            </p>
          </UFormField>
          <h3 class="font-semibold">
            {{ kind === 'employees' ? '基本信息' : '任职与生效日期' }}
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UFormField
              v-for="[key, label, type] in fields"
              :key="key"
              :label="label"
              :required="type?.includes('required')"
              :error="fieldErrors[key]"
            >
              <USelect
                v-if="key === 'employment_type'"
                v-model="draft[key]"
                :items="[{ label: '全职', value: 'full_time' }, { label: '兼职', value: 'part_time' }, { label: '实习', value: 'intern' }, { label: '外包', value: 'outsourced' }, { label: '代理', value: 'agent' }]"
                class="w-full"
              />
              <USelect
                v-else-if="key === 'change_type'"
                v-model="draft[key]"
                :items="[{ label: '入职', value: 'onboard' }, { label: '调动', value: 'transfer' }, { label: '调级', value: 'rank_change' }, { label: '离职', value: 'leave' }]"
                class="w-full"
              />
              <APFDepartmentSelect
                v-else-if="key === 'dept_code'"
                v-model="draft[key]!"
              />
              <APFUserSelect
                v-else-if="key === 'manager_uid'"
                v-model="draft[key]!"
              />
              <AltocBusinessObjectSelect
                v-else-if="key === 'position_code'"
                v-model="draft[key]!"
                kind="positions"
                :enabled="open && allowed"
              />
              <UInput
                v-else
                v-model="draft[key]"
                :type="type?.includes('date') ? 'date' : 'text'"
                class="w-full"
              />
            </UFormField>
          </div>
          <p class="text-sm text-muted">
            审批结果只能由 Workflow 正式回调写入。身份预留、开通、激活与 Directory 投递将在后续阶段开放。
          </p>
          <UButton
            type="submit"
            :loading="busy"
          >
            {{ intent.uncertain ? '重试原操作' : '保存事实' }}
          </UButton>
        </form>
      </template>
    </USlideover>
  </div>
</template>

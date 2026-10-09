<script setup lang="ts">
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'

const props = defineProps<{ uid: string, allowed: boolean }>()
type Fact = { value: string, source: string, readOnly: boolean }
const fields = [['id_number', '身份证号'], ['birth_date', '出生日期'], ['education_level', '学历'], ['major', '专业'], ['graduation_school', '毕业学校'], ['graduation_date', '毕业日期']] as const
const scope = useState<string>('enterprise-cache-scope', () => '')
const open = ref(false)
const pending = ref(false)
const saving = ref(false)
const error = ref('')
const facts = ref<Record<string, Fact>>({})
const draft = reactive<Record<string, string>>({})
const version = ref(0)
const intent = createConsoleMutationIntent('people-private')
let epoch = 0
const url = computed(() => `/enterprise/api/apf/people/employees/${encodeURIComponent(props.uid)}/private-profile`)
async function load() {
  const current = ++epoch
  facts.value = {}
  for (const [key] of fields)
    draft[key] = ''
  version.value = 0
  if (!props.allowed || !scope.value || !open.value)
    return
  pending.value = true
  error.value = ''
  try {
    const response = await $fetch<{ data: { data: { row_version: number, fields: Record<string, Fact> } } }>(url.value)
    if (current !== epoch)
      return
    facts.value = response.data.data.fields
    version.value = response.data.data.row_version
    for (const [key] of fields)
      draft[key] = facts.value[key]?.value || ''
  } catch {
    if (current === epoch)
      error.value = '私密档案不可读取；请核对权限、员工范围和安装状态'
  } finally {
    if (current === epoch)
      pending.value = false
  }
}
async function save() {
  if (!props.allowed || !version.value || saving.value)
    return
  const body: Record<string, string | number> = { expectedVersion: version.value }
  for (const [key] of fields) {
    if (facts.value[key]?.readOnly || draft[key] === (facts.value[key]?.value || ''))
      continue
    body[key] = draft[key] || ''
  }
  if (Object.keys(body).length === 1)
    return
  if (body.id_number && !/^\d{17}[\dXx]$/.test(String(body.id_number))) {
    error.value = '身份证号须为 18 位有效格式；保留掩码不修改时不会提交'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const done = await intent.submit({ method: 'PATCH', path: url.value, body }, (request, key) => $fetch(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key } }))
    if (!done)
      return
    await load()
  } catch (e) {
    const status = Number((e as { statusCode?: number }).statusCode)
    error.value = status === 409 ? '版本已变化或字段由钉钉维护，请重新加载' : status === 400 ? '字段格式不正确，请检查日期与身份证号' : status === 403 || status === 404 ? '当前无权维护该员工私密档案' : '保存未确认，请重试同一意图'
  } finally {
    saving.value = false
  }
}
watch([() => props.uid, () => props.allowed, scope, open], () => {
  void load()
})
onScopeDispose(() => {
  epoch++
})
</script>

<template>
  <UButton
    v-if="allowed"
    color="neutral"
    variant="outline"
    @click="open = !open"
  >
    {{ open ? '收起私密档案' : '查看与维护私密档案' }}
  </UButton>
  <UCard v-if="open && allowed">
    <template #header>
      私密档案
    </template>
    <p class="text-sm text-muted mb-4">
      仅允许员工编辑权限及该员工范围内读取。身份证号始终掩码显示；钉钉管理字段只读。
    </p>
    <UAlert
      v-if="error"
      :title="error"
      color="error"
      class="mb-4"
    />
    <div
      v-if="pending"
      class="text-muted"
    >
      正在读取…
    </div>
    <form
      v-else-if="version"
      class="grid grid-cols-1 sm:grid-cols-2 gap-4"
      @submit.prevent="save"
    >
      <UFormField
        v-for="[key, label] in fields"
        :key="key"
        :label="label"
        :description="facts[key]?.source === 'dingtalk' ? '钉钉维护（只读）' : '人工维护'"
      >
        <UInput
          v-model="draft[key]"
          :disabled="facts[key]?.readOnly || saving"
          class="w-full"
          :type="key === 'birth_date' ? 'date' : 'text'"
          autocomplete="off"
        />
      </UFormField>
      <div class="sm:col-span-2 flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="outline"
          @click="load"
        >
          重新加载
        </UButton><UButton
          type="submit"
          :loading="saving"
        >
          保存私密档案
        </UButton>
      </div>
    </form>
  </UCard>
</template>

<script setup lang="ts">
import { productMemberInstant, productMemberLocalTime } from '../../utils/productMemberTime'

interface Member { id: number, uid: string, relation_type: string, status: string, valid_from: string, valid_until: string | null, revision: number }
const props = defineProps<{ productCode: string, workspaceRevision: number, member?: Member, revoke?: boolean }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const selected = ref(props.member ? [props.member.uid] : [])
const manager = ref<string[]>([])
const relation = ref(props.member?.relation_type || 'contributor')
const memberStatus = ref(props.member?.status || 'active')
const validFrom = ref(productMemberLocalTime(props.member?.valid_from || new Date().toISOString()))
const validUntil = ref(props.member?.valid_until ? productMemberLocalTime(props.member.valid_until) : '')
const fromInstant = computed(() => productMemberInstant(validFrom.value, props.member?.valid_from))
const untilInstant = computed(() => validUntil.value ? productMemberInstant(validUntil.value, props.member?.valid_until) : null)
const reason = ref('')
const busy = ref(false)
const error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '成员变更失败' })
const expectedRevision = props.workspaceRevision
const { confirm } = useConfirm()
let retry: { payload: string, key: string } | undefined
async function save() {
  if (busy.value) return
  error.value = null
  if (!selected.value[0] || !manager.value[0] || !reason.value.trim()) {
    error.value = new Error('请选择成员、继续负责的产品经理，并填写原因')
    return
  }
  const from = fromInstant.value, until = untilInstant.value
  if (!props.revoke && (!from || (validUntil.value && (!until || until <= from)))) {
    error.value = new Error('请输入实际存在的本地起止时间，结束时间须晚于开始时间')
    return
  }
  busy.value = true
  try {
    if (props.revoke && !(await confirm({ title: '撤销产品成员关系', message: `${props.member?.uid}\n原因：${reason.value.trim()}`, tone: 'warning', confirmLabel: '确认撤销' }))) return
    const body = {
      uid: selected.value[0], expectedRevision, expectedMemberRevision: props.member?.revision || 0,
      continuingManagerUid: manager.value[0], reason: reason.value.trim(),
      ...(!props.revoke ? { relationType: relation.value, status: memberStatus.value, validFrom: from, validUntil: until } : {})
    }
    const payload = JSON.stringify(body)
    if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
    const response = await $fetch<{ code: number }>(`/api/v1/products/${encodeURIComponent(props.productCode)}/members${props.member ? `/${props.member.id}` : ''}`, {
      method: props.revoke ? 'DELETE' : props.member ? 'PATCH' : 'POST', body, headers: { 'Idempotency-Key': retry.key }
    })
    if (response.code !== 0) throw new Error('成员变更结果不完整，请重试')
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('成员变更失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="space-y-3 rounded-lg border border-default p-4" @submit.prevent="save">
    <h3 class="font-medium">
      {{ revoke ? '撤销成员关系' : member ? '修改成员关系' : '新增产品成员' }}
    </h3>
    <UAlert v-if="alert" v-bind="alert" />
    <UFormField label="成员" required>
      <p v-if="member" class="text-sm">
        {{ member.uid }}
      </p>
      <UserTreeSelector
        v-else
        v-model="selected"
        selection-mode="single"
        :disabled="busy"
        width-class="w-full"
      />
    </UFormField>
    <template v-if="!revoke">
      <UFormField label="产品关系" required>
        <USelect v-model="relation" :disabled="busy" :items="[{ label: '产品经理', value: 'manager' }, { label: '贡献者', value: 'contributor' }, { label: '查看者', value: 'viewer' }]" />
      </UFormField>
      <UFormField label="记录状态" required>
        <USelect v-model="memberStatus" :disabled="busy" :items="[{ label: '启用', value: 'active' }, { label: '停用', value: 'inactive' }]" />
      </UFormField>
      <div class="flex flex-wrap gap-3">
        <UFormField label="生效时间（本地时间）" required>
          <UInput
            v-model="validFrom"
            type="datetime-local"
            step="0.001"
            :disabled="busy"
            required
          />
        </UFormField>
        <UFormField label="截止时间（留空为长期）">
          <UInput
            v-model="validUntil"
            type="datetime-local"
            step="0.001"
            :disabled="busy"
          />
        </UFormField>
      </div>
      <p class="text-xs text-muted">
        将保存的 UTC 时间：{{ fromInstant || '开始时间无效' }} 至 {{ validUntil ? untilInstant || '结束时间无效' : '长期有效' }}。新输入的夏令时重复时刻采用第一次出现的时间；未修改的已有时刻保持原值。
      </p>
    </template>
    <UFormField label="变更后继续负责的产品经理" required>
      <UserTreeSelector
        v-model="manager"
        selection-mode="single"
        :disabled="busy"
        width-class="w-full"
      />
    </UFormField>
    <p class="text-xs text-muted">
      所选经理必须在变更后仍具有当前有效的本产品经理关系，且目录用户有效。选择人员不会自动为其创建经理关系。
    </p>
    <UFormField label="变更原因" required>
      <UTextarea
        v-model="reason"
        :maxlength="2000"
        :disabled="busy"
        required
        class="w-full"
      />
    </UFormField>
    <div class="flex gap-2">
      <UButton type="submit" :loading="busy">
        {{ revoke ? '撤销关系' : '保存成员' }}
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="busy"
        @click="emit('cancel')"
      >
        取消
      </UButton>
    </div>
  </form>
</template>

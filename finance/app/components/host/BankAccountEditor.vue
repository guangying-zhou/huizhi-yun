<script setup lang="ts">
import type { BankAccount, BankAccountInput } from '../../types/hostFinance'
import { createHostFinanceClient, type FinanceFetch } from '../../utils/hostFinanceClient'
import { createFinanceIntent, financeWriteMessage } from '../../utils/hostFinanceForms'
import { accountW3Patch } from '../../utils/w3AccountForms'
import FinanceBusinessObjectSelect from './FinanceBusinessObjectSelect.vue'
import { useFinanceModule } from '../../../layer/useFinanceModule'

const props = defineProps<{
  account: BankAccount | null
  canEdit: boolean
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  saved: [
  ]
}>()
const { apiUrl } = useFinanceModule()
const api = createHostFinanceClient($fetch as FinanceFetch, apiUrl)
const toast = useToast()
const intent = createFinanceIntent()
const pending = ref(false)
const error = ref('')
const comparison = ref<BankAccount | null>(null)
const expectedVersion = ref(0)
async function refreshComparison() {
  if (!props.account || pending.value)
    return
  pending.value = true
  try {
    comparison.value = (await api.account(props.account.code)).data
  } catch {
    toast.add({ title: '最新账户资料暂不可用，请稍后重试', color: 'error' })
  } finally {
    pending.value = false
  }
}
function adoptVersion() {
  if (!comparison.value)
    return
  expectedVersion.value = comparison.value.row_version
  comparison.value = null
  error.value = ''
}
const form = reactive({ accountName: '', bankName: '', accountNoMasked: '', accountNoSecretRef: '', accountType: 'bank' as BankAccount['account_type'], currencyCode: 'CNY', ownerDeptCode: '', shortName: '', bankBranchCode: '', legalEntityCode: '', accountSubtype: '', sortNo: 0 })
const subtypeSelection = computed({ get: () => form.accountSubtype || 'unregistered', set: (value: string) => {
  form.accountSubtype = value === 'unregistered' ? '' : value
} })
const types = [{ label: '银行', value: 'bank' }, { label: '现金', value: 'cash' }, { label: '第三方支付', value: 'third_party' }, { label: '内部账户', value: 'internal' }]
watch(open, (value) => {
  if (!value)
    return
  const row = props.account
  comparison.value = null
  expectedVersion.value = row?.row_version || 0
  Object.assign(form, { accountName: row?.account_name || '', bankName: row?.bank_name || '', accountNoMasked: row?.account_no_masked || '', accountNoSecretRef: '', accountType: row?.account_type || 'bank', currencyCode: row?.currency_code || 'CNY', ownerDeptCode: row?.owner_dept_code || '', shortName: row?.short_name || '', bankBranchCode: row?.bank_branch_code || '', legalEntityCode: row?.legal_entity_code || '', accountSubtype: row?.account_subtype || '', sortNo: row?.sort_no || 0 })
  intent.reset()
  error.value = ''
})
async function submit() {
  if (pending.value || !props.canEdit)
    return
  if (!form.accountName.trim() || !/^[A-Z]{3}$/.test(form.currencyCode)) {
    error.value = '请填写账户名称和三位大写币种编码'
    return
  }
  if (form.accountNoMasked && /\d{8,}/.test(form.accountNoMasked)) {
    error.value = '请仅填写脱敏账号，不得包含连续八位以上数字'
    return
  }
  let extension: Partial<BankAccountInput>
  try {
    extension = accountW3Patch(form, props.account)
  } catch (failure) {
    error.value = (failure as Error).message
    return
  }
  const body: BankAccountInput = { ...extension, ...(Object.hasOwn(extension, 'accountSubtype') && form.accountType !== 'bank' ? { accountSubtype: null } : {}), accountName: form.accountName.trim(), bankName: form.bankName || null, accountNoMasked: form.accountNoMasked || null, accountType: form.accountType, currencyCode: form.currencyCode, ownerDeptCode: form.ownerDeptCode || null, ...(form.accountNoSecretRef.trim() ? { accountNoSecretRef: form.accountNoSecretRef.trim() } : {}) }
  const payload = props.account ? { ...body, expectedVersion: expectedVersion.value } : body
  const key = intent.key({ code: props.account?.code || null, ...payload })
  pending.value = true
  error.value = ''
  try {
    if (props.account)
      await api.updateAccount(props.account.code, payload as BankAccountInput & {
        expectedVersion: number
      }, key)
    else
      await api.createAccount(body, key)
    toast.add({ title: props.account ? '账户已更新' : '账户已新建', color: 'success' })
    open.value = false
    intent.reset()
    emit('saved')
  } catch (failure) {
    error.value = financeWriteMessage(failure)
    toast.add({ title: error.value, color: 'error' })
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="account ? `编辑账户：${account.account_name}` : '新建银行账户'"
    description="仅保存脱敏账号和 Console Vault 引用，不输入完整银行账号。"
    :dismissible="!pending"
    :close="!pending"
    :ui="{ content: 'w-full sm:max-w-2xl', wrapper: 'min-w-0 flex-1 pe-8', title: 'break-words' }"
  >
    <template #body>
      <form
        class="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2"
        @submit.prevent="submit"
      >
        <UFormField
          label="账户名称"
          required
        >
          <UInput
            v-model="form.accountName"
            maxlength="200"
            :disabled="pending || !canEdit"
            class="w-full"
          />
        </UFormField>
        <UFormField label="简称">
          <UInput
            v-model="form.shortName"
            maxlength="50"
            :disabled="pending || !canEdit"
            class="w-full"
          />
        </UFormField>
        <UFormField label="法人主体">
          <FinanceBusinessObjectSelect
            v-model="form.legalEntityCode"
            kind="legal-entities"
            :enabled="open && canEdit && !pending"
          />
        </UFormField>
        <UFormField label="开户行">
          <UInput
            v-model="form.bankName"
            maxlength="200"
            :disabled="pending || !canEdit"
            class="w-full"
          />
        </UFormField>
        <UFormField label="脱敏账号">
          <UInput
            v-model="form.accountNoMasked"
            placeholder="****1234"
            :disabled="pending || !canEdit"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Vault 引用"
          help="编辑时留空将保留原引用"
        >
          <UInput
            v-model="form.accountNoSecretRef"
            :disabled="pending || !canEdit"
            class="w-full"
          />
        </UFormField>
        <UFormField label="账户类型">
          <USelect
            v-model="form.accountType"
            :items="types"
            :disabled="pending || !canEdit"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="币种"
          required
        >
          <UInput
            v-model="form.currencyCode"
            maxlength="3"
            :disabled="pending || !canEdit"
            class="w-full"
          />
        </UFormField>
        <details class="space-y-3 sm:col-span-2">
          <summary class="cursor-pointer text-sm text-primary">
            更多账户资料
          </summary>
          <div class="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField label="行号">
              <UInput
                v-model="form.bankBranchCode"
                maxlength="30"
                :disabled="pending || !canEdit"
                class="w-full"
              />
            </UFormField>
            <UFormField label="银行账户子类型">
              <USelect
                v-model="subtypeSelection"
                :items="[{ label: '未登记', value: 'unregistered' }, { label: '基本户', value: 'basic' }, { label: '一般户', value: 'general' }, { label: '专户', value: 'special' }, { label: '贷款户', value: 'loan' }]"
                :disabled="pending || !canEdit || form.accountType !== 'bank'"
                class="w-full"
              />
            </UFormField>
            <UFormField label="排序号">
              <UInput
                v-model="form.sortNo"
                type="number"
                min="0"
                max="1000000"
                :disabled="pending || !canEdit"
                class="w-full"
              />
            </UFormField>
            <UFormField label="归属部门编码">
              <UInput
                v-model="form.ownerDeptCode"
                maxlength="64"
                :disabled="pending || !canEdit"
                class="w-full"
              />
            </UFormField>
          </div>
        </details>
        <UAlert
          v-if="error"
          color="error"
          :title="error"
          class="sm:col-span-2"
        >
          <template #actions>
            <UButton
              v-if="account"
              color="neutral"
              variant="outline"
              :loading="pending"
              @click="refreshComparison"
            >
              刷新比较（保留草稿）
            </UButton>
          </template>
        </UAlert>
        <div
          v-if="comparison"
          class="space-y-2 rounded-lg border border-warning p-3 sm:col-span-2"
        >
          <p class="break-words">
            最新 v{{ comparison.row_version }}：{{ comparison.account_name }} · {{ comparison.bank_name }} · {{ comparison.account_no_masked }} · {{ comparison.currency_code }} · {{ comparison.status }} · 简称：{{ comparison.short_name || '—' }} · 主体：{{ comparison.legal_entity_name || comparison.legal_entity_code || '—' }} · 行号：{{ comparison.bank_branch_code || '—' }} · 子类型：{{ comparison.account_subtype || '—' }} · 排序：{{ comparison.sort_no ?? '—' }}
          </p><UButton
            color="warning"
            class="whitespace-normal text-left"
            @click="adoptVersion"
          >
            已比较，沿用最新版本保存草稿
          </UButton>
        </div>
        <div class="flex gap-2 sm:col-span-2">
          <UButton
            type="submit"
            :loading="pending"
            :disabled="!canEdit"
          >
            保存
          </UButton><UButton
            color="neutral"
            variant="outline"
            :disabled="pending"
            @click="open = false"
          >
            取消
          </UButton>
        </div>
      </form>
    </template>
  </USlideover>
</template>

<script setup lang="ts">
import type { UpdateProjectRequest, AimsProject } from '~/types/aims'
import {
  methodologyOptions as methodologyOpts,
  projectSecurityLevelConfig,
  projectSecurityLevelOptions
} from '~/config/project'

const props = defineProps<{
  open: boolean
  project: AimsProject
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const projectStore = useProjectStore()
const portfolioStore = usePortfolioStore()
const { users: accountUsers } = useAccountUsers()
const { domains: businessDomains } = useBusinessDomains()

const saving = ref(false)
const nameError = ref('')
const deptError = ref('')

// 业务领域分类
const domainCategoryItems = [
  { label: '政务', value: '2G' },
  { label: '企业', value: '2B' },
  { label: '个人', value: '2C' }
]
const domainCategory = ref<'2G' | '2B' | '2C'>('2G')

const domainOptions = computed(() =>
  businessDomains.value
    .filter(d => d.category === domainCategory.value && d.parentCode !== null)
    .map(d => ({ label: d.domainName, value: d.domainCode }))
)

watch(domainCategory, () => {
  form.value.domainCode = ''
})

// 部门列表（仅当前用户有权限的部门）
const { accessibleDepartments, departmentOptions } = useAccessibleDepartments()
const departmentFlat = computed(() => accessibleDepartments.value)

// 用户选项（按部门过滤，含部门负责人/管理者）
const userOptions = computed(() => {
  const deptCode = form.value.deptCode
  const dept = deptCode ? departmentFlat.value.find(d => d.deptCode === deptCode) : null
  const deptHeadUids = new Set<string>()
  if (dept?.managerId) deptHeadUids.add(dept.managerId)
  const seen = new Set<string>()
  return accountUsers.value
    .filter((u) => {
      if (seen.has(u.uid)) return false
      seen.add(u.uid)
      if (deptCode) return u.deptCode === deptCode || deptHeadUids.has(u.uid)
      return true
    })
    .map(u => ({
      label: u.realName?.trim() || u.uid,
      uid: u.realName?.trim() && u.realName !== u.uid ? u.uid : undefined,
      value: u.uid
    }))
})

// 项目集选项
const portfolioOptions = computed(() => {
  const opts: { label: string, value: number | null }[] = [{ label: '不归属项目集', value: null }]
  for (const pf of portfolioStore.portfolios) {
    opts.push({ label: pf.name, value: pf.id })
  }
  return opts
})

// 表单
const form = ref<UpdateProjectRequest>({
  name: '',
  shortName: '',
  internalCode: '',
  description: '',
  methodology: 'PIVR',
  portfolioId: null,
  domainCode: '',
  leaderUid: '',
  deptCode: '',
  securityLevel: 'company',
  accessWhitelist: [],
  customerCode: '',
  customerName: '',
  oppId: null,
  contractId: null
})
const selectedSecurityLevelConfig = computed(() => projectSecurityLevelConfig[form.value.securityLevel || 'company'])
const accessWhitelist = computed({
  get: () => form.value.accessWhitelist || [],
  set: (value: string[]) => {
    form.value.accessWhitelist = value
  }
})

// 名称校验
function validateName(name: string) {
  nameError.value = ''
  if (!name) return
  const namePattern = /^[\u4e00-\u9fa5a-zA-Z0-9]+(?:[vV]\d+)?$/
  if (!namePattern.test(name)) {
    nameError.value = '只能包含汉字、英文和数字，不允许空格和特殊字符'
    return
  }
  if (/v\d+$/.test(name)) {
    form.value.name = name.replace(/v(\d+)$/, 'V$1')
    return
  }
  const vMatch = name.match(/V(\D+)$/)
  if (vMatch) {
    nameError.value = 'V后面只能带整数，如V2、V12'
  }
}

watch(() => form.value.name, val => validateName(val || ''))

function onDeptChange(deptCode: string | null) {
  form.value.deptCode = deptCode || ''
  deptError.value = ''
  // 部门变更时，如果当前负责人不在新部门中则清空
  if (deptCode && form.value.leaderUid) {
    const inDept = accountUsers.value.some(u => u.uid === form.value.leaderUid && u.deptCode === deptCode)
    if (!inDept) form.value.leaderUid = ''
  }
}

function onPortfolioChange(portfolioId: number | null) {
  form.value.portfolioId = portfolioId
  if (portfolioId) {
    const pf = portfolioStore.portfolios.find(p => p.id === portfolioId)
    if (pf?.domainCode) {
      form.value.domainCode = pf.domainCode
      const domain = businessDomains.value.find(d => d.domainCode === pf.domainCode)
      if (domain) domainCategory.value = domain.category as '2G' | '2B' | '2C'
    }
  }
}

function updateNullableNumberField(field: 'oppId' | 'contractId', value: number | string | undefined) {
  if (value === '' || value === undefined || value === null) {
    form.value[field] = null
    return
  }
  const parsedValue = typeof value === 'number' ? value : Number(value)
  form.value[field] = Number.isNaN(parsedValue) ? null : parsedValue
}

// 填充表单
function populateForm() {
  const p = props.project
  form.value = {
    name: p.name,
    shortName: p.shortName || '',
    internalCode: p.internalCode || '',
    description: p.description || '',
    methodology: p.methodology,
    portfolioId: p.portfolioId,
    domainCode: p.domainCode || '',
    leaderUid: p.leaderUid || '',
    deptCode: p.deptCode || '',
    securityLevel: p.securityLevel || 'company',
    accessWhitelist: p.accessWhitelist || [],
    customerCode: p.customerCode || '',
    customerName: p.customerName || '',
    oppId: p.oppId,
    contractId: p.contractId
  }
  if (p.domainCode) {
    const domain = businessDomains.value.find(d => d.domainCode === p.domainCode)
    if (domain) domainCategory.value = domain.category as '2G' | '2B' | '2C'
  }
  nameError.value = ''
  deptError.value = ''
}

watch(() => props.open, (isOpen) => {
  if (isOpen) populateForm()
})

// 保存
async function handleSave() {
  validateName(form.value.name || '')
  if (nameError.value) return
  if (!form.value.name) return
  if (!form.value.deptCode) {
    deptError.value = '请选择所属部门'
    return
  }

  saving.value = true
  try {
    await projectStore.updateProject(props.project.id, form.value)
    emit('saved')
    emit('update:open', false)
  } finally {
    saving.value = false
  }
}

const modalOpen = computed({
  get: () => props.open,
  set: (val: boolean) => emit('update:open', val)
})
</script>

<template>
  <UModal v-model:open="modalOpen">
    <template #header>
      <h3 class="text-lg font-semibold">
        编辑项目
      </h3>
    </template>
    <template #body>
      <div class="space-y-4">
        <UFormField label="项目名称" required :error="nameError">
          <UInput
            v-model="form.name"
            placeholder="汉字+英文+数字，可选版本号如V2"
            class="w-full"
          />
        </UFormField>
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="项目简称">
            <UInput
              v-model="form.shortName!"
              placeholder="项目简称"
              class="w-full"
            />
          </UFormField>
          <UFormField label="内部代号">
            <UInput
              v-model="form.internalCode!"
              placeholder="内部代号（可选）"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField label="项目描述">
          <UTextarea
            v-model="form.description!"
            class="w-full"
            :rows="3"
          />
        </UFormField>
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="项目管理方法论">
            <USelect
              v-model="(form.methodology as string)"
              :items="methodologyOpts"
              class="w-full"
            />
          </UFormField>
          <UFormField label="所属项目集">
            <USelect
              :model-value="form.portfolioId ?? null"
              :items="portfolioOptions"
              value-key="value"
              class="w-full"
              @update:model-value="onPortfolioChange"
            />
          </UFormField>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="所属部门" required :error="deptError">
            <USelectMenu
              :model-value="form.deptCode || undefined"
              :items="departmentOptions"
              value-key="value"
              label-key="label"
              placeholder="选择部门"
              class="w-full"
              searchable
              @update:model-value="onDeptChange"
            />
          </UFormField>
          <UFormField label="负责人">
            <USelectMenu
              :model-value="form.leaderUid ?? undefined"
              :items="userOptions"
              :filter-fields="['label', 'uid']"
              value-key="value"
              label-key="label"
              placeholder="请先选择部门"
              class="w-full"
              searchable
              :disabled="!form.deptCode"
              @update:model-value="form.leaderUid = $event"
            >
              <template #item-label="{ item }">
                {{ item.label }}
                <span
                  v-if="item.uid"
                  class="text-muted text-xs"
                >({{ item.uid }})</span>
              </template>
            </USelectMenu>
          </UFormField>
        </div>
        <UFormField label="业务领域">
          <div class="space-y-2">
            <URadioGroup
              v-model="domainCategory"
              :items="domainCategoryItems"
              orientation="horizontal"
              size="sm"
            />
            <USelectMenu
              v-model="(form.domainCode as string)"
              :items="domainOptions"
              value-key="value"
              label-key="label"
              placeholder="选择业务领域"
              class="w-full"
              searchable
            />
          </div>
        </UFormField>
        <UFormField label="可见范围">
          <div class="space-y-3 rounded-lg border border-default px-3 py-3">
            <USelect
              v-model="form.securityLevel"
              :items="projectSecurityLevelOptions"
              value-key="value"
              class="w-full"
            />
            <p class="text-xs text-muted">
              {{ selectedSecurityLevelConfig.description }}
            </p>
            <UserTreeSelector
              v-if="form.securityLevel === 'whitelist'"
              v-model="accessWhitelist"
              placeholder="选择白名单用户"
              width-class="w-full"
            />
          </div>
        </UFormField>
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="客户编码">
            <UInput
              v-model="form.customerCode!"
              placeholder="Altoc 客户编码"
              class="w-full"
            />
          </UFormField>
          <UFormField label="客户名称">
            <UInput
              v-model="form.customerName!"
              placeholder="客户名称"
              class="w-full"
            />
          </UFormField>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="关联商机 ID">
            <UInput
              :model-value="form.oppId ?? undefined"
              type="number"
              placeholder="Altoc 商机 ID"
              class="w-full"
              @update:model-value="updateNullableNumberField('oppId', $event)"
            />
          </UFormField>
          <UFormField label="关联合同 ID">
            <UInput
              :model-value="form.contractId ?? undefined"
              type="number"
              placeholder="Altoc 合同 ID"
              class="w-full"
              @update:model-value="updateNullableNumberField('contractId', $event)"
            />
          </UFormField>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="modalOpen = false"
        />
        <UButton
          label="保存"
          color="primary"
          :loading="saving"
          @click="handleSave"
        />
      </div>
    </template>
  </UModal>
</template>

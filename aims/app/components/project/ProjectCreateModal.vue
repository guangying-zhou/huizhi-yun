<script setup lang="ts">
import { pinyin } from 'pinyin-pro'
import { projectSecurityLevelConfig, projectSecurityLevelOptions } from '~/config/project'
import type {
  CreateProjectRequest,
  ProjectCategory
} from '~/types/aims'

const props = defineProps<{
  open: boolean
  portfolioId?: number
  portfolioLocked?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': [project: { id: number }]
}>()

const projectStore = useProjectStore()
const portfolioStore = usePortfolioStore()
const toast = useToast()
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const canCreateProjects = computed(() => hasPermission('projects', 'admin'))

// Account 用户列表（用于负责人选择）
const { users: accountUsers } = useAccountUsers()

// 业务领域字典
const { domains: businessDomains } = useBusinessDomains()

// 业务领域分类单选
const domainCategoryItems = [
  { label: '政务', value: '2G' },
  { label: '企业', value: '2B' },
  { label: '个人', value: '2C' }
]

// 项目弹窗的领域分类
const projectDomainCategory = ref<'2G' | '2B' | '2C'>('2G')

// 按分类过滤的领域子级选项
const projectDomainOptions = computed(() => {
  return businessDomains.value
    .filter(d => d.category === projectDomainCategory.value && d.parentCode !== null)
    .map(d => ({ label: d.domainName, value: d.domainCode }))
})

// 切换分类时清空已选的领域
watch(projectDomainCategory, () => {
  createForm.value.domainCode = ''
})

// 部门列表（仅当前用户有权限的部门）
const { accessibleDepartments, departmentOptions } = useAccessibleDepartments()
const departmentFlat = computed(() => accessibleDepartments.value)

// 用户选项（按部门过滤，含部门负责人/管理者）
const userOptions = computed(() => {
  const deptCode = createForm.value.deptCode
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

// 新建项目表单
const createForm = ref<CreateProjectRequest>({
  projectCode: '',
  name: '',
  shortName: '',
  description: '',
  category: 'product_dev',
  methodology: 'PIVR',
  deptCode: '',
  leaderUid: '',
  securityLevel: 'company',
  accessWhitelist: [],
  startDate: '',
  endDate: ''
})

// 项目名称校验规则
const projectNameError = ref('')
const projectCodeError = ref('')
const deptError = ref('')
const projectCodeManuallyEdited = ref(false)
let duplicateCheckTimer: ReturnType<typeof setTimeout> | null = null
const creating = ref(false)
const selectedSecurityLevelConfig = computed(() => projectSecurityLevelConfig[createForm.value.securityLevel || 'company'])
const createAccessWhitelist = computed({
  get: () => createForm.value.accessWhitelist || [],
  set: (value: string[]) => {
    createForm.value.accessWhitelist = value
  }
})

const categoryOptions = [
  { label: '产品研发', value: 'product_dev' },
  { label: '定制开发', value: 'custom_dev' },
  { label: '交付实施', value: 'delivery' },
  { label: '运维保障', value: 'maintenance' },
  { label: '销售', value: 'sales' },
  { label: '售前', value: 'presales' },
  { label: '改进', value: 'improvement' },
  { label: '合规', value: 'compliance' }
]

// 项目集选择选项
const portfolioAssignOptions = computed(() => {
  const opts: { label: string, value: number | null }[] = [
    { label: '不归属任何项目集', value: null }
  ]
  for (const pf of portfolioStore.portfolios) {
    opts.push({ label: pf.isProductLine ? `${pf.name} · 产品线` : pf.name, value: pf.id })
  }
  return opts
})

const selectedCreatePortfolio = computed(() => {
  if (createForm.value.portfolioId == null) return null
  return portfolioStore.portfolios.find(pf => pf.id === createForm.value.portfolioId) || null
})

const isCreatePortfolioProductLine = computed(() => selectedCreatePortfolio.value?.isProductLine === true)

watch(selectedCreatePortfolio, (portfolio) => {
  if (portfolio?.isProductLine) {
    createForm.value.category = 'product_dev'
  }
})

/**
 * 校验项目名称并自动生成编码
 */
function validateAndGenerateCode(name: string) {
  projectNameError.value = ''

  if (!name) {
    createForm.value.projectCode = ''
    return
  }

  // 校验：只允许汉字、英文、数字，可选尾部版本号
  const namePattern = /^[\u4e00-\u9fa5a-zA-Z0-9]+(?:[vV]\d+)?$/
  if (!namePattern.test(name)) {
    projectNameError.value = '只能包含汉字、英文和数字，不允许空格和特殊字符，可选尾部版本号如V2'
    return
  }

  // v 自动转 V
  if (/v\d+$/.test(name)) {
    createForm.value.name = name.replace(/v(\d+)$/, 'V$1')
    return // watch 会再次触发
  }

  // V后面只能带整数
  const vMatch = name.match(/V(\D+)$/)
  if (vMatch) {
    projectNameError.value = 'V后面只能带整数，如V2、V12'
    return
  }

  // 自动生成编码（用户没手动改过时才覆盖）
  if (!projectCodeManuallyEdited.value) {
    createForm.value.projectCode = generateProjectCode(name)
  }

  // 防抖检查重名
  if (duplicateCheckTimer) clearTimeout(duplicateCheckTimer)
  duplicateCheckTimer = setTimeout(() => checkDuplicate(), 500)
}

/**
 * 汉语拼音首字母大写 + 版本号
 */
function generateProjectCode(name: string): string {
  // 提取版本号
  const versionMatch = name.match(/V(\d+)$/)
  const version = versionMatch ? versionMatch[1] : ''
  const baseName = versionMatch ? name.slice(0, -versionMatch[0].length) : name

  // 取拼音首字母，过滤非字母字符
  const initials = pinyin(baseName, { pattern: 'first', toneType: 'none', type: 'array' })
    .map(s => s.replace(/[^a-zA-Z]/g, '').toUpperCase())
    .filter(Boolean)
    .join('')

  return version ? `${initials}${version}` : initials
}

/**
 * 项目编码手动修改时标记
 */
function onProjectCodeInput(value: string) {
  projectCodeManuallyEdited.value = true

  // 先校验是否含非法字符
  if (/[^a-zA-Z0-9]/.test(value)) {
    projectCodeError.value = '只能包含英文字母和数字，不允许特殊字符'
  } else {
    projectCodeError.value = ''
  }

  // 转大写存入
  createForm.value.projectCode = value.toUpperCase()

  if (duplicateCheckTimer) clearTimeout(duplicateCheckTimer)
  duplicateCheckTimer = setTimeout(() => checkDuplicate(), 500)
}

/**
 * 检查重名
 */
async function checkDuplicate() {
  // 只清除重名类错误，不覆盖格式校验错误
  if (projectNameError.value === '该项目名称已存在') projectNameError.value = ''
  if (projectCodeError.value === '该项目编码已存在') projectCodeError.value = ''

  const { name, projectCode } = createForm.value
  if (!name && !projectCode) return

  try {
    const res = await $fetch<{ code: number, data: { nameExists: boolean, codeExists: boolean } }>(
      '/api/v1/projects/check-duplicate',
      { params: { name: name || undefined, projectCode: projectCode || undefined } }
    )
    if (res.code === 0) {
      if (res.data.nameExists && !projectNameError.value) projectNameError.value = '该项目名称已存在'
      if (res.data.codeExists && !projectCodeError.value) projectCodeError.value = '该项目编码已存在'
    }
  } catch {
    // 静默失败，不阻塞用户操作
  }
}

watch(() => createForm.value.name, (val) => {
  validateAndGenerateCode(val)
})

/**
 * 选择项目集时，带入项目集的业务领域
 */
function onPortfolioSelect(portfolioId: number | null) {
  createForm.value.portfolioId = portfolioId
  if (portfolioId) {
    const pf = portfolioStore.portfolios.find(p => p.id === portfolioId)
    if (pf?.domainCode) {
      createForm.value.domainCode = pf.domainCode
      // 同步切换业务领域分类单选
      const domain = businessDomains.value.find(d => d.domainCode === pf.domainCode)
      if (domain) {
        projectDomainCategory.value = domain.category as '2G' | '2B' | '2C'
      }
    }
  }
}

/**
 * 部门变更时清空不属于新部门的负责人
 */
function onDeptChange(deptCode: string | null) {
  createForm.value.deptCode = deptCode || ''
  deptError.value = ''
  if (deptCode && createForm.value.leaderUid) {
    const inDept = accountUsers.value.some(u => u.uid === createForm.value.leaderUid && u.deptCode === deptCode)
    if (!inDept) createForm.value.leaderUid = ''
  }
}

/**
 * 创建项目
 */
async function handleCreateProject() {
  if (!permissionsLoaded.value) {
    await loadPermissions()
  }
  if (!canCreateProjects.value) {
    toast.add({ title: '需要 AIMS 项目管理权限才可以创建项目', color: 'warning' })
    return
  }

  const { name, projectCode } = createForm.value
  if (!name || !projectCode) return

  // 保存前格式终检
  const namePattern = /^[\u4e00-\u9fa5a-zA-Z0-9]+(?:V\d+)?$/
  if (!namePattern.test(name)) {
    projectNameError.value = '只能包含汉字、英文和数字，不允许空格和特殊字符'
    return
  }
  if (/[^A-Z0-9]/i.test(projectCode)) {
    projectCodeError.value = '只能包含英文字母和数字，不允许特殊字符'
    return
  }

  if (!createForm.value.deptCode) {
    deptError.value = '请选择所属部门'
    return
  }

  // 已有校验错误则阻止
  if (projectNameError.value || projectCodeError.value) return

  // 同步检查重名
  await checkDuplicate()
  if (projectNameError.value || projectCodeError.value) return

  creating.value = true
  try {
    const payload: CreateProjectRequest = {
      ...createForm.value,
      category: isCreatePortfolioProductLine.value ? 'product_dev' : createForm.value.category
    }
    const project = await projectStore.createProject(payload)
    emit('update:open', false)
    resetProjectForm()
    emit('created', { id: project.id })
  } finally {
    creating.value = false
  }
}

/**
 * 重置表单
 */
function resetProjectForm() {
  createForm.value = {
    projectCode: '',
    name: '',
    shortName: '',
    description: '',
    category: 'product_dev',
    methodology: 'PIVR',
    portfolioId: null,
    deptCode: '',
    leaderUid: '',
    securityLevel: 'company',
    accessWhitelist: [],
    startDate: '',
    endDate: ''
  }
  projectNameError.value = ''
  projectCodeError.value = ''
  projectCodeManuallyEdited.value = false
  deptError.value = ''
}

// 当 props.portfolioId 变化时初始化表单
watch(() => props.portfolioId, (id) => {
  if (id != null) {
    createForm.value.portfolioId = id
    // 联动业务领域
    const pf = portfolioStore.portfolios.find(p => p.id === id)
    if (pf?.domainCode) {
      createForm.value.domainCode = pf.domainCode
      const domain = businessDomains.value.find(d => d.domainCode === pf.domainCode)
      if (domain) projectDomainCategory.value = domain.category as '2G' | '2B' | '2C'
    }
  }
}, { immediate: true })

// 弹窗关闭时重置表单
watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    resetProjectForm()
  }
})

const modalOpen = computed({
  get: () => props.open,
  set: (val: boolean) => emit('update:open', val)
})
</script>

<template>
  <UModal v-model:open="modalOpen">
    <template #header>
      <h3 class="text-lg font-semibold">
        新建项目
      </h3>
    </template>
    <template #body>
      <div class="space-y-4">
        <UFormField label="项目名称" required :error="projectNameError">
          <UInput
            v-model="createForm.name"
            placeholder="汉字+英文+数字，可选版本号如V2"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="项目编码"
          required
          :error="projectCodeError"
          description="根据名称自动生成，可手动修改"
        >
          <UInput
            :model-value="createForm.projectCode"
            placeholder="自动生成"
            class="w-full font-mono"
            @update:model-value="onProjectCodeInput"
          />
        </UFormField>
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="所属项目集">
            <USelect
              :model-value="createForm.portfolioId ?? null"
              :items="portfolioAssignOptions"
              value-key="value"
              placeholder="选择项目集（可选）"
              class="w-full"
              :disabled="portfolioLocked"
              @update:model-value="onPortfolioSelect($event)"
            />
          </UFormField>
          <UFormField label="项目类别">
            <div class="space-y-2">
              <USelect
                v-model="(createForm.category as ProjectCategory)"
                :items="categoryOptions"
                value-key="value"
                placeholder="选择项目类别"
                class="w-full"
                :disabled="isCreatePortfolioProductLine"
              />
              <p
                v-if="isCreatePortfolioProductLine"
                class="text-xs text-primary"
              >
                当前项目集已设为产品线，项目类别自动固定为"产品研发"。
              </p>
            </div>
          </UFormField>
        </div>
        <UFormField label="业务领域">
          <div class="space-y-2">
            <URadioGroup
              v-model="projectDomainCategory"
              :items="domainCategoryItems"
              orientation="horizontal"
              size="sm"
            />
            <USelectMenu
              v-model="(createForm.domainCode as string)"
              :items="projectDomainOptions"
              value-key="value"
              label-key="label"
              placeholder="选择业务领域"
              class="w-full"
              searchable
            />
          </div>
        </UFormField>
        <UFormField label="项目描述">
          <UTextarea
            v-model="(createForm.description as string)"
            placeholder="输入项目描述"
            class="w-full"
          />
        </UFormField>
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="所属部门" required :error="deptError">
            <USelectMenu
              :model-value="createForm.deptCode || undefined"
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
              :model-value="createForm.leaderUid ?? undefined"
              :items="userOptions"
              :filter-fields="['label', 'uid']"
              value-key="value"
              label-key="label"
              placeholder="请先选择部门"
              class="w-full"
              searchable
              :disabled="!createForm.deptCode"
              @update:model-value="createForm.leaderUid = $event"
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
        <UFormField label="可见范围">
          <div class="space-y-3 rounded-lg border border-default px-3 py-3">
            <USelect
              v-model="createForm.securityLevel"
              :items="projectSecurityLevelOptions"
              value-key="value"
              class="w-full"
            />
            <p class="text-xs text-muted">
              {{ selectedSecurityLevelConfig.description }}
            </p>
            <UserTreeSelector
              v-if="createForm.securityLevel === 'whitelist'"
              v-model="createAccessWhitelist"
              placeholder="选择白名单用户"
              width-class="w-full"
            />
          </div>
        </UFormField>
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="开始日期">
            <UInput
              v-model="(createForm.startDate as string)"
              type="date"
              class="w-full"
            />
          </UFormField>
          <UFormField label="结束日期">
            <UInput
              v-model="(createForm.endDate as string)"
              type="date"
              class="w-full"
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
          label="创建"
          color="primary"
          :loading="creating"
          :disabled="!canCreateProjects"
          @click="handleCreateProject"
        />
      </div>
    </template>
  </UModal>
</template>

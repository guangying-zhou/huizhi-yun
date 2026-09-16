<script setup lang="ts">
import { pinyin } from 'pinyin-pro'
import type { CreatePortfolioRequest, ProjectCategory } from '~/types/aims'
// 项目集默认分类的可选范围与项目创建入口一致：排除已停用的 improvement，
// 以及 routine（日常事务项目集系统预置、全局唯一，不由用户创建）
import { selectableProjectCategoryOptions as portfolioDefaultCategoryOptions } from '~/config/project'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': [portfolio: { id: number }]
}>()

const portfolioStore = usePortfolioStore()
const toast = useToast()
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const { users: accountUsers } = useAccountUsers()
const { tree: gitGroupTree } = useAccountGitGroups()

const creating = ref(false)
const codeManuallyEdited = ref(false)
const form = ref<CreatePortfolioRequest>(createEmptyForm())

const canCreatePortfolios = computed(() => hasPermission('admin', 'admin'))

const modalOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const userOptions = computed(() => {
  const seen = new Set<string>()
  return accountUsers.value
    .filter((user) => {
      if (seen.has(user.uid)) return false
      seen.add(user.uid)
      return true
    })
    .map(user => ({
      label: user.realName?.trim() || user.uid,
      uid: user.realName?.trim() && user.realName !== user.uid ? user.uid : undefined,
      value: user.uid
    }))
})

const userMap = computed(() => {
  const map = new Map<string, typeof accountUsers.value[number]>()
  for (const user of accountUsers.value) {
    if (!map.has(user.uid)) map.set(user.uid, user)
  }
  return map
})

function createEmptyForm(): CreatePortfolioRequest {
  return {
    code: '',
    name: '',
    description: '',
    domainCode: '',
    ownerUid: '',
    deptCode: '',
    gitGroup: '',
    defaultCategory: undefined as ProjectCategory | undefined,
    displayOrder: 0
  }
}

function normalizeDisplayOrder(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

function generatePortfolioCode(name: string) {
  const initials = pinyin(name, { pattern: 'first', toneType: 'none', type: 'array' })
    .map(item => item.replace(/[^a-zA-Z]/g, '').toUpperCase())
    .filter(Boolean)
    .join('')
  return initials ? `C-${initials}` : ''
}

function onNameInput(value: string | number) {
  const name = String(value ?? '')
  form.value.name = name
  if (!codeManuallyEdited.value) {
    form.value.code = generatePortfolioCode(name)
  }
}

function onCodeInput(value: string | number) {
  codeManuallyEdited.value = true
  const upper = String(value ?? '').toUpperCase()
  form.value.code = upper.startsWith('C-') ? upper : `C-${upper.replace(/^C-?/i, '')}`
}

function onOwnerChange(uid: string | null) {
  form.value.ownerUid = uid
  form.value.deptCode = uid ? (userMap.value.get(uid)?.deptCode || '') : ''
}

function resetForm() {
  form.value = createEmptyForm()
  codeManuallyEdited.value = false
}

async function createPortfolio() {
  if (!permissionsLoaded.value) {
    await loadPermissions()
  }
  if (!canCreatePortfolios.value) {
    toast.add({ title: '仅系统管理员可以创建项目集', color: 'warning' })
    return
  }

  creating.value = true
  try {
    form.value.displayOrder = normalizeDisplayOrder(form.value.displayOrder)
    const portfolio = await portfolioStore.createPortfolio(form.value)
    emit('update:open', false)
    resetForm()
    emit('created', portfolio)
  } catch (error: unknown) {
    const candidate = error as { data?: { message?: string }, message?: string }
    toast.add({
      title: '创建项目集失败',
      description: candidate.data?.message || candidate.message || '请稍后重试',
      color: 'error'
    })
  } finally {
    creating.value = false
  }
}

watch(() => props.open, (open) => {
  if (!open) resetForm()
})
</script>

<template>
  <UModal v-model:open="modalOpen">
    <template #header>
      <h3 class="text-lg font-semibold">
        新建项目集
      </h3>
    </template>
    <template #body>
      <div class="space-y-4">
        <UFormField label="项目集名称" required>
          <UInput
            :model-value="form.name"
            placeholder="如：智慧城市系列"
            class="w-full"
            @update:model-value="onNameInput"
          />
        </UFormField>
        <UFormField label="项目集编码" required description="自动生成，可手动修改。以 C- 开头，全大写字母">
          <UInput
            :model-value="form.code"
            placeholder="如：C-ZHCS"
            class="w-full font-mono"
            @update:model-value="onCodeInput"
          />
        </UFormField>
        <UFormField label="显示顺序" description="数字越小越靠前">
          <UInput
            :model-value="String(form.displayOrder ?? 0)"
            type="number"
            min="0"
            step="1"
            placeholder="0"
            class="w-full"
            @update:model-value="value => form.displayOrder = normalizeDisplayOrder(value)"
          />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="负责人">
            <USelectMenu
              :model-value="form.ownerUid ?? undefined"
              :items="userOptions"
              :filter-fields="['label', 'uid']"
              value-key="value"
              label-key="label"
              placeholder="选择负责人"
              class="w-full"
              searchable
              @update:model-value="onOwnerChange"
            >
              <template #item-label="{ item }">
                {{ item.label }}
                <span v-if="item.uid" class="text-xs text-muted">({{ item.uid }})</span>
              </template>
            </USelectMenu>
          </UFormField>
          <UFormField label="所属部门">
            <UInput
              :model-value="form.deptCode as string"
              placeholder="根据负责人自动填充"
              class="w-full"
              disabled
            />
          </UFormField>
        </div>
        <UFormField label="默认项目分类" help="归属该项目集的新项目会预设为此分类，创建时仍可调整。留空表示不预设。">
          <USelectMenu
            v-model="form.defaultCategory"
            :items="portfolioDefaultCategoryOptions"
            value-key="value"
            placeholder="不预设"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Git群组">
          <GitGroupTreeSelector
            v-model="form.gitGroup as string"
            :tree="gitGroupTree"
            placeholder="选择 GitLab 群组"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
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
          @click="createPortfolio"
        />
      </div>
    </template>
  </UModal>
</template>

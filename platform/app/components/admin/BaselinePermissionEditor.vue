<script setup lang="ts">
interface BaselinePermissionItem {
  appCode: string
  resourceCode: string
  action: string
  scopeType: string
  scopeValue: string
  description?: string | null
}

interface AvailableBaselinePermissionItem {
  appCode: string
  resourceCode: string
  resourceName: string | null
  action: string
  actionName: string | null
  actionCode: string
}

interface BaselineExcludedSubjectItem {
  subjectCode: string
  displayName: string | null
  reason: string | null
  status?: string
}

interface AvailableExcludedSubjectItem {
  subjectCode: string
  displayName: string | null
  tenantCount: number
  status: string
}

const props = defineProps<{
  availablePermissions: AvailableBaselinePermissionItem[]
  availableExcludedSubjects: AvailableExcludedSubjectItem[]
  pending: boolean
  saving: boolean
}>()

const emit = defineEmits<{
  save: []
  invalid: [message: string]
}>()

const permissions = defineModel<BaselinePermissionItem[]>('permissions', { required: true })
const excludedSubjects = defineModel<BaselineExcludedSubjectItem[]>('excludedSubjects', { required: true })

const MANUAL_EXCLUDED_SUBJECT_KEY = '__manual__'
const scopeTypeItems = [
  { label: '租户', value: 'tenant' },
  { label: '本人', value: 'subject' },
  { label: '关系', value: 'relation' },
  { label: '部门', value: 'department' },
  { label: '项目', value: 'project' },
  { label: '客户', value: 'customer' },
  { label: '对象', value: 'object' }
]

const selectedAvailablePermissionKey = ref('')
const selectedExcludedSubjectKey = ref(MANUAL_EXCLUDED_SUBJECT_KEY)
const permissionForm = reactive({
  appCode: '',
  resourceCode: '',
  action: '',
  scopeType: 'subject',
  scopeValue: 'self',
  description: ''
})
const exclusionForm = reactive({
  subjectCode: '',
  displayName: '',
  reason: ''
})

const permissionKeySet = computed(() => new Set(permissions.value.map(permissionKey)))
const permissionsByApp = computed(() => {
  const groups = new Map<string, BaselinePermissionItem[]>()
  for (const permission of permissions.value) {
    const items = groups.get(permission.appCode) || []
    items.push(permission)
    groups.set(permission.appCode, items)
  }

  return [...groups.entries()]
    .map(([appCode, items]) => ({
      appCode,
      items: items.sort((left, right) =>
        left.resourceCode.localeCompare(right.resourceCode)
        || left.action.localeCompare(right.action)
        || left.scopeType.localeCompare(right.scopeType)
        || left.scopeValue.localeCompare(right.scopeValue)
      )
    }))
    .sort((left, right) => left.appCode.localeCompare(right.appCode))
})
const availablePermissionItems = computed(() => props.availablePermissions.map(item => ({
  label: `${item.appCode} / ${item.resourceCode} / ${item.action}`,
  value: availablePermissionKey(item)
})))
const availableExcludedSubjectItems = computed(() => [
  { label: '手动输入 UID', value: MANUAL_EXCLUDED_SUBJECT_KEY },
  ...props.availableExcludedSubjects.map(item => ({
    label: `${item.displayName || item.subjectCode} (${item.subjectCode})`,
    value: item.subjectCode
  }))
])

function availablePermissionKey(permission: Pick<AvailableBaselinePermissionItem, 'appCode' | 'resourceCode' | 'action'>) {
  return `${permission.appCode}:${permission.resourceCode}:${permission.action}`
}

function permissionKey(permission: Pick<BaselinePermissionItem, 'appCode' | 'resourceCode' | 'action' | 'scopeType' | 'scopeValue'>) {
  return `${permission.appCode}:${permission.resourceCode}:${permission.action}:${permission.scopeType}:${permission.scopeValue}`
}

function permissionText(permission: BaselinePermissionItem) {
  return `${permission.appCode} / ${permission.resourceCode} / ${permission.action}`
}

function scopeText(permission: BaselinePermissionItem) {
  return `${permission.scopeType}:${permission.scopeValue}`
}

function applyAvailablePermission(value: string) {
  const item = props.availablePermissions.find(permission => availablePermissionKey(permission) === value)
  if (!item) return
  permissionForm.appCode = item.appCode
  permissionForm.resourceCode = item.resourceCode
  permissionForm.action = item.action
}

function applyExcludedSubject(value: string) {
  if (!value || value === MANUAL_EXCLUDED_SUBJECT_KEY) return
  const item = props.availableExcludedSubjects.find(subject => subject.subjectCode === value)
  if (!item) return
  exclusionForm.subjectCode = item.subjectCode
  exclusionForm.displayName = item.displayName || item.subjectCode
}

function addPermission() {
  const permission = {
    appCode: permissionForm.appCode.trim(),
    resourceCode: permissionForm.resourceCode.trim(),
    action: permissionForm.action.trim(),
    scopeType: permissionForm.scopeType.trim(),
    scopeValue: permissionForm.scopeValue.trim(),
    description: permissionForm.description.trim() || null
  }

  if (!permission.appCode || !permission.resourceCode || !permission.action || !permission.scopeType || !permission.scopeValue) {
    emit('invalid', '默认登录权限的 app、resource、action 和 scope 不能为空')
    return
  }

  if (permissionKeySet.value.has(permissionKey(permission))) {
    emit('invalid', '默认登录权限已存在')
    return
  }

  permissions.value = [...permissions.value, permission]
  permissionForm.description = ''
}

function removePermission(permission: BaselinePermissionItem) {
  const key = permissionKey(permission)
  permissions.value = permissions.value.filter(item => permissionKey(item) !== key)
}

function addExcludedSubject() {
  const subjectCode = exclusionForm.subjectCode.trim()
  if (!subjectCode) {
    emit('invalid', '排除用户 UID 不能为空')
    return
  }
  if (excludedSubjects.value.some(item => item.subjectCode === subjectCode)) {
    emit('invalid', '排除用户已存在')
    return
  }

  excludedSubjects.value = [
    ...excludedSubjects.value,
    {
      subjectCode,
      displayName: exclusionForm.displayName.trim() || null,
      reason: exclusionForm.reason.trim() || null,
      status: 'active'
    }
  ]
  exclusionForm.subjectCode = ''
  exclusionForm.displayName = ''
  exclusionForm.reason = ''
  selectedExcludedSubjectKey.value = MANUAL_EXCLUDED_SUBJECT_KEY
}

function removeExcludedSubject(subjectCode: string) {
  excludedSubjects.value = excludedSubjects.value.filter(item => item.subjectCode !== subjectCode)
}

watch(selectedAvailablePermissionKey, applyAvailablePermission)
watch(selectedExcludedSubjectKey, applyExcludedSubject)
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="font-medium text-highlighted">
            默认登录权限
          </div>
          <p class="mt-0.5 text-sm text-muted">
            所有登录用户默认获得；排除用户不会获得这些 baseline 权限。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <div class="text-right text-xs text-muted">
            <div>{{ permissions.length }} 项权限</div>
            <div>{{ excludedSubjects.length }} 个排除用户</div>
          </div>
          <UButton
            color="primary"
            icon="i-lucide-save"
            :loading="saving"
            @click="emit('save')"
          >
            保存
          </UButton>
        </div>
      </div>
    </template>

    <UEmpty
      v-if="pending && permissions.length === 0"
      icon="i-lucide-loader-circle"
      title="加载默认登录权限中"
      class="py-10"
    />

    <div
      v-else
      class="space-y-4"
    >
      <div
        v-if="permissionsByApp.length === 0"
        class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted"
      >
        当前未配置默认登录权限。
      </div>

      <div
        v-for="group in permissionsByApp"
        :key="group.appCode"
        class="space-y-2"
      >
        <div class="mono text-xs font-medium text-muted">
          {{ group.appCode }}
        </div>
        <div class="grid gap-2 md:grid-cols-2">
          <div
            v-for="permission in group.items"
            :key="permissionKey(permission)"
            class="flex items-start justify-between gap-3 rounded-lg border border-default px-3 py-2 text-sm"
          >
            <div class="min-w-0">
              <div class="font-medium text-highlighted">
                {{ permissionText(permission) }}
              </div>
              <div class="mono mt-1 text-xs text-dimmed">
                {{ scopeText(permission) }}
              </div>
              <div
                v-if="permission.description"
                class="mt-1 text-xs text-muted"
              >
                {{ permission.description }}
              </div>
            </div>
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              size="xs"
              square
              @click="removePermission(permission)"
            />
          </div>
        </div>
      </div>

      <div class="grid gap-3 rounded-lg border border-default p-3 md:grid-cols-5">
        <UFormField
          label="权限"
          class="md:col-span-2"
        >
          <USelect
            v-model="selectedAvailablePermissionKey"
            :items="availablePermissionItems"
            class="w-full"
            placeholder="选择 manifest 权限"
          />
        </UFormField>
        <UFormField label="app">
          <UInput
            v-model="permissionForm.appCode"
            class="w-full"
            placeholder="codocs"
          />
        </UFormField>
        <UFormField label="resource">
          <UInput
            v-model="permissionForm.resourceCode"
            class="w-full"
            placeholder="documents"
          />
        </UFormField>
        <UFormField label="action">
          <UInput
            v-model="permissionForm.action"
            class="w-full"
            placeholder="view"
          />
        </UFormField>
        <UFormField label="scope">
          <USelect
            v-model="permissionForm.scopeType"
            :items="scopeTypeItems"
            class="w-full"
          />
        </UFormField>
        <UFormField label="scopeValue">
          <UInput
            v-model="permissionForm.scopeValue"
            class="w-full"
            placeholder="self"
          />
        </UFormField>
        <UFormField
          label="描述"
          class="md:col-span-2"
        >
          <UInput
            v-model="permissionForm.description"
            class="w-full"
            placeholder="权限说明"
          />
        </UFormField>
        <div class="flex items-end">
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-plus"
            block
            @click="addPermission"
          >
            添加权限
          </UButton>
        </div>
      </div>

      <div class="space-y-3 rounded-lg border border-default p-3">
        <div class="font-medium text-highlighted">
          排除用户
        </div>
        <div
          v-if="excludedSubjects.length"
          class="flex flex-wrap gap-2"
        >
          <UBadge
            v-for="subject in excludedSubjects"
            :key="subject.subjectCode"
            color="warning"
            variant="soft"
            class="gap-1"
          >
            <span>{{ subject.displayName || subject.subjectCode }}</span>
            <span class="mono text-dimmed">{{ subject.subjectCode }}</span>
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              size="xs"
              square
              @click="removeExcludedSubject(subject.subjectCode)"
            />
          </UBadge>
        </div>
        <div
          v-else
          class="text-sm text-muted"
        >
          未排除用户。
        </div>
        <div class="grid gap-3 md:grid-cols-5">
          <UFormField label="选择用户">
            <USelect
              v-model="selectedExcludedSubjectKey"
              :items="availableExcludedSubjectItems"
              class="w-full"
              placeholder="从同步用户中选择"
            />
          </UFormField>
          <UFormField label="用户 UID">
            <UInput
              v-model="exclusionForm.subjectCode"
              class="w-full"
              placeholder="uid"
            />
          </UFormField>
          <UFormField label="显示名">
            <UInput
              v-model="exclusionForm.displayName"
              class="w-full"
              placeholder="可选"
            />
          </UFormField>
          <UFormField label="原因">
            <UInput
              v-model="exclusionForm.reason"
              class="w-full"
              placeholder="可选"
            />
          </UFormField>
          <div class="flex items-end">
            <UButton
              color="neutral"
              variant="soft"
              icon="i-lucide-user-minus"
              block
              @click="addExcludedSubject"
            >
              排除用户
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>

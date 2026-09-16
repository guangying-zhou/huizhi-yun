<script setup lang="ts">
definePageMeta({
  layout: 'platform'
})

usePageTitle('新建应用权限角色')

type RoleStatus = 'active' | 'suspended' | 'disabled'

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface ApplicationItem {
  appCode: string
  appName: string
}

interface ApplicationListResponse {
  items: ApplicationItem[]
}

interface ResourceAction {
  id: number
  action: string
  actionCode: string
  actionName: string | null
  description: string | null
  requiresGrant: boolean
}

interface ResourceItem {
  appCode: string
  resourceCode: string
  resourceName: string
  actions: ResourceAction[]
}

interface ResourceListResponse {
  items: ResourceItem[]
}

interface PermissionActionItem {
  manifestActionId: number
  appCode: string
  resourceCode: string
  resourceName: string
  action: string
  actionCode: string
  actionName: string | null
  description: string | null
}

interface FetchLikeError extends Error {
  statusCode?: number
  status?: number
  data?: {
    message?: string
    statusMessage?: string
  }
}

const router = useRouter()
const toast = useToast()
const pending = ref(false)
const actionPending = ref(false)
const actionError = ref('')
const actionQuery = ref('')

const form = reactive({
  roleCode: '',
  roleName: '',
  appCode: '',
  description: '',
  isRequired: false,
  status: 'active' as RoleStatus
})

const statusItems = [
  { label: 'active', value: 'active' },
  { label: 'suspended', value: 'suspended' },
  { label: 'disabled', value: 'disabled' }
]

const { data: applicationData, pending: applicationsPending, refresh: refreshApplications } = usePlatformData<ApiEnvelope<ApplicationListResponse>>(
  '/api/platform/ops/applications',
  {
    query: {
      page: 1,
      pageSize: 200
    }
  }
)

await refreshApplications()

const appOptions = computed<Array<{ value: string, label: string }>>(() => ((applicationData.value?.data.items || []) as ApplicationItem[])
  .filter(item => item.appCode)
  .map(item => ({
    value: item.appCode,
    label: `${item.appName} (${item.appCode})`
  })))

const permissionBrowserAppCode = ref('')
const actionMapByApp = reactive<Record<string, PermissionActionItem[]>>({})
const selectedActionCodes = ref<string[]>([])

watch(appOptions, (items) => {
  if (!form.appCode && items[0]) {
    form.appCode = String(items[0].value)
  }

  if (!permissionBrowserAppCode.value && items[0]) {
    permissionBrowserAppCode.value = String(items[0].value)
  }
}, { immediate: true })

watch(() => form.appCode, (appCode) => {
  if (!appCode) {
    return
  }

  if (!permissionBrowserAppCode.value) {
    permissionBrowserAppCode.value = appCode
  }
})

async function ensurePermissionActions(appCode: string) {
  if (!appCode) {
    return
  }

  if (actionMapByApp[appCode]) {
    return
  }

  actionPending.value = true
  actionError.value = ''

  try {
    const response = await platformFetchJson<ApiEnvelope<ResourceListResponse>>(
      `/api/platform/ops/applications/${encodeURIComponent(appCode)}/resources`,
      {
        query: {
          requiresGrant: 'true'
        }
      }
    )

    const flatten: PermissionActionItem[] = []
    for (const resource of response.data.items || []) {
      for (const action of resource.actions || []) {
        flatten.push({
          manifestActionId: action.id,
          appCode: resource.appCode,
          resourceCode: resource.resourceCode,
          resourceName: resource.resourceName,
          action: action.action,
          actionCode: action.actionCode,
          actionName: action.actionName,
          description: action.description
        })
      }
    }

    actionMapByApp[appCode] = flatten
  } catch (error) {
    const fetchError = error as FetchLikeError
    actionError.value = fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || '权限动作加载失败'
    actionMapByApp[appCode] = []
  } finally {
    actionPending.value = false
  }
}

watch(permissionBrowserAppCode, async (appCode) => {
  if (!appCode) {
    return
  }

  await ensurePermissionActions(appCode)
}, { immediate: true })

const browserActions = computed(() => actionMapByApp[permissionBrowserAppCode.value] || [])

const groupedBrowserActions = computed(() => {
  const groups = new Map<string, { resourceCode: string, resourceName: string, actions: PermissionActionItem[] }>()

  for (const item of browserActions.value) {
    if (actionQuery.value) {
      const kw = actionQuery.value.toLowerCase()
      if (!item.actionCode.toLowerCase().includes(kw) && !item.resourceName.toLowerCase().includes(kw) && !(item.actionName || '').toLowerCase().includes(kw)) {
        continue
      }
    }

    const key = `${item.appCode}:${item.resourceCode}`
    if (!groups.has(key)) {
      groups.set(key, {
        resourceCode: item.resourceCode,
        resourceName: item.resourceName,
        actions: []
      })
    }
    groups.get(key)?.actions.push(item)
  }

  return Array.from(groups.values()).map(group => ({
    ...group,
    actions: group.actions.sort((a, b) => a.actionCode.localeCompare(b.actionCode))
  }))
})

const allActionLookup = computed(() => {
  const map = new Map<string, PermissionActionItem>()
  for (const appCode of Object.keys(actionMapByApp)) {
    for (const item of actionMapByApp[appCode] || []) {
      map.set(item.actionCode, item)
    }
  }
  return map
})

const selectedPermissions = computed(() => selectedActionCodes.value
  .map(code => allActionLookup.value.get(code))
  .filter((item): item is PermissionActionItem => Boolean(item)))

const selectedByApp = computed(() => {
  const map = new Map<string, number>()
  for (const item of selectedPermissions.value) {
    map.set(item.appCode, (map.get(item.appCode) || 0) + 1)
  }
  return Array.from(map.entries()).map(([appCode, count]) => ({ appCode, count })).sort((a, b) => a.appCode.localeCompare(b.appCode))
})

function isActionSelected(actionCode: string) {
  return selectedActionCodes.value.includes(actionCode)
}

function setActionSelected(actionCode: string, enabled: boolean) {
  const set = new Set(selectedActionCodes.value)
  if (enabled) {
    set.add(actionCode)
  } else {
    set.delete(actionCode)
  }
  selectedActionCodes.value = Array.from(set)
}

function setResourceSelected(resource: { actions: PermissionActionItem[] }, enabled: boolean) {
  const set = new Set(selectedActionCodes.value)
  for (const action of resource.actions) {
    if (enabled) {
      set.add(action.actionCode)
    } else {
      set.delete(action.actionCode)
    }
  }
  selectedActionCodes.value = Array.from(set)
}

function isResourceFullySelected(resource: { actions: PermissionActionItem[] }) {
  if (resource.actions.length === 0) {
    return false
  }
  return resource.actions.every(item => selectedActionCodes.value.includes(item.actionCode))
}

function clearSelectedPermissions() {
  selectedActionCodes.value = []
}

function normalizeRoleCode(input: string) {
  return input.trim().toLowerCase().replace(/\s+/g, '_')
}

function validateForm() {
  if (!form.roleCode.trim()) {
    throw new Error('roleCode 不能为空')
  }

  if (!/^[a-z0-9._-]+$/.test(form.roleCode.trim())) {
    throw new Error('roleCode 仅支持小写字母、数字、点、下划线和中划线')
  }

  if (!form.roleName.trim()) {
    throw new Error('roleName 不能为空')
  }

  if (!form.appCode.trim()) {
    throw new Error('应用权限角色必须选择所属应用')
  }
}

function submitErrorMessage(error: unknown) {
  const fetchError = error as FetchLikeError
  return fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || '创建应用权限角色失败'
}

async function submit() {
  pending.value = true
  try {
    validateForm()

    const payload = {
      roleCode: form.roleCode.trim(),
      roleName: form.roleName.trim(),
      appCode: form.appCode.trim(),
      description: form.description.trim() || undefined,
      isRequired: form.isRequired,
      status: form.status,
      permissions: selectedPermissions.value.map(item => ({
        appCode: item.appCode,
        resourceCode: item.resourceCode,
        action: item.action,
        manifestActionId: item.manifestActionId
      }))
    }

    const response = await platformFetchJson<ApiEnvelope<{ roleCode: string }>>('/api/platform/ops/system-roles', {
      method: 'POST',
      body: payload
    })

    toast.add({
      title: '应用权限角色已创建',
      description: response.data.roleCode,
      color: 'success'
    })

    await router.push(`/admin/system-roles/${encodeURIComponent(response.data.roleCode)}`)
  } catch (error) {
    toast.add({
      title: '创建失败',
      description: submitErrorMessage(error),
      color: 'error'
    })
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="max-w-[980px]">
    <UBreadcrumb
      :items="[
        { label: '工作台', to: '/admin' },
        { label: '应用权限角色', to: '/admin/system-roles' },
        { label: '新建角色' }
      ]"
      class="mb-3.5"
    />

    <div class="page-h">
      <div>
        <h1>新建应用权限角色</h1>
        <p>定义应用内权限角色并配置权限动作，供企业角色组合引用。</p>
      </div>
    </div>

    <div class="col gap-4">
      <UCard>
        <template #header>
          <div class="font-medium text-highlighted">
            基础信息
          </div>
        </template>

        <div class="col gap-4">
          <div class="grid grid-cols-2 gap-4">
            <UFormField
              label="角色 Code"
              required
              hint="如 platform.ops / aims.pm"
            >
              <UInput
                v-model="form.roleCode"
                class="w-full"
                :ui="{ base: 'font-mono' }"
                placeholder="platform.ops"
                @blur="form.roleCode = normalizeRoleCode(form.roleCode)"
              />
            </UFormField>

            <UFormField
              label="角色名称"
              required
            >
              <UInput
                v-model="form.roleName"
                class="w-full"
                placeholder="平台运营管理员"
              />
            </UFormField>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <UFormField
              label="所属应用"
              required
            >
              <USelect
                v-model="form.appCode"
                :items="appOptions"
                class="w-full"
                :disabled="applicationsPending"
                placeholder="选择 appCode"
              />
            </UFormField>

            <UFormField
              label="状态"
              required
            >
              <USelect
                v-model="form.status"
                :items="statusItems"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField label="角色描述">
            <UTextarea
              v-model="form.description"
              :rows="3"
              class="w-full"
              placeholder="用于说明角色边界、使用场景和适用对象"
            />
          </UFormField>

          <div class="rounded-lg border border-default p-3">
            <UCheckbox
              v-model="form.isRequired"
              label="标记为必选应用权限角色（is_required=1）"
            />
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="font-medium text-highlighted">
                权限动作
              </div>
              <p class="text-sm text-muted mt-0.5">
                从应用最新 manifest 的 requires_grant=1 动作中选择。
              </p>
            </div>
            <div class="flex items-center gap-2">
              <UBadge
                color="neutral"
                variant="soft"
              >
                已选 {{ selectedPermissions.length }}
              </UBadge>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-x"
                :disabled="selectedPermissions.length === 0"
                @click="clearSelectedPermissions"
              >
                清空
              </UButton>
            </div>
          </div>
        </template>

        <div class="col gap-4">
          <div class="grid grid-cols-[280px_1fr_auto] gap-3 items-end">
            <UFormField
              label="浏览应用"
              description="切换应用查看可选权限动作"
            >
              <USelect
                v-model="permissionBrowserAppCode"
                :items="appOptions"
                class="w-full"
                :disabled="applicationsPending || appOptions.length === 0"
                placeholder="选择应用"
              />
            </UFormField>

            <UFormField label="过滤">
              <UInput
                v-model="actionQuery"
                icon="i-lucide-search"
                class="w-full"
                placeholder="按 resource/action 搜索"
              />
            </UFormField>

            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :loading="actionPending"
              :disabled="!permissionBrowserAppCode"
              @click="() => ensurePermissionActions(permissionBrowserAppCode)"
            >
              刷新动作
            </UButton>
          </div>

          <UAlert
            v-if="actionError"
            color="warning"
            variant="soft"
            :title="actionError"
          />

          <UEmpty
            v-if="appOptions.length === 0"
            icon="i-lucide-box"
            title="暂无可用应用"
            description="请先在应用管理中完成应用注册与 manifest 导入。"
          />

          <UEmpty
            v-else-if="groupedBrowserActions.length === 0 && !actionPending"
            icon="i-lucide-shield-off"
            title="当前应用没有可授予动作"
            description="该应用可能还未导入 manifest，或所有动作都被标记为无需授权。"
          />

          <div
            v-else
            class="perm-table"
          >
            <div class="perm-row perm-head">
              <div>资源 / 动作</div>
              <div>Action Code</div>
              <div class="text-right">
                选择
              </div>
            </div>

            <template
              v-for="group in groupedBrowserActions"
              :key="group.resourceCode"
            >
              <div class="perm-row perm-resource">
                <div class="font-medium text-highlighted">
                  {{ group.resourceName }}
                  <span class="mono text-dimmed text-xs">({{ group.resourceCode }})</span>
                </div>
                <div class="text-muted text-xs">
                  {{ group.actions.length }} actions
                </div>
                <div class="text-right">
                  <UCheckbox
                    :model-value="isResourceFullySelected(group)"
                    :label="isResourceFullySelected(group) ? '已全选' : '全选'"
                    @update:model-value="(value) => setResourceSelected(group, Boolean(value))"
                  />
                </div>
              </div>

              <div
                v-for="action in group.actions"
                :key="action.actionCode"
                class="perm-row perm-action"
              >
                <div class="pl-5">
                  <div class="font-medium text-highlighted">
                    {{ action.actionName || action.action }}
                  </div>
                  <div
                    v-if="action.description"
                    class="text-dimmed text-xs"
                  >
                    {{ action.description }}
                  </div>
                </div>
                <div class="mono text-muted text-xs">
                  {{ action.actionCode }}
                </div>
                <div class="text-right">
                  <UCheckbox
                    :model-value="isActionSelected(action.actionCode)"
                    @update:model-value="(value) => setActionSelected(action.actionCode, Boolean(value))"
                  />
                </div>
              </div>
            </template>
          </div>

          <div
            v-if="selectedByApp.length > 0"
            class="flex flex-wrap gap-2"
          >
            <UBadge
              v-for="item in selectedByApp"
              :key="item.appCode"
              color="info"
              variant="soft"
            >
              {{ item.appCode }}: {{ item.count }}
            </UBadge>
          </div>
        </div>
      </UCard>
    </div>

    <div class="mt-4 flex justify-end gap-2">
      <UButton
        color="neutral"
        variant="ghost"
        to="/admin/system-roles"
      >
        取消
      </UButton>
      <UButton
        color="primary"
        icon="i-lucide-save"
        :loading="pending"
        :disabled="pending"
        @click="submit"
      >
        创建应用权限角色
      </UButton>
    </div>
  </div>
</template>

<style scoped>
.perm-table {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ui-border);
  border-radius: 0.75rem;
  overflow: hidden;
}

.perm-row {
  display: grid;
  grid-template-columns: minmax(260px, 1.4fr) minmax(220px, 1fr) 130px;
  gap: 1rem;
  padding: 0.625rem 0.875rem;
  font-size: 0.875rem;
  align-items: center;
  border-bottom: 1px solid var(--ui-border);
}

.perm-row:last-child {
  border-bottom: none;
}

.perm-head {
  background: var(--ui-bg-muted);
  font-size: 0.6875rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ui-text-muted);
}

.perm-resource {
  background: var(--ui-bg-elevated);
}
</style>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

interface UserItem {
  id: number
  tenantCode: string
  uid: string
  username: string | null
  displayName: string
  status: string
  sourceType: string
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

interface UsersResponse {
  items: UserItem[]
  total: number
  page: number
  pageSize: number
}

const props = withDefaults(defineProps<{
  scope?: 'admin' | 'dashboard'
}>(), {
  scope: 'dashboard'
})

const { currentTenantCode, setCurrentTenantCode } = useTenantContext()
const toast = useToast()
const allFilterValue = '__all__'

const query = reactive({
  tenantCode: props.scope === 'dashboard' ? currentTenantCode.value : '',
  status: allFilterValue,
  keyword: ''
})

const users = ref<UserItem[]>([])
const total = ref(0)
const pending = ref(false)
const saving = ref(false)
const error = ref('')
const success = ref('')
const activeId = ref<number | null>(null)

const form = reactive({
  uid: '',
  username: '',
  displayName: '',
  status: 'active'
})

type StatusColor = 'success' | 'warning' | 'neutral'

const statusMeta: Record<string, { label: string, color: StatusColor }> = {
  active: { label: '启用', color: 'success' },
  suspended: { label: '暂停', color: 'warning' },
  disabled: { label: '停用', color: 'neutral' }
}

const statusOptions = [
  { label: '启用', value: 'active' },
  { label: '暂停', value: 'suspended' },
  { label: '停用', value: 'disabled' }
]

function statusColor(status: string): StatusColor {
  return statusMeta[status]?.color ?? 'neutral'
}

function statusLabel(status: string) {
  return statusMeta[status]?.label ?? status
}

function shortUid(uid: string) {
  return uid && uid.length > 14 ? `${uid.slice(0, 8)}…${uid.slice(-4)}` : uid
}

function sourceLabel(sourceType: string) {
  if (sourceType === 'manual') return '手动添加'
  if (sourceType === 'sync') return '同步导入'
  return sourceType
}

async function copyUid(uid: string) {
  try {
    await navigator.clipboard.writeText(uid)
    toast.add({ title: '已复制用户标识', color: 'success', icon: 'i-lucide-check' })
  } catch {
    toast.add({ title: '复制失败，请手动复制', color: 'error' })
  }
}

const isEditing = computed(() => activeId.value !== null)
const effectiveTenantCode = computed(() => props.scope === 'dashboard' ? currentTenantCode.value : query.tenantCode)
const apiPrefix = computed(() => props.scope === 'dashboard' ? '/api/platform/tenant-admin' : '/api/platform/ops')
const statusFilterOptions = computed(() => [
  { label: '全部状态', value: allFilterValue },
  ...statusOptions
])

function normalizeFilterValue(value: string) {
  return value === allFilterValue ? undefined : value || undefined
}

function resetForm() {
  activeId.value = null
  form.uid = ''
  form.username = ''
  form.displayName = ''
  form.status = 'active'
}

function fillForm(item: UserItem) {
  activeId.value = item.id
  form.uid = item.uid
  form.username = item.username || ''
  form.displayName = item.displayName
  form.status = item.status
}

async function loadUsers() {
  const tenantCode = effectiveTenantCode.value.trim()
  if (!tenantCode) {
    users.value = []
    total.value = 0
    return
  }

  pending.value = true
  error.value = ''

  try {
    const response = await platformFetchJson<{ data: UsersResponse }>(`${apiPrefix.value}/users`, {
      query: {
        tenantCode,
        status: normalizeFilterValue(query.status),
        keyword: query.keyword || undefined,
        page: 1,
        pageSize: 50
      }
    })

    users.value = response.data.items
    total.value = response.data.total

    if (activeId.value !== null) {
      const current = response.data.items.find(item => item.id === activeId.value)
      if (current) {
        fillForm(current)
      } else {
        resetForm()
      }
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '加载成员列表失败'
  } finally {
    pending.value = false
  }
}

async function submit() {
  const tenantCode = effectiveTenantCode.value.trim()
  if (!tenantCode) {
    error.value = '请先选择企业'
    return
  }

  saving.value = true
  error.value = ''
  success.value = ''

  try {
    if (isEditing.value && activeId.value) {
      await $fetch(`${apiPrefix.value}/users/${activeId.value}`, {
        method: 'PATCH',
        body: {
          username: form.username || null,
          displayName: form.displayName,
          status: form.status
        }
      })
      success.value = '成员信息已更新'
    } else {
      await $fetch(`${apiPrefix.value}/users`, {
        method: 'POST',
        body: {
          tenantCode,
          uid: form.uid,
          username: form.username || null,
          displayName: form.displayName,
          status: form.status
        }
      })
      success.value = '成员已创建'
      resetForm()
    }

    await loadUsers()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '保存成员失败'
  } finally {
    saving.value = false
  }
}

watch(() => currentTenantCode.value, (value) => {
  if (props.scope === 'dashboard') {
    query.tenantCode = value
  }
})

watch(() => effectiveTenantCode.value, async (value) => {
  if (props.scope === 'dashboard' && value) {
    setCurrentTenantCode(value)
  }

  resetForm()
  await loadUsers()
}, { immediate: true })
</script>

<template>
  <UDashboardPanel
    :id="`${scope}-users-manager`"
    :ui="{ body: 'console-page' }"
  >
    <template #body>
      <section class="console-hero">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="text-xl font-semibold text-highlighted">
              成员
            </h1>
            <p class="mt-1 text-sm text-muted">
              管理企业成员的账号、显示名与登录状态。
            </p>
          </div>
          <UBadge
            color="neutral"
            variant="soft"
          >
            共 {{ total }} 名成员
          </UBadge>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-[1.05fr_1.15fr]">
        <UCard :ui="{ body: 'space-y-4' }">
          <div class="grid gap-3 md:grid-cols-3">
            <UFormField
              v-if="scope === 'admin'"
              label="企业编码"
              class="md:col-span-3"
            >
              <UInput
                v-model="query.tenantCode"
                placeholder="输入企业编码"
                class="w-full"
                @keyup.enter="loadUsers"
              />
            </UFormField>
            <UFormField label="状态">
              <USelect
                v-model="query.status"
                :items="statusFilterOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="搜索"
              class="md:col-span-2"
            >
              <UInput
                v-model="query.keyword"
                placeholder="按姓名、用户名或标识搜索"
                icon="i-lucide-search"
                class="w-full"
                @keyup.enter="loadUsers"
              />
            </UFormField>
          </div>

          <div class="flex flex-wrap gap-2">
            <UButton
              color="primary"
              icon="i-lucide-search"
              :loading="pending"
              @click="loadUsers"
            >
              查询
            </UButton>
            <UButton
              color="neutral"
              variant="soft"
              icon="i-lucide-plus"
              @click="resetForm"
            >
              新建成员
            </UButton>
          </div>

          <UAlert
            v-if="error"
            color="error"
            variant="soft"
            icon="i-lucide-alert-triangle"
            :title="error"
          />

          <div class="grid gap-2">
            <button
              v-for="item in users"
              :key="item.id"
              type="button"
              class="rounded-lg border px-3 py-2.5 text-left transition-colors"
              :class="activeId === item.id
                ? 'border-primary bg-primary/10'
                : 'border-default bg-default hover:border-primary/40 hover:bg-elevated/50'"
              @click="fillForm(item)"
            >
              <div class="flex items-center gap-3">
                <div class="min-w-0 flex-1 space-y-0.5">
                  <p class="truncate text-sm font-medium text-highlighted">
                    {{ item.username || item.uid }}
                  </p>
                  <div class="flex items-center gap-1.5 text-xs text-dimmed">
                    <span class="font-mono">{{ shortUid(item.uid) }}</span>
                    <UTooltip text="复制完整标识">
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        icon="i-lucide-copy"
                        @click.stop="copyUid(item.uid)"
                      />
                    </UTooltip>
                    <span class="text-muted">·</span>
                    <span>{{ sourceLabel(item.sourceType) }}</span>
                    <template v-if="item.lastLoginAt">
                      <span class="text-muted">·</span>
                      <span>最近登录 {{ item.lastLoginAt }}</span>
                    </template>
                  </div>
                </div>
                <UBadge
                  :color="statusColor(item.status)"
                  variant="soft"
                  size="sm"
                >
                  {{ statusLabel(item.status) }}
                </UBadge>
              </div>
            </button>

            <div
              v-if="!pending && users.length === 0"
              class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-default px-4 py-10 text-center"
            >
              <UIcon
                name="i-lucide-users"
                class="size-6 text-dimmed"
              />
              <p class="text-sm text-muted">
                当前企业还没有成员
              </p>
              <UButton
                color="primary"
                variant="soft"
                size="sm"
                icon="i-lucide-plus"
                @click="resetForm"
              >
                新建第一名成员
              </UButton>
            </div>
          </div>
        </UCard>

        <UCard :ui="{ body: 'space-y-4' }">
          <template #header>
            <div class="space-y-1">
              <h2 class="text-base font-semibold text-highlighted">
                {{ isEditing ? '编辑成员' : '新建成员' }}
              </h2>
              <p class="text-sm text-muted">
                {{ isEditing ? '更新成员的显示信息与登录状态。' : '在当前企业下新增一名成员。' }}
              </p>
            </div>
          </template>

          <form
            class="space-y-4"
            @submit.prevent="submit"
          >
            <div class="grid gap-3 md:grid-cols-2">
              <UFormField label="所属企业">
                <UInput
                  :model-value="effectiveTenantCode"
                  readonly
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="用户标识"
                hint="稳定唯一，创建后不可修改"
              >
                <UInput
                  v-model="form.uid"
                  :readonly="isEditing"
                  placeholder="例如 zhangsan"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="外部用户名"
                hint="对接外部系统时使用，可选"
              >
                <UInput
                  v-model="form.username"
                  placeholder="外部系统用户名"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="显示名称"
                required
              >
                <UInput
                  v-model="form.displayName"
                  placeholder="例如 张三"
                  required
                  class="w-full"
                />
              </UFormField>
              <UFormField label="状态">
                <USelect
                  v-model="form.status"
                  :items="statusOptions"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="flex flex-wrap gap-2">
              <UButton
                type="submit"
                color="primary"
                :icon="isEditing ? 'i-lucide-check' : 'i-lucide-plus'"
                :loading="saving"
              >
                {{ isEditing ? '保存成员' : '创建成员' }}
              </UButton>
              <UButton
                type="button"
                color="neutral"
                variant="soft"
                @click="resetForm"
              >
                {{ isEditing ? '取消编辑' : '重置表单' }}
              </UButton>
            </div>

            <UAlert
              v-if="success"
              color="success"
              variant="soft"
              icon="i-lucide-check"
              :title="success"
            />
          </form>
        </UCard>
      </section>
    </template>
  </UDashboardPanel>
</template>

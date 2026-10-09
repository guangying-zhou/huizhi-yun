<script setup lang="ts">
import CommonEmptyState from '@hzy/foundation/app/components/common/EmptyState.vue'
import { projectPageFailure } from '../../app/utils/projectPageFailure'
import ProjectNavbar from '../../app/components/project/ProjectNavbar.vue'
import { PROJECT_ROLE_LABELS, PROJECT_ROLE_OPTIONS, type NormalizedProjectRole } from '../../app/utils/projectRoles'
import { useAccountUsers } from '@hzy/foundation/app/composables/useAccount'
import { useAimsModule } from '../useAimsModule'

type ProjectMember = { id: number, uid: string, role?: string, status?: string, createdAt?: string, updatedAt?: string, created_at?: string, updated_at?: string }
const { users: accountUsers } = useAccountUsers()
const { confirm } = useConfirm()
const toast = useToast()
const userNames = computed(() => new Map(accountUsers.value.map(user => [user.uid, user.realName || user.uid])))
const memberStatusLabels: Record<string, string> = { active: '有效', inactive: '已停用' }
const route = useRoute()
const { moduleUrl } = useAimsModule()
const projectId = computed(() => String(route.params.id || ''))
const { page, pageSize } = useListPage({ pageSize: 20 })
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const items = ref<ProjectMember[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const canManage = ref(false)
const operationKey = ref(''), showAdd = ref(false), uid = ref(''), role = ref('member'), saving = ref(false)
const selectedUids = computed({ get: () => uid.value ? [uid.value] : [], set: (values: string[]) => {
  uid.value = values[0] || ''
} })
async function write(action: 'add' | 'role' | 'remove', target: string, nextRole = '') {
  if (action === 'remove' && !(await confirm({ title: '移除项目成员', message: `确定移除「${userNames.value.get(target) || target}（${target}）」？该成员将失去项目成员身份。`, confirmLabel: '移除', tone: 'danger' }))) return
  saving.value = true
  operationKey.value ||= crypto.randomUUID()
  try {
    await $fetch(moduleUrl(`/api/v1/projects/${projectId.value}/members`), {
      method: action === 'add' ? 'POST' : action === 'role' ? 'PUT' : 'DELETE',
      headers: { 'Idempotency-Key': operationKey.value },
      body: { uid: target, ...(action === 'remove' ? {} : { role: nextRole }) }
    })
    operationKey.value = ''
    showAdd.value = false
    uid.value = ''
    await refresh()
  } catch (cause) {
    toast.add({ title: '成员操作未完成', description: projectPageFailure(cause, '请重试原操作'), color: 'error' })
  } finally {
    saving.value = false
  }
}

let readGeneration = 0
async function refresh() {
  const generation = ++readGeneration
  loading.value = true
  error.value = ''
  canManage.value = false
  items.value = []
  total.value = 0
  try {
    const detail = await $fetch<{ code?: number, data?: Record<string, unknown> }>(moduleUrl(`/api/v1/projects/${projectId.value}`))
    if (generation !== readGeneration) return
    canManage.value = detail.code === 0 && detail.data?.canEditProject === true
    const response = await $fetch<{ code?: number, data?: { items?: ProjectMember[], total?: number } }>(moduleUrl(`/api/v1/projects/${projectId.value}/members`), {
      query: { page: page.value, pageSize, ...(debounced.value.trim() ? { search: debounced.value.trim() } : {}) }
    })
    if (generation !== readGeneration) return
    if (response.code !== 0) throw Error('项目成员暂不可用')
    items.value = Array.isArray(response.data?.items) ? response.data.items : []
    total.value = Number(response.data?.total || items.value.length)
  } catch (cause) {
    if (generation !== readGeneration) return
    canManage.value = false
    error.value = projectPageFailure(cause, '项目成员暂不可用')
  } finally {
    if (generation === readGeneration) loading.value = false
  }
}

onScopeDispose(() => {
  readGeneration++
})
watch(projectId, () => {
  if (page.value !== 1) page.value = 1
  else refresh()
})
watch([page, debounced], refresh)
onMounted(refresh)
</script>

<template>
  <UDashboardPanel id="enterprise-project-members" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <ProjectNavbar>
          <template #actions>
            <UButton
              v-if="canManage && !loading && !error"
              icon="i-lucide-user-plus"
              size="sm"
              @click="showAdd=true"
            >
              添加成员
            </UButton>
            <UButton
              aria-label="刷新"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              :loading="loading"
              @click="refresh"
            />
          </template>
        </ProjectNavbar>
        <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-4 sm:px-6">
          <section class="space-y-5">
            <div class="flex max-w-xl gap-3">
              <UInput
                v-model="search"
                class="flex-1"
                icon="i-lucide-search"
                placeholder="搜索成员 UID、角色或状态"
                @keyup.enter="flush"
              />
              <UButton :loading="loading" @click="flush">
                查询
              </UButton>
            </div>
            <UAlert
              v-if="error"
              color="error"
              icon="i-lucide-circle-alert"
              title="无法读取成员"
              :description="error"
            />
            <UTable
              v-if="!error"
              class="hidden sm:block"
              :data="items"
              :loading="loading"
              :columns="[
                { accessorKey: 'uid', header: '成员' }, { accessorKey: 'role', header: '项目角色' },
                { accessorKey: 'status', header: '状态' }, { accessorKey: 'updatedAt', header: '更新时间' },
                ...(canManage ? [{ id: 'actions', header: '操作' }] : [])
              ]"
            >
              <template #uid-cell="{ row }">
                <div class="min-w-0">
                  <span class="font-medium">{{ userNames.get(row.original.uid) || row.original.uid }}</span><span class="ml-2 text-xs text-muted">{{ row.original.uid }}</span>
                </div>
              </template>
              <template #role-cell="{ row }">
                {{ PROJECT_ROLE_LABELS[row.original.role as NormalizedProjectRole] || row.original.role || '-' }}
              </template>
              <template #status-cell="{ row }">
                <UBadge color="neutral" variant="subtle">
                  {{ memberStatusLabels[row.original.status || ''] || row.original.status || '-' }}
                </UBadge>
              </template>
              <template #updatedAt-cell="{ row }">
                {{ row.original.updatedAt || row.original.updated_at || row.original.createdAt || row.original.created_at || '-' }}
              </template>
              <template #actions-cell="{ row }">
                <div v-if="items.length&&canManage" class="flex flex-wrap items-center gap-2">
                  <UButton
                    size="xs"
                    variant="soft"
                    :disabled="saving"
                    @click="write('role', row.original.uid, row.original.role==='manager'?'member':'manager')"
                  >
                    {{ row.original.role==='manager'?'改为成员':'设为经理' }}
                  </UButton><UButton
                    size="xs"
                    color="error"
                    variant="soft"
                    :disabled="saving"
                    @click="write('remove', row.original.uid)"
                  >
                    移除
                  </UButton>
                </div>
              </template>
              <template #empty>
                <CommonEmptyState icon="i-lucide-users" title="暂无项目成员" description="当前项目没有可显示的成员。" />
              </template>
            </UTable>
            <div v-if="!error" class="sm:hidden">
              <p v-if="loading" role="status" class="py-4 text-sm text-muted">
                正在读取成员…
              </p>
              <ul v-else-if="items.length" class="divide-y divide-default">
                <li v-for="member in items" :key="member.id" class="space-y-3 py-3">
                  <div class="flex min-w-0 items-start justify-between gap-3">
                    <div class="min-w-0">
                      <p class="truncate font-medium">
                        {{ userNames.get(member.uid) || member.uid }}
                      </p>
                      <p class="truncate text-xs text-muted">
                        {{ member.uid }}
                      </p>
                    </div>
                    <UBadge color="neutral" variant="subtle">
                      {{ memberStatusLabels[member.status || ''] || member.status || '-' }}
                    </UBadge>
                  </div>
                  <p class="text-sm text-muted">
                    {{ PROJECT_ROLE_LABELS[member.role as NormalizedProjectRole] || member.role || '-' }}
                  </p>
                  <div v-if="canManage" class="flex flex-wrap gap-2">
                    <UButton
                      size="xs"
                      variant="soft"
                      :disabled="saving"
                      @click="write('role', member.uid, member.role === 'manager' ? 'member' : 'manager')"
                    >
                      {{ member.role === 'manager' ? '改为成员' : '设为经理' }}
                    </UButton>
                    <UButton
                      size="xs"
                      color="error"
                      variant="soft"
                      :disabled="saving"
                      @click="write('remove', member.uid)"
                    >
                      移除
                    </UButton>
                  </div>
                </li>
              </ul>
              <CommonEmptyState
                v-else
                icon="i-lucide-users"
                title="暂无项目成员"
                description="当前项目没有可显示的成员。"
              />
            </div>
            <div v-if="!error" class="flex flex-wrap items-center justify-between gap-3">
              <span class="text-sm text-muted">共 {{ total }} 条</span>
              <UPagination v-model:page="page" :items-per-page="pageSize" :total="total" />
            </div>
          </section>
        </div>
        <UModal v-model:open="showAdd" title="添加项目成员" description="选择成员及其项目角色。">
          <template #body>
            <div class="space-y-4">
              <UFormField label="成员" required>
                <UserTreeSelector v-model="selectedUids" selection-mode="single" :exclude-uids="items.map(member => member.uid)" />
              </UFormField><UFormField label="项目角色" required>
                <USelect v-model="role" :items="PROJECT_ROLE_OPTIONS" class="w-full" />
              </UFormField>
            </div>
          </template>
          <template #footer>
            <UButton
              color="neutral"
              variant="outline"
              :disabled="saving"
              @click="showAdd=false"
            >
              取消
            </UButton><UButton
              v-if="canManage && !loading && !error"
              :loading="saving"
              :disabled="!uid.trim()"
              @click="write('add', uid, role)"
            >
              确认添加
            </UButton>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>

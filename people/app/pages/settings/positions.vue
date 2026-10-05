<script setup lang="ts">
import type { ApiResponse, ListResponse, Position } from '~/types'

usePageTitle('岗位字典')

type PositionRow = Position & { enabled_label: string }

const toast = useToast()
const { confirm } = useConfirm()
const { ensurePeoplePermission } = usePeopleAuthorization()
const page = ref(1)
const pageSize = ref(20)
const editorOpen = ref(false)
const editingPosition = ref<Position | null>(null)
const saving = ref(false)
const deletingCode = ref('')
const { search: keyword, debounced: debouncedKeyword, flush: flushSearch } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})

function emptyForm() {
  return {
    positionCode: '',
    positionName: '',
    jobFamily: '',
    description: '',
    enabled: true,
    sortOrder: '0'
  }
}

const form = reactive(emptyForm())

const query = computed(() => ({
  page: page.value,
  page_size: pageSize.value,
  keyword: debouncedKeyword.value || undefined
}))

const { data: response, error, refresh, status } = await useLazyFetch<ApiResponse<ListResponse<Position>>>('/api/v1/positions', {
  query,
  watch: [query]
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

const rows = computed<PositionRow[]>(() => (response.value?.data.items || []).map(item => ({
  ...item,
  enabled_label: item.enabled ? '启用' : '停用'
})))
const total = computed(() => response.value?.data.total || 0)
const editorTitle = computed(() => editingPosition.value ? '编辑岗位' : '新增岗位')

const columns = [
  { accessorKey: 'position_code', header: '岗位编码' },
  { accessorKey: 'position_name', header: '岗位名称' },
  { accessorKey: 'job_family', header: '岗位族' },
  { accessorKey: 'description', header: '说明' },
  { accessorKey: 'enabled_label', header: '状态' },
  { accessorKey: 'sort_order', header: '排序' },
  { id: 'actions', header: '操作' }
]

function errorMessage(error: unknown) {
  const payload = error as {
    data?: { message?: string }
    message?: string
    statusMessage?: string
  }
  return payload.data?.message || payload.statusMessage || payload.message || '请稍后重试'
}

function openCreate() {
  editingPosition.value = null
  Object.assign(form, emptyForm())
  editorOpen.value = true
}

function openEdit(position: Position) {
  editingPosition.value = position
  Object.assign(form, {
    positionCode: position.position_code,
    positionName: position.position_name,
    jobFamily: position.job_family || '',
    description: position.description || '',
    enabled: Boolean(position.enabled),
    sortOrder: String(position.sort_order ?? 0)
  })
  editorOpen.value = true
}

async function savePosition() {
  if (saving.value) return
  const positionCode = form.positionCode.trim()
  const positionName = form.positionName.trim()
  if (!positionCode || !positionName) {
    toast.add({ title: '岗位编码和名称不能为空', color: 'warning' })
    return
  }

  const authorization = await ensurePeoplePermission('positions', 'admin')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要岗位字典管理权限后才能维护。',
      color: 'warning'
    })
    return
  }

  const current = editingPosition.value
  const body = {
    ...(!current ? { positionCode } : {}),
    positionName,
    jobFamily: form.jobFamily.trim() || null,
    description: form.description.trim() || null,
    enabled: form.enabled,
    sortOrder: Number.isFinite(Number(form.sortOrder)) ? Math.max(0, Math.trunc(Number(form.sortOrder))) : 0,
    currentUser: authorization.snapshot?.uid || undefined
  }

  saving.value = true
  try {
    await $fetch(current
      ? `/api/v1/positions/${current.id}`
      : '/api/v1/positions', {
      method: current ? 'PATCH' : 'POST',
      body
    })
    toast.add({ title: current ? '岗位已更新' : '岗位已新增', color: 'success' })
    editorOpen.value = false
    if (!current && page.value !== 1) {
      page.value = 1
    } else {
      await refresh()
    }
  } catch (error) {
    toast.add({
      title: current ? '更新岗位失败' : '新增岗位失败',
      description: errorMessage(error),
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

async function deletePosition(position: Position) {
  if (deletingCode.value) return
  if (!(await confirm({
    title: '删除岗位',
    message: `确定删除岗位「${position.position_name}」？该操作不可恢复；已有员工和任职记录中的岗位快照不会被修改。`,
    confirmLabel: '删除岗位',
    tone: 'danger'
  }))) return

  const authorization = await ensurePeoplePermission('positions', 'admin')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要岗位字典管理权限后才能删除。',
      color: 'warning'
    })
    return
  }

  deletingCode.value = position.position_code
  try {
    await $fetch(`/api/v1/positions/${position.id}`, { method: 'DELETE' })
    toast.add({ title: '岗位已删除', color: 'success' })
    if (rows.value.length === 1 && page.value > 1) {
      page.value -= 1
    } else {
      await refresh()
    }
  } catch (error) {
    toast.add({
      title: '删除岗位失败',
      description: errorMessage(error),
      color: 'error'
    })
  } finally {
    deletingCode.value = ''
  }
}
</script>

<template>
  <UDashboardPanel
    id="people-settings-positions"
    grow
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UAlert
          v-if="error"
          color="warning"
          variant="soft"
          icon="i-lucide-database-zap"
          title="岗位字典暂不可用"
        />

        <UCard>
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <UInput
              v-model="keyword"
              icon="i-lucide-search"
              placeholder="搜索岗位编码 / 名称 / 岗位族"
              class="w-full md:max-w-md"
              @keyup.enter="flushSearch"
            />
            <UButton
              icon="i-lucide-plus"
              color="primary"
              variant="soft"
              @click="openCreate"
            >
              新增岗位
            </UButton>
          </div>
        </UCard>

        <UCard>
          <div class="overflow-x-auto">
            <UTable
              :data="rows"
              :columns="columns"
              :loading="status === 'pending'"
              class="min-w-[920px]"
            >
              <template #empty>
                <CommonEmptyState
                  icon="i-lucide-briefcase"
                  title="暂无岗位"
                />
              </template>
              <template #enabled_label-cell="{ row }">
                <UBadge
                  :color="row.original.enabled ? 'success' : 'neutral'"
                  variant="soft"
                >
                  {{ row.original.enabled_label }}
                </UBadge>
              </template>
              <template #actions-cell="{ row }">
                <div class="flex items-center gap-1">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-pencil"
                    :aria-label="`编辑岗位 ${row.original.position_name}`"
                    @click="openEdit(row.original)"
                  >
                    编辑
                  </UButton>
                  <UButton
                    size="xs"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    :loading="deletingCode === row.original.position_code"
                    :disabled="Boolean(deletingCode)"
                    :aria-label="`删除岗位 ${row.original.position_name}`"
                    @click="deletePosition(row.original)"
                  >
                    删除
                  </UButton>
                </div>
              </template>
            </UTable>
          </div>

          <div
            v-if="total > 0"
            class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <span class="text-sm text-muted">共 {{ total }} 个岗位</span>
            <UPagination
              v-model:page="page"
              :items-per-page="pageSize"
              :total="total"
            />
          </div>
        </UCard>

        <UModal
          v-model:open="editorOpen"
          :title="editorTitle"
          :description="editingPosition ? '岗位编码创建后不可修改。' : '维护可在员工任职中选择的岗位主数据。'"
          :ui="{ content: 'sm:max-w-2xl' }"
        >
          <template #body>
            <form
              class="space-y-4"
              @submit.prevent="savePosition"
            >
              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                  label="岗位编码"
                  required
                >
                  <UInput
                    v-model="form.positionCode"
                    :disabled="Boolean(editingPosition)"
                    maxlength="64"
                    autocomplete="off"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="岗位名称"
                  required
                >
                  <UInput
                    v-model="form.positionName"
                    maxlength="100"
                    autocomplete="off"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="岗位族">
                  <UInput
                    v-model="form.jobFamily"
                    maxlength="64"
                    placeholder="如：研发、交付、销售"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="排序">
                  <UInput
                    v-model="form.sortOrder"
                    type="number"
                    min="0"
                    step="1"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="说明"
                  class="sm:col-span-2"
                >
                  <UTextarea
                    v-model="form.description"
                    :rows="3"
                    maxlength="255"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="状态"
                  class="sm:col-span-2"
                >
                  <UCheckbox
                    v-model="form.enabled"
                    label="启用该岗位"
                  />
                </UFormField>
              </div>

              <div class="flex justify-end gap-2">
                <UButton
                  type="button"
                  color="neutral"
                  variant="ghost"
                  @click="editorOpen = false"
                >
                  取消
                </UButton>
                <UButton
                  type="submit"
                  color="primary"
                  icon="i-lucide-save"
                  :loading="saving"
                >
                  {{ editingPosition ? '保存修改' : '新增岗位' }}
                </UButton>
              </div>
            </form>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>

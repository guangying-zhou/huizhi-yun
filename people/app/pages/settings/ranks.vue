<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ApiResponse, ListResponse, Rank } from '~/types'
import { rankFormSchema, type RankFormData } from '~/utils/rankFormSchema'

usePageTitle('职级字典')

type RankSeries = 'M' | 'P'
type RankRow = Rank & {
  rank_series_label: string
  enabled_label: string
}

const toast = useToast()
const { confirm } = useConfirm()
const { ensurePeoplePermission } = usePeopleAuthorization()
const page = ref(1)
const pageSize = ref(20)
const editorOpen = ref(false)
const editingRank = ref<Rank | null>(null)
const saving = ref(false)
const deletingCode = ref('')
const { search: keyword, debounced: debouncedKeyword, flush: flushSearch } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})

const rankSeriesOptions = [
  { label: '专业', value: 'P' },
  { label: '管理', value: 'M' }
]

function emptyForm() {
  return {
    rankCode: '',
    rankName: '',
    rankSeries: 'P' as RankSeries,
    rankLevel: '1',
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

const { data: response, error, refresh, status } = await useLazyFetch<ApiResponse<ListResponse<Rank>>>('/api/v1/ranks', {
  query,
  watch: [query]
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

const rows = computed<RankRow[]>(() => (response.value?.data.items || []).map((item) => {
  return {
    ...item,
    rank_series_label: item.rank_series === 'M' ? '管理' : '专业',
    enabled_label: item.enabled ? '启用' : '停用'
  }
}))
const total = computed(() => response.value?.data.total || 0)
const editorTitle = computed(() => editingRank.value ? '编辑职级' : '新增职级')

const columns = [
  { accessorKey: 'rank_code', header: '职级编码' },
  { accessorKey: 'rank_name', header: '职级名称' },
  { accessorKey: 'rank_series_label', header: '职级类型' },
  { accessorKey: 'rank_level', header: '职级层级' },
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
  editingRank.value = null
  Object.assign(form, emptyForm())
  editorOpen.value = true
}

function openEdit(rank: Rank) {
  editingRank.value = rank
  Object.assign(form, {
    rankCode: rank.rank_code,
    rankName: rank.rank_name,
    rankSeries: rank.rank_series,
    rankLevel: String(rank.rank_level ?? 0),
    description: rank.description || '',
    enabled: Boolean(rank.enabled),
    sortOrder: String(rank.sort_order ?? 0)
  })
  editorOpen.value = true
}

async function saveRank(event: FormSubmitEvent<RankFormData>) {
  if (saving.value) return
  const data = event.data

  const authorization = await ensurePeoplePermission('ranks', 'admin')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要职级字典管理权限后才能维护。',
      color: 'warning'
    })
    return
  }

  const current = editingRank.value
  const body = {
    ...(!current ? { rankCode: data.rankCode } : {}),
    rankName: data.rankName,
    rankSeries: data.rankSeries,
    rankLevel: data.rankLevel,
    description: data.description.trim() || null,
    enabled: data.enabled,
    sortOrder: data.sortOrder,
    currentUser: authorization.snapshot?.uid || undefined
  }

  saving.value = true
  try {
    await $fetch(current
      ? `/api/v1/ranks/${current.id}`
      : '/api/v1/ranks', {
      method: current ? 'PATCH' : 'POST',
      body
    })
    toast.add({ title: current ? '职级已更新' : '职级已新增', color: 'success' })
    editorOpen.value = false
    if (!current && page.value !== 1) {
      page.value = 1
    } else {
      await refresh()
    }
  } catch (error) {
    toast.add({
      title: current ? '更新职级失败' : '新增职级失败',
      description: errorMessage(error),
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

async function deleteRank(rank: Rank) {
  if (deletingCode.value) return
  if (!(await confirm({
    title: '删除职级',
    message: `确定删除职级「${rank.rank_name}」？该操作不可恢复；已有员工、任职和成本快照中的职级事实不会被修改。`,
    confirmLabel: '删除职级',
    tone: 'danger'
  }))) return

  const authorization = await ensurePeoplePermission('ranks', 'admin')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要职级字典管理权限后才能删除。',
      color: 'warning'
    })
    return
  }

  deletingCode.value = rank.rank_code
  try {
    await $fetch(`/api/v1/ranks/${rank.id}`, { method: 'DELETE' })
    toast.add({ title: '职级已删除', color: 'success' })
    if (rows.value.length === 1 && page.value > 1) {
      page.value -= 1
    } else {
      await refresh()
    }
  } catch (error) {
    toast.add({
      title: '删除职级失败',
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
    id="people-settings-ranks"
    grow
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UAlert
          v-if="error"
          color="warning"
          variant="soft"
          icon="i-lucide-database-zap"
          title="职级字典暂不可用"
        />

        <UCard>
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <UInput
              v-model="keyword"
              icon="i-lucide-search"
              placeholder="搜索职级编码 / 名称"
              class="w-full md:max-w-md"
              @keyup.enter="flushSearch"
            />
            <UButton
              icon="i-lucide-plus"
              color="primary"
              variant="soft"
              @click="openCreate"
            >
              新增职级
            </UButton>
          </div>
        </UCard>

        <UCard>
          <div class="overflow-x-auto">
            <UTable
              :data="rows"
              :columns="columns"
              :loading="status === 'pending'"
              class="min-w-[1040px]"
            >
              <template #empty>
                <CommonEmptyState
                  icon="i-lucide-layers"
                  title="暂无职级"
                />
              </template>
              <template #rank_series_label-cell="{ row }">
                <UBadge
                  :color="row.original.rank_series === 'M' ? 'primary' : 'info'"
                  variant="soft"
                >
                  {{ row.original.rank_series_label }}
                </UBadge>
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
                    :aria-label="`编辑职级 ${row.original.rank_name}`"
                    @click="openEdit(row.original)"
                  >
                    编辑
                  </UButton>
                  <UButton
                    size="xs"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    :loading="deletingCode === row.original.rank_code"
                    :disabled="Boolean(deletingCode)"
                    :aria-label="`删除职级 ${row.original.rank_name}`"
                    @click="deleteRank(row.original)"
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
            <span class="text-sm text-muted">共 {{ total }} 个职级</span>
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
          :description="editingRank ? '职级编码创建后不可修改。' : '维护可在员工任职中选择的职级主数据。'"
          :ui="{ content: 'sm:max-w-2xl' }"
        >
          <template #body>
            <UForm
              :schema="rankFormSchema"
              :state="form"
              class="space-y-4"
              @submit="saveRank"
            >
              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                  label="职级编码"
                  name="rankCode"
                  required
                >
                  <UInput
                    v-model="form.rankCode"
                    :disabled="Boolean(editingRank)"
                    maxlength="32"
                    autocomplete="off"
                    placeholder="如：P6、M3"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="职级名称"
                  name="rankName"
                  required
                >
                  <UInput
                    v-model="form.rankName"
                    maxlength="100"
                    autocomplete="off"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="职级类型"
                  name="rankSeries"
                  required
                >
                  <USelect
                    v-model="form.rankSeries"
                    :items="rankSeriesOptions"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="职级层级"
                  name="rankLevel"
                  required
                >
                  <UInput
                    v-model="form.rankLevel"
                    type="number"
                    min="0"
                    step="1"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="排序"
                  name="sortOrder"
                  required
                >
                  <UInput
                    v-model="form.sortOrder"
                    type="number"
                    min="0"
                    step="1"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="状态"
                  name="enabled"
                >
                  <UCheckbox
                    v-model="form.enabled"
                    label="启用该职级"
                  />
                </UFormField>
                <UFormField
                  label="说明"
                  name="description"
                  class="sm:col-span-2"
                >
                  <UTextarea
                    v-model="form.description"
                    :rows="3"
                    maxlength="255"
                    class="w-full"
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
                  {{ editingRank ? '保存修改' : '新增职级' }}
                </UButton>
              </div>
            </UForm>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>

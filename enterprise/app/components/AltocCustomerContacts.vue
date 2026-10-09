<script setup lang="ts">
import AltocListColumns from './AltocListColumns.vue'
import type { TableColumn } from '@nuxt/ui'
import CommonEmptyState from '../../../foundation/app/components/common/EmptyState.vue'
import W3SourceInfo from './W3SourceInfo.vue'
import { w3StarLabel, type W3Record } from '../utils/w3Presentation'

const props = defineProps<{
  customer: W3Record
  canEdit: boolean
}>()
const emit = defineEmits<{
  edit: [
        row: W3Record
  ]
  star: [
        row: W3Record
  ]
  remove: [
        row: W3Record
  ]
}>()
const { loaded, error: permissionError, hasPermission } = usePermissions()
const { status } = useEnterpriseNavigationAccess()
const scope = useState<string>('enterprise-cache-scope', () => '')
const page = ref(1)
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const statusFilter = ref('all'), decisionRole = ref(''), view = ref('all')
const activeFilterCount = computed(() => [statusFilter.value !== 'all', Boolean(decisionRole.value), view.value !== 'all'].filter(Boolean).length)
function clearFilters() {
  search.value = decisionRole.value = ''
  statusFilter.value = view.value = 'all'
  flush()
}
const rows = ref<W3Record[]>([]), total = ref(0), pending = ref(false), error = ref('')
const selected = ref<W3Record | null>(null), drawer = ref(false)
const allowed = computed(() => loaded.value && !permissionError.value && status.value === 'ready' && !!scope.value && hasPermission('customer', 'view'))
watch([statusFilter, decisionRole, view, () => props.customer.id, scope], () => {
  page.value = 1
  selected.value = null
  drawer.value = false
}, { flush: 'sync' })
let generation = 0
async function refresh() {
  const epoch = ++generation
  error.value = ''
  pending.value = false
  if (!allowed.value) {
    rows.value = []
    total.value = 0
    selected.value = null
    drawer.value = false
    return
  }
  pending.value = true
  try {
    const result = await $fetch<{
      data: {
        id: string
        items: W3Record[]
        total: number
        page: number
        pageSize: number
      }
    }>(`/altoc/api/v1/customers/${props.customer.id}/contacts`, { retry: 0, query: { page: page.value, pageSize: 20, ...(debounced.value ? { search: debounced.value } : {}), ...(statusFilter.value !== 'all' ? { status: statusFilter.value } : {}), ...(decisionRole.value ? { decisionRole: decisionRole.value } : {}), ...(view.value === 'primary' ? { primaryOnly: true } : {}), ...(view.value === 'starred' ? { starredOnly: true } : {}) } })
    if (epoch !== generation)
      return
    if (String(result.data.id) !== String(props.customer.id) || !Array.isArray(result.data.items) || result.data.page !== page.value || result.data.pageSize !== 20 || !Number.isSafeInteger(result.data.total))
      throw Error('Invalid contact page')
    rows.value = result.data.items
    total.value = result.data.total
  } catch (failure) {
    if (epoch === generation) {
      rows.value = []
      total.value = 0
      error.value = Number((failure as {
        statusCode?: number
      }).statusCode) === 403
        ? '无联系人查看权限'
        : '联系人暂不可用，请重试'
    }
  } finally {
    if (epoch === generation)
      pending.value = false
  }
}
watch([allowed, scope, () => props.customer.id], () => {
  rows.value = []
  total.value = 0
}, { flush: 'sync' })
watch([allowed, scope, () => props.customer.id, page, debounced, statusFilter, decisionRole, view], () => void refresh(), { immediate: true })
onScopeDispose(() => {
  generation++
})
const columnDefinitions: TableColumn<W3Record>[] = [{ accessorKey: 'name', header: '姓名' }, { id: 'position', header: '部门 / 职务' }, { id: 'contact', header: '联系方式' }, { accessorKey: 'decision_role', header: '决策角色' }, { accessorKey: 'influence_level', header: '影响力' }, { id: 'flags', header: '标记' }, { accessorKey: 'status', header: '状态' }, { id: 'actions', header: '操作' }]
const optionalColumns = [{ key: 'position', label: '部门 / 职务' }, { key: 'contact', label: '联系方式' }, { key: 'decision_role', label: '决策角色' }, { key: 'influence_level', label: '影响力' }, { key: 'flags', label: '标记' }]
const visibleColumns = ref(optionalColumns.map(column => column.key))
const columnsControl = ref<InstanceType<typeof AltocListColumns> | null>(null)
const columns = computed(() => columnDefinitions.filter((column) => {
  const key = 'accessorKey' in column ? String(column.accessorKey) : String(column.id)
  return !optionalColumns.some(item => item.key === key) || visibleColumns.value.includes(key)
}))
function contactLink(row: W3Record) {
  const phone = String(row.mobile || row.phone || '')
  if (/^[+0-9() .-]{5,32}$/.test(phone)) return `tel:${phone.replace(/[() .-]/g, '')}`
  const email = String(row.email || '')
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${encodeURIComponent(email)}` : ''
}
function openContact(row: W3Record) {
  selected.value = row
  drawer.value = true
}
function menu(row: W3Record) {
  return [{ label: '编辑资料', onSelect: () => emit('edit', row) }, ...(Object.hasOwn(row, 'star_level') ? [{ label: '编辑星级', onSelect: () => emit('star', row) }] : []), { label: '删除', color: 'error' as const, onSelect: () => emit('remove', row) }]
}
</script>

<template>
  <section class="min-w-0 space-y-4">
    <div
      class="flex min-w-0 items-center gap-2"
      aria-label="联系人列表工具栏"
    >
      <UInput
        v-model="search"
        class="min-w-0 flex-1 sm:max-w-64"
        icon="i-lucide-search"
        placeholder="搜索姓名、职务或部门"
        aria-label="搜索联系人"
        @keyup.enter="flush"
      />
      <div class="hidden items-center gap-2 lg:flex">
        <USelect
          v-model="view"
          :items="[{ label: '全部联系人', value: 'all' }, { label: '主联系人', value: 'primary' }, { label: '有星级', value: 'starred' }]"
          aria-label="联系人视图"
        />
        <USelect
          v-model="statusFilter"
          :items="[{ label: '全部状态', value: 'all' }, { label: '有效', value: 'active' }, { label: '停用', value: 'inactive' }]"
          aria-label="联系人状态"
        />
        <UInput
          v-model="decisionRole"
          placeholder="决策角色"
          aria-label="联系人决策角色"
        />
      </div>
      <UPopover>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-list-filter"
          :label="`筛选${activeFilterCount ? ` · ${activeFilterCount}` : ''}`"
          class="lg:hidden"
        />
        <template #content>
          <div class="w-[min(20rem,calc(100vw-2rem))] space-y-3 p-4">
            <USelect
              v-model="view"
              :items="[{ label: '全部联系人', value: 'all' }, { label: '主联系人', value: 'primary' }, { label: '有星级', value: 'starred' }]"
              aria-label="联系人视图"
            />
            <USelect
              v-model="statusFilter"
              :items="[{ label: '全部状态', value: 'all' }, { label: '有效', value: 'active' }, { label: '停用', value: 'inactive' }]"
              aria-label="联系人状态"
            />
            <UInput
              v-model="decisionRole"
              placeholder="决策角色"
              aria-label="联系人决策角色"
            /><p class="text-sm font-medium">
              显示列
            </p><UCheckbox
              v-for="column in optionalColumns"
              :key="column.key"
              :model-value="visibleColumns.includes(column.key)"
              :label="column.label"
              @update:model-value="value => visibleColumns = value ? [...visibleColumns, column.key] : visibleColumns.filter(key => key !== column.key)"
            /><UButton
              color="neutral"
              variant="outline"
              :disabled="!scope || status !== 'ready' || Boolean(permissionError)"
              @click="columnsControl?.save()"
            >
              保存本机视图
            </UButton><UButton
              v-if="search || activeFilterCount"
              color="neutral"
              variant="ghost"
              @click="clearFilters"
            >
              清除筛选
            </UButton>
          </div>
        </template>
      </UPopover>
      <AltocListColumns
        ref="columnsControl"
        v-model="visibleColumns"
        name="contacts"
        :columns="optionalColumns"
        class="ml-auto hidden lg:block"
      />
      <UButton
        v-if="search || activeFilterCount"
        class="hidden lg:flex"
        color="neutral"
        variant="ghost"
        icon="i-lucide-filter-x"
        aria-label="清除筛选"
        @click="clearFilters"
      />
    </div>
    <CommonEmptyState
      v-if="permissionError"
      title="权限加载失败"
    />
    <CommonEmptyState
      v-else-if="!loaded || status !== 'ready'"
      title="正在加载权限"
    />
    <CommonEmptyState
      v-else-if="loaded && !allowed"
      title="无联系人查看权限"
    />
    <CommonEmptyState
      v-else-if="error"
      :title="error"
    >
      <UButton
        color="neutral"
        @click="refresh"
      >
        重试
      </UButton>
    </CommonEmptyState>
    <template v-else>
      <div class="max-w-full overflow-x-auto">
        <UTable
          :data="rows"
          :columns="columns"
          :loading="pending || !loaded"
          class="w-full"
        >
          <template #name-cell="{ row }">
            <UButton
              variant="link"
              color="primary"
              class="max-w-48 whitespace-normal text-left"
              @click="openContact(row.original)"
            >
              {{ row.original.name }}
            </UButton>
          </template>
          <template #position-cell="{ row }">
            <span class="block max-w-48 truncate">{{ row.original.dept_name || '未记录' }} / {{ row.original.job_title || '未记录' }}</span>
          </template>
          <template #contact-cell="{ row }">
            <a
              v-if="contactLink(row.original)"
              :href="contactLink(row.original)"
              class="block max-w-48 truncate text-primary"
              :aria-label="`联系${row.original.name}`"
            >{{ row.original.mobile || row.original.phone || row.original.email }}</a>
            <span
              v-else
              class="block max-w-48 truncate"
            >{{ row.original.mobile || row.original.email || row.original.phone || '未记录' }}</span>
          </template>
          <template #flags-cell="{ row }">
            <div class="flex gap-1">
              <UBadge
                v-if="String(customer.primary_contact_id) === String(row.original.id)"
                variant="subtle"
              >
                主联系人
              </UBadge><UBadge
                v-if="row.original.is_key_contact"
                color="neutral"
                variant="subtle"
              >
                关键联系人
              </UBadge><span>{{ w3StarLabel(row.original.star_level) }}</span>
            </div>
          </template>
          <template #status-cell="{ row }">
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ row.original.status === 'active' ? '有效' : row.original.status === 'inactive' ? '停用' : '其他状态' }}
            </UBadge>
          </template>
          <template #actions-cell="{ row }">
            <UDropdownMenu
              v-if="canEdit"
              :items="menu(row.original)"
            >
              <UButton
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="ghost"
                class="min-h-11 min-w-11"
                :aria-label="`${row.original.name}的操作`"
              />
            </UDropdownMenu>
          </template>
          <template #empty>
            <CommonEmptyState
              :title="search || view !== 'all' || statusFilter !== 'all' || decisionRole ? '没有符合条件的联系人' : '暂无联系人'"
              description="可调整条件，或由有权用户新增联系人。"
            />
          </template>
        </UTable>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span>共 {{ total }} 条</span><UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="20"
          :disabled="pending"
        />
      </div>
    </template>
    <USlideover
      v-model:open="drawer"
      :title="String(selected?.name || '联系人详情')"
      description="当前客户下的联系人资料"
      :ui="{ content: 'w-full sm:max-w-xl' }"
    >
      <template #body>
        <template v-if="selected">
          <section
            v-for="group in [{ title: '身份与职务', keys: ['dept_name', 'job_title', 'decision_role', 'influence_level'] }, { title: '联系方式', keys: ['mobile', 'alternate_mobile', 'phone', 'email', 'wechat', 'mailing_address'] }, { title: '关联与备注', keys: ['remark'] }]"
            :key="group.title"
            class="mb-5 space-y-2"
          >
            <h3 class="font-medium">
              {{ group.title }}
            </h3><dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div
                v-for="key in group.keys"
                :key="key"
                class="min-w-0"
              >
                <dt class="text-sm text-muted">
                  {{ ({ dept_name: '部门', job_title: '职务', decision_role: '决策角色', influence_level: '影响力', mobile: '手机', alternate_mobile: '备用手机', phone: '电话', email: '邮箱', wechat: '微信', mailing_address: '地址', remark: '备注' } as Record<string, string>)[key] }}
                </dt><dd class="break-words">
                  {{ selected[key] || '未记录' }}
                </dd>
              </div>
            </dl>
          </section><W3SourceInfo
            v-if="selected.source_info"
            :source="selected.source_info as W3Record"
          />
        </template>
      </template>
      <template #footer>
        <UButton
          v-if="canEdit && selected"
          @click="drawer = false; emit('edit', selected)"
        >
          编辑联系人
        </UButton>
      </template>
    </USlideover>
  </section>
</template>

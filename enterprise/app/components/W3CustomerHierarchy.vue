<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import CommonEmptyState from '../../../foundation/app/components/common/EmptyState.vue'
import { w3OwnerLabel, type W3Record } from '../utils/w3Presentation'

const props = defineProps<{ statusFilter: string, ownerUnassigned: boolean }>()
const { loaded, error: permissionError, hasPermission } = usePermissions()
const scope = useState<string>('enterprise-cache-scope', () => '')
const { status: accessStatus, refresh: refreshAccess } = useEnterpriseNavigationAccess()
const canView = computed(() => loaded.value && !permissionError.value && hasPermission('customer', 'view'))
const allowed = computed(() => canView.value && accessStatus.value === 'ready' && !!scope.value)
const path = ref<W3Record[]>([])
const page = ref(1)
const pageSize = computed(() => path.value.length ? 50 : 20)
const roots = ref<W3Record[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
interface Branch { rows: W3Record[], page: number, total: number, open: boolean, loading: boolean, error: string }
const branches = ref<Record<string, Branch>>({})
let epoch = 0
const queryFilters = () => ({ ...(props.statusFilter !== 'all' ? { status: props.statusFilter } : {}), ...(props.ownerUnassigned ? { ownerUnassigned: true } : {}) })
async function load() {
  const token = ++epoch
  roots.value = []
  branches.value = {}
  total.value = 0
  error.value = ''
  loading.value = false
  if (!allowed.value) return
  loading.value = true
  try {
    const response = await $fetch<{ data: { items: W3Record[], total: number } }>('/altoc/api/v1/customers', { query: { ...queryFilters(), page: page.value, pageSize: pageSize.value, ...(path.value.length ? { parentId: String(path.value.at(-1)!.id) } : { rootsOnly: true }) }, retry: 0 })
    if (token !== epoch) return
    roots.value = response.data.items
    total.value = response.data.total
  } catch (failure) {
    if (token === epoch) error.value = Number((failure as { statusCode?: number }).statusCode) === 403 ? '无查看权限' : '层级加载失败，请重试'
  } finally { if (token === epoch) loading.value = false }
}
async function expand(row: W3Record, more = false) {
  if (!allowed.value) return
  const id = String(row.id)
  const existing = branches.value[id]
  if (existing?.loading) return
  if (existing && !more && !existing.error) {
    existing.open = !existing.open
    return
  }
  let branch = existing || { rows: [], total: 0, page: 0, open: true, loading: false, error: '' }
  branches.value[id] = branch
  branch = branches.value[id]!
  branch.open = true
  branch.loading = true
  branch.error = ''
  const token = epoch
  const nextPage = more ? branch.page + 1 : 1
  try {
    const response = await $fetch<{ data: { items: W3Record[], total: number } }>('/altoc/api/v1/customers', { query: { ...queryFilters(), parentId: id, page: nextPage, pageSize: 50 }, retry: 0 })
    if (token !== epoch || !allowed.value) return
    branch.rows = more ? [...branch.rows, ...response.data.items] : response.data.items
    branch.total = response.data.total
    branch.page = nextPage
  } catch {
    if (token === epoch) branch.error = '下属加载失败，请重试'
  } finally { if (token === epoch) branch.loading = false }
}
const displayed = computed(() => {
  const rows: W3Record[] = []
  function visit(items: W3Record[], depth: number) {
    for (const item of items) {
      rows.push({ ...item, depth })
      const branch = branches.value[String(item.id)]
      if (branch?.open && depth < 10) visit(branch.rows, depth + 1)
    }
  }
  visit(roots.value, 0)
  return rows
})
const uids = computed(() => displayed.value.map(row => String(row.owner_uid || '')))
const { userName } = useAltocDirectoryLabels(uids)
function drill(row: W3Record) {
  path.value = [...path.value, row]
  page.value = 1
}
function back(index: number) {
  path.value = path.value.slice(0, index)
  page.value = 1
}
watch([() => props.statusFilter, () => props.ownerUnassigned, scope], () => {
  epoch++
  roots.value = []
  branches.value = {}
  total.value = 0
  path.value = []
  page.value = 1
}, { flush: 'sync' })
watch([allowed, scope, page, path, () => props.statusFilter, () => props.ownerUnassigned], () => void load(), { immediate: true })
onScopeDispose(() => {
  epoch++
})
const columns: TableColumn<W3Record>[] = [{ accessorKey: 'name', header: '客户层级' }, { accessorKey: 'owner_uid', header: '负责人', meta: { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' } } }, { accessorKey: 'childCount', header: '可见下属', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } }]
</script>

<template>
  <section class="min-w-0 space-y-3">
    <nav
      aria-label="客户层级钻取路径"
      class="flex flex-wrap items-center gap-1"
    >
      <UButton
        variant="link"
        color="neutral"
        @click="back(0)"
      >
        顶级客户
      </UButton>
      <UButton
        v-for="(ancestor, index) in path"
        :key="String(ancestor.id)"
        variant="link"
        color="neutral"
        class="max-w-48 truncate"
        @click="back(index + 1)"
      >
        {{ ancestor.name }}
      </UButton>
    </nav>
    <p
      v-if="path.at(-1)?.hasHiddenChildren === true"
      class="text-xs text-muted"
    >
      部分下属不可见
    </p>
    <CommonEmptyState
      v-if="permissionError"
      title="权限加载失败"
      description="无法确认客户范围，请重新加载权限。"
    />
    <CommonEmptyState
      v-else-if="loaded && !canView"
      title="无查看权限"
    />
    <CommonEmptyState
      v-else-if="accessStatus === 'unavailable'"
      title="访问状态暂不可用"
      description="无法确认当前客户范围，请重试。"
    >
      <UButton @click="refreshAccess">
        重试
      </UButton>
    </CommonEmptyState>
    <p
      v-else-if="!allowed"
      role="status"
      class="text-sm text-muted"
    >
      正在加载客户访问状态…
    </p>
    <CommonEmptyState
      v-else-if="error"
      title="层级不可用"
      :description="error"
    >
      <UButton @click="load">
        重试
      </UButton>
    </CommonEmptyState>
    <template v-else>
      <UTable
        :data="displayed"
        :columns="columns"
        :loading="loading || !loaded"
        class="hidden w-full sm:block"
      >
        <template #name-cell="{ row }">
          <div
            class="min-w-0 sm:pl-[calc(var(--depth)*1rem)]"
            :style="{ '--depth': Number(row.original.depth) }"
          >
            <div class="flex min-w-0 items-center gap-1">
              <UButton
                v-if="Number(row.original.childCount) > 0 && Number(row.original.depth) < 10"
                class="hidden shrink-0 sm:inline-flex"
                color="neutral"
                variant="ghost"
                size="xs"
                :icon="branches[String(row.original.id)]?.open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                :aria-label="`${branches[String(row.original.id)]?.open ? '收起' : '展开'}${row.original.name}`"
                :loading="branches[String(row.original.id)]?.loading"
                @click="expand(row.original)"
              />
              <NuxtLink
                :to="`/altoc/customers/${row.original.id}`"
                class="block max-w-36 truncate text-primary sm:max-w-64"
              >{{ row.original.name }}</NuxtLink>
              <UButton
                v-if="Number(row.original.childCount) > 0"
                class="shrink-0 sm:hidden"
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-chevron-right"
                :aria-label="`查看${row.original.name}的下属`"
                @click="drill(row.original)"
              />
            </div>
            <p
              v-if="row.original.hasHiddenChildren === true"
              class="text-xs text-muted"
            >
              部分下属不可见
            </p>
            <template v-if="branches[String(row.original.id)]?.open">
              <p
                v-if="branches[String(row.original.id)]?.error"
                class="text-xs text-error"
              >
                {{ branches[String(row.original.id)]?.error }}<UButton
                  size="xs"
                  variant="link"
                  @click="expand(row.original)"
                >
                  重试
                </UButton>
              </p>
              <UButton
                v-if="(branches[String(row.original.id)]?.rows.length || 0) < (branches[String(row.original.id)]?.total || 0)"
                color="neutral"
                variant="link"
                size="xs"
                :loading="branches[String(row.original.id)]?.loading"
                @click="expand(row.original, true)"
              >
                加载更多下属
              </UButton>
            </template>
          </div>
        </template>
        <template #childCount-cell="{ row }">
          {{ row.original.childCount ?? '—' }}
        </template>
        <template #owner_uid-cell="{ row }">
          {{ w3OwnerLabel(row.original.owner_uid, userName(row.original.owner_uid)) }}
        </template>
        <template #empty>
          <CommonEmptyState
            title="暂无可查看的客户"
            description="仅展示您有权查看的客户；可返回上级或调整筛选。"
          />
        </template>
      </UTable>
      <div class="space-y-3 sm:hidden">
        <UProgress
          v-if="loading || !loaded"
          aria-label="加载客户层级"
        />
        <CommonEmptyState
          v-else-if="!roots.length"
          title="暂无可查看的客户"
          description="可返回上级或调整筛选。"
        />
        <article
          v-for="item in roots"
          :key="String(item.id)"
          class="min-w-0 space-y-2 rounded-lg border border-default p-3"
        >
          <NuxtLink
            :to="`/altoc/customers/${item.id}`"
            class="block truncate font-medium text-primary"
          >{{ item.name }}</NuxtLink>
          <p class="break-words text-xs text-muted">
            {{ w3OwnerLabel(item.owner_uid, userName(item.owner_uid)) }} · 可见下属 {{ item.childCount ?? '—' }}
          </p>
          <p
            v-if="item.hasHiddenChildren === true"
            class="text-xs text-muted"
          >
            部分下属不可见
          </p>
          <UButton
            v-if="Number(item.childCount) > 0"
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-chevron-right"
            @click="drill(item)"
          >
            查看直接下属
          </UButton>
        </article>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p>共 {{ total }} 条</p><UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="pageSize"
          :sibling-count="0"
          :show-edges="false"
        />
      </div>
    </template>
  </section>
</template>

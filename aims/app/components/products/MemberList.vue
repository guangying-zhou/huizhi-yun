<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const props = defineProps<{ productCode: string }>()
const emit = defineEmits<{ changed: [] }>()
interface Member {
  id: number
  uid: string
  relation_type: 'manager' | 'contributor' | 'viewer'
  status: 'active' | 'inactive'
  valid_from: string
  valid_until: string | null
  effective: boolean
  revision: number
}
interface MemberPage { items: Member[], total: number, workspace_revision: number }
const editing = ref<{ member?: Member, revoke?: boolean } | null>(null)
async function saved() {
  editing.value = null
  await refresh()
  emit('changed')
}
const page = ref(1)
const relation = ref('all')
const memberStatus = ref('all')
const query = computed(() => ({ page: page.value, pageSize: 20,
  relationType: relation.value === 'all' ? undefined : relation.value,
  status: memberStatus.value === 'all' ? undefined : memberStatus.value
}))
watch([relation, memberStatus, () => props.productCode], () => {
  page.value = 1
})
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/members`, {
  server: false, query,
  transform: (response: { code: number, data: MemberPage }) => {
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total)) throw new Error('成员列表响应不完整')
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '产品成员加载失败' })
const labels = { manager: '产品经理', contributor: '贡献者', viewer: '查看者' }
const columns: TableColumn<Member>[] = [
  { accessorKey: 'uid', header: '成员 UID' },
  { accessorKey: 'relation_type', header: '产品关系' },
  { accessorKey: 'effective', header: '当前关系' },
  { accessorKey: 'valid_until', header: '有效期间' },
  { id: 'actions', header: '操作' }
]
</script>

<template>
  <section class="min-w-0 space-y-3 rounded-lg border border-default p-4" aria-label="产品成员">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="font-medium">
        产品成员
      </h2>
      <UButton
        color="neutral"
        variant="ghost"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新成员
      </UButton>
    </div>
    <p class="text-sm text-muted">
      成员关系用于产品数据范围判断。关系当前有效不代表用户仍在职，也不自动授予操作权限。
    </p>
    <div class="flex flex-wrap gap-3">
      <UFormField label="产品关系" name="memberRelation">
        <USelect v-model="relation" :items="[{ label: '全部关系', value: 'all' }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]" />
      </UFormField>
      <UFormField label="记录状态" name="memberStatus">
        <USelect v-model="memberStatus" :items="[{ label: '全部状态', value: 'all' }, { label: '启用', value: 'active' }, { label: '停用', value: 'inactive' }]" />
      </UFormField>
    </div>
    <UButton v-if="status === 'success' && !editing" icon="i-lucide-user-plus" @click="editing = {}">
      新增成员
    </UButton>
    <ProductsMemberForm
      v-if="editing && data"
      :product-code="productCode"
      :workspace-revision="data.workspace_revision"
      :member="editing.member"
      :revoke="editing.revoke"
      @saved="saved"
      @cancel="editing = null"
    />
    <UAlert v-if="alert" v-bind="alert" />
    <UTable :data="status === 'success' ? data?.items || [] : []" :columns="columns" :loading="status === 'pending'">
      <template #relation_type-cell="{ row }">
        {{ labels[row.original.relation_type] }}
      </template>
      <template #effective-cell="{ row }">
        <UBadge :color="row.original.effective ? 'success' : 'neutral'" variant="subtle">
          {{ row.original.effective ? '当前有效' : '当前无效' }}
        </UBadge>
        <p class="mt-1 text-xs text-muted">
          {{ row.original.status === 'active' ? '启用' : '停用' }}
        </p>
      </template>
      <template #valid_until-cell="{ row }">
        <p>{{ formatDateTime(row.original.valid_from) }}</p>
        <p class="text-xs text-muted">
          至 {{ row.original.valid_until ? formatDateTime(row.original.valid_until) : '长期有效' }}
        </p>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="!!editing"
            @click="editing = { member: row.original }"
          >
            修改
          </UButton>
          <UButton
            color="warning"
            variant="ghost"
            :disabled="!!editing || row.original.status === 'inactive'"
            @click="editing = { member: row.original, revoke: true }"
          >
            撤销
          </UButton>
        </div>
      </template>
      <template #empty>
        <CommonEmptyState :title="status === 'pending' ? '正在加载成员…' : error ? '暂时无法显示成员' : '没有符合条件的成员'" icon="i-lucide-users" />
      </template>
    </UTable>
    <div v-if="status === 'success'" class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">共 {{ data?.total || 0 }} 条关系</span>
      <UPagination
        v-model:page="page"
        :total="data?.total || 0"
        :items-per-page="20"
        :sibling-count="0"
        show-edges
      />
    </div>
  </section>
</template>

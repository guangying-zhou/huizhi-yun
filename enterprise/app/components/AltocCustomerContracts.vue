<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import CommonEmptyState from '../../../foundation/app/components/common/EmptyState.vue'
import { formatMoney } from '../../../foundation/app/utils/format'
import { contractListAmount } from '../utils/altocContractList'
import { altocContractStatusLabels } from '../utils/altocBusinessObjectPresentation'
import type { W3Record } from '../utils/w3Presentation'

const props = defineProps<{
  customerId: string
  active: boolean
}>()
const emit = defineEmits<{
  summary: [
        value: W3Record | null
  ]
  state: [
        value: string
  ]
}>()
const { loaded, error: permissionError, hasPermission } = usePermissions()
const { status } = useEnterpriseNavigationAccess()
const scope = useState<string>('enterprise-cache-scope', () => '')
const allowed = computed(() => loaded.value && !permissionError.value && status.value === 'ready' && !!scope.value && hasPermission('contract', 'view'))
const page = ref(1), total = ref(0), rows = ref<W3Record[]>([]), pending = ref(false), error = ref('')
const columns: TableColumn<W3Record>[] = [{ accessorKey: 'name', header: '合同名称 / 编号' }, { accessorKey: 'status', header: '状态' }, { id: 'amount', header: '合同金额', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } }]
let generation = 0
watch([() => props.customerId, scope, allowed], () => {
  page.value = 1
  rows.value = []
  total.value = 0
  emit('summary', null)
}, { flush: 'sync' })
async function refresh() {
  const epoch = ++generation
  error.value = ''
  pending.value = false
  if (!allowed.value) {
    rows.value = []
    total.value = 0
    emit('summary', null)
    emit('state', permissionError.value ? '权限加载失败' : loaded.value ? '无合同查看权限' : '正在加载权限')
    return
  }
  pending.value = true
  emit('state', '正在加载合同汇总')
  try {
    const size = props.active ? 20 : 1
    const result = await $fetch<{
      data: {
        items: W3Record[]
        total: number
        page: number
        pageSize: number
        rollup: W3Record
      }
    }>('/altoc/api/v1/contracts', { retry: 0, query: { customerId: props.customerId, page: page.value, pageSize: size } })
    if (epoch !== generation)
      return
    if (!Array.isArray(result.data.items) || result.data.page !== page.value || result.data.pageSize !== size || !Number.isSafeInteger(result.data.total))
      throw Error('Invalid customer contract page')
    rows.value = result.data.items
    total.value = result.data.total
    emit('summary', result.data.rollup)
    emit('state', '')
  } catch (failure) {
    if (epoch === generation) {
      rows.value = []
      total.value = 0
      emit('summary', null)
      error.value = Number((failure as {
        statusCode?: number
      }).statusCode) === 403
        ? '无合同查看权限'
        : '合同资料暂不可用，请重试'
      emit('state', error.value)
    }
  } finally {
    if (epoch === generation)
      pending.value = false
  }
}
watch([() => props.customerId, () => props.active, allowed, scope, page], () => void refresh(), { immediate: true })
onScopeDispose(() => {
  generation++
})
</script>

<template>
  <section
    v-if="active"
    class="min-w-0 space-y-4"
  >
    <p class="text-sm text-muted">
      仅本客户的可见合同；合同数据范围独立于客户数据范围。
    </p>
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
      title="无合同查看权限"
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
            <NuxtLink
              :to="{ path: `/altoc/contracts/${row.original.id}`, query: { returnCustomerId: customerId } }"
              class="block max-w-64 break-words text-primary"
            >{{ row.original.name }}<span class="block text-xs text-muted">{{ row.original.contract_no || row.original.code }}</span></NuxtLink>
          </template>
          <template #status-cell="{ row }">
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ altocContractStatusLabels[String(row.original.status)] || '其他状态' }}
            </UBadge>
          </template>
          <template #amount-cell="{ row }">
            {{ contractListAmount(row.original).value == null ? '未记录' : formatMoney(String(contractListAmount(row.original).value), { currency: String(row.original.currency_code || 'CNY') }) }}<span class="block text-xs text-muted">{{ contractListAmount(row.original).label }}</span>
          </template>
          <template #empty>
            <CommonEmptyState
              title="暂无可查看的合同"
              description="仅显示合同权限范围内的记录，不代表客户没有其他合同。"
            />
          </template>
        </UTable>
      </div><div class="flex flex-wrap items-center justify-between gap-2">
        <span>共 {{ total }} 条</span><UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="20"
          :disabled="pending"
        />
      </div>
    </template>
  </section>
</template>

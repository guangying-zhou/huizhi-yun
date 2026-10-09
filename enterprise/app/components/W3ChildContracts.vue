<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import CommonEmptyState from '../../../foundation/app/components/common/EmptyState.vue'
import { formatMoney } from '../../../foundation/app/utils/format'
import type { W3Record } from '../utils/w3Presentation'

const props = defineProps<{ contractId: string }>()
const { loaded, error: permissionError, hasPermission } = usePermissions()
const { status } = useEnterpriseNavigationAccess()
const scope = useState<string>('enterprise-cache-scope', () => '')
const allowed = computed(() => loaded.value && !permissionError.value && hasPermission('contract', 'view') && status.value === 'ready' && !!scope.value)
const page = ref(1), total = ref(0), pending = ref(false), error = ref('')
const rows = ref<W3Record[]>([])
const columns: TableColumn<W3Record>[] = [{ accessorKey: 'name', header: '下级合同' }, { accessorKey: 'amount_tax_inclusive', header: '当前合同额', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } }]
let generation = 0
async function refresh() {
  const epoch = ++generation
  rows.value = []
  total.value = 0
  error.value = ''
  pending.value = false
  if (!allowed.value) return
  pending.value = true
  try {
    const result = await $fetch<{ data: { items: W3Record[], total: number, page: number, pageSize: number } }>('/altoc/api/v1/contracts', { query: { parentContractId: props.contractId, page: page.value, pageSize: 20 }, retry: 0 })
    if (epoch !== generation) return
    if (!Array.isArray(result.data.items) || !Number.isSafeInteger(result.data.total) || result.data.page !== page.value || result.data.pageSize !== 20) throw Error('Invalid child contract page')
    rows.value = result.data.items
    total.value = result.data.total
  } catch {
    if (epoch === generation) error.value = '下级合同加载失败，请重试'
  } finally {
    if (epoch === generation) pending.value = false
  }
}
watch([() => props.contractId, scope], () => {
  page.value = 1
}, { flush: 'sync' })
watch([() => props.contractId, scope, allowed, page], () => void refresh(), { immediate: true })
onScopeDispose(() => {
  generation++
})
</script>

<template>
  <section class="min-w-0 space-y-3">
    <h2 class="font-semibold">
      下级合同
    </h2>
    <CommonEmptyState
      v-if="permissionError"
      title="权限加载失败"
    />
    <CommonEmptyState
      v-else-if="loaded && !allowed"
      title="无下级合同查看权限"
    />
    <CommonEmptyState
      v-else-if="error"
      title="下级合同不可用"
      :description="error"
    >
      <UButton
        color="neutral"
        @click="refresh"
      >
        重试
      </UButton>
    </CommonEmptyState>
    <template v-else>
      <UTable
        :data="rows"
        :columns="columns"
        :loading="pending"
        class="hidden sm:block"
      >
        <template #name-cell="{ row }">
          <NuxtLink
            :to="`/altoc/contracts/${row.original.id}`"
            class="block max-w-40 truncate text-primary sm:max-w-80"
          >{{ row.original.name }}</NuxtLink>
        </template>
        <template #amount_tax_inclusive-cell="{ row }">
          {{ formatMoney(String(row.original.amount_tax_inclusive), { currency: String(row.original.currency_code) }) }}
        </template>
        <template #empty>
          <CommonEmptyState
            title="暂无可查看的下级合同"
            description="仅显示当前合同读权限范围内的下级合同。"
          />
        </template>
      </UTable>
      <div class="space-y-3 sm:hidden">
        <p
          v-if="pending"
          role="status"
          class="text-sm text-muted"
        >
          正在加载下级合同…
        </p>
        <CommonEmptyState
          v-else-if="!rows.length"
          title="暂无可查看的下级合同"
          description="仅显示当前合同读权限范围内的下级合同。"
        />
        <article
          v-for="row in rows"
          :key="String(row.id)"
          class="min-w-0 space-y-2 rounded-lg border border-default p-3"
        >
          <NuxtLink
            :to="`/altoc/contracts/${row.id}`"
            class="block break-words font-medium text-primary"
          >{{ row.name }}</NuxtLink>
          <p class="break-all text-right text-sm tabular-nums">
            当前合同额 {{ formatMoney(String(row.amount_tax_inclusive), { currency: String(row.currency_code) }) }}
          </p>
        </article>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span>共 {{ total }} 条</span><UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="20"
        />
      </div>
    </template>
  </section>
</template>

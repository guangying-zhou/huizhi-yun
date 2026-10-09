<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import { queueError, type QueueRow } from '../../utils/w3MigrationQueue'

const props = defineProps<{ row: QueueRow }>()
const { sessionScope } = useFinanceModule()
const { loaded, error: permissionError, hasPermission } = usePermissions()
const allowed = computed(() => loaded.value && !permissionError.value && hasPermission('migration_exceptions', 'view'))
const open = ref(false), page = ref(1), total = ref(0), pending = ref(false), error = ref('')
const entries = ref<QueueRow[]>([])
const columns: TableColumn<QueueRow>[] = [{ accessorKey: 'sourceEntryId', header: '源登记ID' }, { accessorKey: 'amount', header: '金额', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } }, { accessorKey: 'recordedAt', header: '登记时间' }, { accessorKey: 'recordedByName', header: '历史登记人' }]
let generation = 0
async function refresh() {
  const epoch = ++generation
  entries.value = []
  total.value = 0
  error.value = ''
  pending.value = false
  if (!open.value || !allowed.value) return
  pending.value = true
  try {
    const result = await $fetch<{ data: QueueRow[], total: number, page: number, pageSize: number }>('/finance/api/v1/migration/exceptions', { query: { kind: 'balance_without_account', exceptionId: String(props.row.id), page: page.value, pageSize: 20 }, retry: 0 })
    if (epoch !== generation) return
    if (!Array.isArray(result.data) || !Number.isSafeInteger(result.total) || result.page !== page.value || result.pageSize !== 20) throw Error('登记明细响应无效')
    entries.value = result.data
    total.value = result.total
  } catch (failure) {
    if (epoch === generation) error.value = queueError(failure)
  } finally {
    if (epoch === generation) pending.value = false
  }
}
watch([open, page, allowed], () => void refresh())
watch([() => props.row.id, () => sessionScope?.value], () => {
  generation++
  open.value = false
  page.value = 1
  entries.value = []
})
onScopeDispose(() => {
  generation++
})
</script>

<template>
  <UButton
    v-if="allowed && row.kind === 'balance_without_account'"
    color="neutral"
    variant="link"
    @click="page = 1; open = true"
  >
    查看原始登记明细
  </UButton>
  <USlideover
    v-model:open="open"
    title="余额待认领登记明细"
    description="只展示迁移事项关联的白名单历史记录，不代表实时账户余额。"
    :ui="{ content: 'w-full sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4">
        <CommonEmptyState
          v-if="error"
          title="登记明细加载失败"
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
          <div class="hidden sm:block">
            <UTable
              :data="entries"
              :columns="columns"
              :loading="pending"
            >
              <template #empty>
                <CommonEmptyState
                  title="暂无登记明细"
                  description="该事项暂无可展示的关联源记录。"
                />
              </template>
            </UTable>
          </div>
          <div class="space-y-2 sm:hidden">
            <p
              v-if="pending"
              role="status"
            >
              加载中
            </p><CommonEmptyState
              v-else-if="!entries.length"
              title="暂无登记明细"
            /><article
              v-for="entry in entries"
              :key="String(entry.sourceEntryId)"
              class="space-y-1 rounded border border-muted p-3"
            >
              <p class="break-words">
                源登记 {{ entry.sourceEntryId }} · {{ entry.amount }}
              </p><p class="break-words text-sm text-muted">
                {{ entry.recordedAt || '未登记时间' }} · {{ entry.recordedByName || '历史登记人未提供' }}
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
      </div>
    </template>
  </USlideover>
</template>

<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'
import { provisioningStatusLabels } from '../utils/peopleProvisioningRecovery'

type Row = { operation_id: string, operation_code: string, status: string, attempt_count: number, max_attempts: number, version_no: number, replay_count: number, last_http_status: number }
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
const { status: accessStatus } = useEnterpriseNavigationAccess()
const scope = useState<string>('enterprise-cache-scope', () => '')
const canRead = computed(() => loaded.value && !permissionError.value && accessStatus.value === 'ready' && hasPermission('integration_operations', 'view'))
const canReplay = computed(() => canRead.value && hasPermission('integration_operations', 'replay'))
const rows = ref<Row[]>([])
const page = ref(1)
const total = ref(0)
const pending = ref(false)
const error = ref('')
const selected = ref<Row | null>(null)
const open = ref(false)
const target = ref<{ lifecycleType: string, directoryStatus: string, platformStatus: string } | null>(null)
const inspecting = ref(false)
const replaying = ref(false)
const retry = ref<Row | null>(null)
let replayIntent = createConsoleMutationIntent('people-directory-replay')
const { confirm } = useConfirm()
const columns: TableColumn<Row>[] = [{ accessorKey: 'operation_id', header: '操作' }, { accessorKey: 'operation_code', header: '类型' }, { accessorKey: 'status', header: '状态' }, { id: 'attempts', header: '尝试次数' }, { id: 'actions', header: '诊断' }]
const labels: Record<string, string> = { ...provisioningStatusLabels, superseded: '已被后续版本替代' }
let epoch = 0
async function load() {
  const version = ++epoch
  rows.value = []
  total.value = 0
  if (!canRead.value || !scope.value) return
  pending.value = true
  error.value = ''
  try {
    const out = await $fetch<{ data: Row[], total: number }>('/enterprise/api/apf/people/directory-operations', { query: { page: page.value, pageSize: 20 } })
    if (epoch === version) {
      rows.value = out.data
      total.value = out.total
    }
  } catch {
    if (epoch === version) error.value = '目录投递读取失败；此页需要租户全局的跨应用操作查看权限。'
  } finally { if (epoch === version) pending.value = false }
}
async function inspect(row: Row) {
  if (!canRead.value || inspecting.value) return
  const current = epoch
  selected.value = row
  target.value = null
  open.value = true
  inspecting.value = true
  error.value = ''
  try {
    const out = await $fetch<{ data: { lifecycleType: string, directoryStatus: string, platformStatus: string } }>(`/enterprise/api/apf/people/directory-operations/${row.operation_id}/probe`)
    if (current === epoch) target.value = out.data
  } catch {
    if (current === epoch) error.value = '目标状态尚未确认，查询失败不代表已投递成功。请稍后重新核对。'
  } finally { inspecting.value = false }
}
async function replay(row: Row) {
  if (!canReplay.value || !scope.value || replaying.value) return
  const currentScope = scope.value
  if (!replayIntent.uncertain) {
    if (!['failed_permanent', 'dead_letter'].includes(row.status) || !replayIntent.reset()) return
    if (!await confirm({ title: '恢复原目录命令', message: '仅重排原命令与原幂等键；不会修改员工资料或将目标强制标为成功。', tone: 'warning' })) return
    if (scope.value !== currentScope || !canReplay.value) return
    retry.value = { ...row }
  }
  const original = retry.value
  if (!original) return
  replaying.value = true
  error.value = ''
  try {
    if (await replayIntent.submit({ method: 'POST', path: `/enterprise/api/apf/people/directory-operations/${original.operation_id}/replay`, body: { expectedVersion: Number(original.version_no), reason: '人工确认恢复原目录生命周期命令' } }, async (request, key) => {
      await $fetch(request.path, { method: 'POST', body: request.body, headers: { 'Idempotency-Key': key } })
    })) {
      if (scope.value !== currentScope) return
      retry.value = null
      open.value = false
      await load()
    }
  } catch {
    if (scope.value !== currentScope) return
    error.value = '恢复未确认；版本或权限变化会拒绝操作，结果不确定时只能重试原操作。'
  } finally { replaying.value = false }
}
onMounted(() => {
  void loadPermissions()
})
watch(scope, () => {
  retry.value = null
  selected.value = null
  replayIntent = createConsoleMutationIntent('people-directory-replay')
})
watch([canRead, scope, page], () => {
  open.value = false
  target.value = null
  void load()
}, { immediate: true })
onScopeDispose(() => {
  epoch++
})
</script>

<template>
  <UDashboardPanel>
    <template #body>
      <div class="p-4 space-y-4 min-w-0">
        <ContentPageHeader
          hosted
          title="目录投递与恢复"
          breadcrumb="人力资源 / 员工管理 / 目录投递与恢复"
          description="分别核对 Console 与 Platform 的确认状态；LDAP、邮箱停用合同尚未开放，不在此页标记完成。"
        />
        <UAlert
          v-if="permissionError"
          color="error"
          title="权限信息加载失败"
        />
        <UAlert
          v-if="error"
          color="error"
          :title="error"
        />
        <UButton
          v-if="replayIntent.uncertain && retry"
          color="neutral"
          variant="outline"
          :loading="replaying"
          @click="replay(retry)"
        >
          重试原恢复操作
        </UButton>
        <div class="overflow-x-auto">
          <UTable
            :data="rows"
            :columns="columns"
            :loading="pending"
          >
            <template #empty>
              <CommonEmptyState :title="canRead ? '暂无目录投递记录' : '无权查看'" />
            </template>
            <template #operation_id-cell="{ row }">
              <span class="font-mono text-xs break-all">{{ row.original.operation_id }}</span>
            </template>
            <template #operation_code-cell="{ row }">
              {{ row.original.operation_code === 'people.directory.offboarding-disable.v1' ? '离职停用与撤权' : '任职与权限同步' }}
            </template>
            <template #status-cell="{ row }">
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ labels[row.original.status] || '尚未确认' }}
              </UBadge>
            </template>
            <template #attempts-cell="{ row }">
              {{ row.original.attempt_count }} / {{ row.original.max_attempts }}
            </template>
            <template #actions-cell="{ row }">
              <UButton
                color="neutral"
                variant="outline"
                size="xs"
                :disabled="inspecting"
                @click="inspect(row.original)"
              >
                核对目标状态
              </UButton>
            </template>
          </UTable>
        </div>
        <div class="flex flex-col sm:flex-row sm:justify-between gap-2">
          <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
            v-model:page="page"
            :total="total"
            :items-per-page="20"
          />
        </div>
        <USlideover
          v-model:open="open"
          title="目录生命周期诊断"
          description="仅展示原命令的确认状态；不显示命令正文、凭据或原始错误。"
          :ui="{ content: 'w-full sm:max-w-2xl' }"
        >
          <template #body>
            <div class="space-y-4">
              <p v-if="inspecting">
                正在查询目标状态…
              </p>
              <template v-if="target">
                <p>Console 目录／会话：{{ labels[target.directoryStatus] || '尚未确认' }}</p><p>Platform {{ target.lifecycleType === 'offboarding' ? '撤权' : '授权同步' }}：{{ labels[target.platformStatus] || '尚未确认' }}</p>
              </template>
              <p class="text-sm text-muted">
                结果待核对或处理中时不可强制恢复。目标端查询失败不改变投递状态；原命令由唯一 owner 有界重试。
              </p>
              <UButton
                v-if="canReplay && selected && ['failed_permanent', 'dead_letter'].includes(selected.status)"
                :disabled="replayIntent.uncertain"
                :loading="replaying"
                @click="replay(selected)"
              >
                恢复原命令
              </UButton>
            </div>
          </template>
        </USlideover>
      </div>
    </template>
  </UDashboardPanel>
</template>

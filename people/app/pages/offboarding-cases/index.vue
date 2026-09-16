<script setup lang="ts">
import type { ApiResponse, OffboardingCaseDetail, OffboardingCaseList } from '~/types'

usePageTitle('离职交接')

const toast = useToast()
const { ensurePeoplePermission } = usePeopleAuthorization()
const createOpen = ref(false)
const saving = ref(false)
const form = reactive({
  leaveAssignmentCode: '',
  handoverResponsibleUid: '',
  handoverDueAt: '',
  assetResponsibleUid: '',
  assetDueAt: ''
})

const { data: response, refresh, error, status } = await useLazyFetch<ApiResponse<OffboardingCaseList>>('/api/v1/offboarding-cases', {
  query: { limit: 100 }
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)
const items = computed(() => response.value?.data.items || [])
const rows = computed(() => items.value.map(item => ({
  ...item,
  caseCode: item.case.caseCode,
  employeeUid: item.case.employeeUid,
  leaveAssignmentCode: item.case.leaveAssignmentCode,
  status: item.case.status,
  pendingTasks: item.tasks.filter(task => task.status === 'pending').length,
  nextDueAt: item.tasks
    .filter(task => task.status === 'pending')
    .map(task => task.dueAt)
    .sort()[0] || '-'
})))
const columns = [
  { accessorKey: 'caseCode', header: '离职事项' },
  { accessorKey: 'employeeUid', header: '员工 UID' },
  { accessorKey: 'leaveAssignmentCode', header: '离职任职记录' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'pendingTasks', header: '待办数' },
  { accessorKey: 'nextDueAt', header: '最近期限' }
]

async function openCreate() {
  const permission = await ensurePeoplePermission('offboarding_tasks', 'admin')
  if (!permission.authorized) {
    toast.add({ title: '当前角色无权限', description: '创建离职事项需要离职交接管理权限。', color: 'warning' })
    return
  }
  createOpen.value = true
}

function resetForm() {
  form.leaveAssignmentCode = ''
  form.handoverResponsibleUid = ''
  form.handoverDueAt = ''
  form.assetResponsibleUid = ''
  form.assetDueAt = ''
}

async function createCase() {
  const leaveAssignmentCode = form.leaveAssignmentCode.trim()
  const handoverResponsibleUid = form.handoverResponsibleUid.trim()
  const assetResponsibleUid = form.assetResponsibleUid.trim()
  if (!leaveAssignmentCode || !handoverResponsibleUid || !form.handoverDueAt || !assetResponsibleUid || !form.assetDueAt) {
    toast.add({ title: '信息不完整', description: '离职任职记录、两类责任人和期限均为必填。', color: 'warning' })
    return
  }
  if ([handoverResponsibleUid, assetResponsibleUid].some(uid => uid.toLowerCase() === '@all')) {
    toast.add({ title: '责任人无效', description: '责任人必须是明确用户 UID，不能使用 @all。', color: 'warning' })
    return
  }

  saving.value = true
  try {
    const created = await $fetch<ApiResponse<OffboardingCaseDetail & { idempotent: boolean }>>('/api/v1/offboarding-cases', {
      method: 'POST',
      headers: { 'idempotency-key': `people:offboarding:${leaveAssignmentCode}:v1` },
      body: {
        leaveAssignmentCode,
        handover: {
          responsibleUid: handoverResponsibleUid,
          dueAt: new Date(form.handoverDueAt).toISOString()
        },
        assetRecoveryCoordination: {
          responsibleUid: assetResponsibleUid,
          dueAt: new Date(form.assetDueAt).toISOString()
        }
      }
    })
    toast.add({ title: created.data.idempotent ? '离职事项已存在' : '离职事项已创建', color: 'success' })
    createOpen.value = false
    resetForm()
    await refresh()
    await navigateTo(`/offboarding-cases/${encodeURIComponent(created.data.case.caseCode)}`)
  } catch (errorValue) {
    console.error('[PeopleOffboarding] create failed', errorValue)
    toast.add({ title: '创建失败', description: '请确认离职任职记录已生效、责任人有效且请求未发生冲突。', color: 'error' })
  } finally {
    saving.value = false
  }
}

function openCase(_event: Event, row: { original: { caseCode: string } }) {
  navigateTo(`/offboarding-cases/${encodeURIComponent(row.original.caseCode)}`)
}
</script>

<template>
  <div class="contents">
    <UDashboardPanel
      id="people-offboarding-cases"
      grow
    >
      <template #body>
        <Teleport to="#people-layout-header-actions">
          <UButton
            icon="i-lucide-plus"
            color="primary"
            variant="soft"
            @click="openCreate"
          >
            创建离职事项
          </UButton>
        </Teleport>

        <div class="space-y-4 p-4">
          <UAlert
            color="info"
            variant="soft"
            icon="i-lucide-shield-check"
            title="业务交接与账号停用分离"
            description="此处只管理工作交接和资产回收协调责任。Console 账号停用、会话撤销和 Platform 授权回收失败由 Console 独立处理；实际资产是否归还以 Assets 当前事实为准。"
          />
          <UAlert
            v-if="error"
            color="warning"
            variant="soft"
            icon="i-lucide-database-zap"
            title="离职事项暂不可用"
            description="请确认 People data-runtime 已应用离职任务迁移并可访问。"
          />
          <UCard>
            <template #header>
              <div class="flex items-center justify-between gap-3">
                <span class="font-semibold">当前可访问事项</span>
                <UBadge
                  color="neutral"
                  variant="soft"
                >
                  {{ rows.length }} 条
                </UBadge>
              </div>
            </template>
            <div class="overflow-x-auto">
              <UTable
                :data="rows"
                :columns="columns"
                :loading="status === 'pending'"
                @select="openCase"
              >
                <template #empty>
                  <CommonEmptyState
                    icon="i-lucide-user-minus"
                    title="暂无离职案例"
                  />
                </template>
              </UTable>
            </div>
          </UCard>
        </div>
      </template>
    </UDashboardPanel>

    <UModal
      v-model:open="createOpen"
      title="创建离职交接事项"
      description="必须基于一条已生效的离职任职记录，并为每类协调任务指定明确责任人。"
      :ui="{ content: 'sm:max-w-3xl' }"
    >
      <template #body>
        <div class="grid gap-4 p-4 md:grid-cols-2">
          <UFormField
            label="离职任职记录编码"
            required
            class="md:col-span-2"
          >
            <UInput
              v-model="form.leaveAssignmentCode"
              class="w-full"
              placeholder="例如：ASN-LEAVE-001"
            />
          </UFormField>
          <UFormField
            label="工作交接责任人 UID"
            required
          >
            <UInput
              v-model="form.handoverResponsibleUid"
              class="w-full"
              placeholder="明确用户 UID"
            />
          </UFormField>
          <UFormField
            label="工作交接期限"
            required
          >
            <UInput
              v-model="form.handoverDueAt"
              type="datetime-local"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="资产回收协调责任人 UID"
            required
          >
            <UInput
              v-model="form.assetResponsibleUid"
              class="w-full"
              placeholder="明确用户 UID"
            />
          </UFormField>
          <UFormField
            label="资产回收协调期限"
            required
          >
            <UInput
              v-model="form.assetDueAt"
              type="datetime-local"
              class="w-full"
            />
          </UFormField>
          <UAlert
            class="md:col-span-2"
            color="warning"
            variant="soft"
            title="确认边界"
            description="确认资产回收协调任务仅表示协调工作已确认，不代表 Assets 中的设备、账号或席位已经实际归还。"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="createOpen = false"
          >
            取消
          </UButton>
          <UButton
            color="primary"
            :loading="saving"
            @click="createCase"
          >
            创建
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

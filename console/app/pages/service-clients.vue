<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('服务凭证')

interface RepairResult {
  status: 'reconciled'
  serviceClientCode: string
  grants: string[]
}

interface ApiResponse<T> {
  code: number
  data: T
}

const toast = useToast()
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const repairing = ref(false)
const repairResult = ref<RepairResult | null>(null)

if (!permissionsLoaded.value) {
  await loadPermissions()
}

const canAdminServiceClients = computed(
  () => permissionsLoaded.value && hasPermission('service_clients', 'admin')
)

async function reconcileAimsCodocsRuntimeRead() {
  if (!canAdminServiceClients.value || repairing.value) return

  repairing.value = true
  try {
    const response = await $fetch<ApiResponse<RepairResult>>(
      '/api/v1/console/service-clients/repairs/aims-codocs-runtime-read',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {}
      }
    )
    repairResult.value = response.data
    toast.add({
      title: 'AIMS 文档访问授权已校验',
      description: '已确保 aims.runtime 具备 Codocs 只读运行时权限。',
      color: 'success'
    })
  } catch (error: unknown) {
    const failure = error as { data?: { message?: string }, message?: string }
    toast.add({
      title: '授权修复失败',
      description: failure.data?.message || failure.message || '请查看运行时日志。',
      color: 'error'
    })
  } finally {
    repairing.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="service-clients" :ui="dashboardPanelUi">
    <template #header>
      <UDashboardNavbar title="服务凭证">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="font-semibold">
                Service Clients
              </p>
              <p class="mt-1 text-sm font-normal text-muted">
                运行时服务身份与跨应用授权。
              </p>
            </div>
            <UBadge color="neutral" variant="subtle">
              管理操作
            </UBadge>
          </div>
        </template>
        <div class="space-y-4">
          <UAlert
            v-if="!canAdminServiceClients"
            color="warning"
            variant="soft"
            icon="i-lucide-lock"
            title="仅服务凭证管理员可执行授权修复"
            description="当前账号缺少 service_clients:admin 权限。"
          />

          <div class="rounded-lg border border-default bg-default p-4">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div class="space-y-1">
                <h2 class="text-sm font-semibold text-highlighted">
                  AIMS 项目文档只读授权
                </h2>
                <p class="text-sm text-muted">
                  幂等校验 aims.runtime 对 data-runtime:codocs 与 tenant-runtime:codocs 的只读授权，并记录操作审计。
                </p>
              </div>
              <UButton
                icon="i-lucide-shield-check"
                color="primary"
                :loading="repairing"
                :disabled="!canAdminServiceClients"
                @click="reconcileAimsCodocsRuntimeRead"
              >
                校验并修复授权
              </UButton>
            </div>
          </div>

          <UAlert
            v-if="repairResult"
            color="success"
            variant="soft"
            icon="i-lucide-circle-check"
            title="AIMS 文档访问授权正常"
            :description="`${repairResult.serviceClientCode}：${repairResult.grants.join('、')}`"
          />
        </div>
      </UCard>
    </template>
  </UDashboardPanel>
</template>

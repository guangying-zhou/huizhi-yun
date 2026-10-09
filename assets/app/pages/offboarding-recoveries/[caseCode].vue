<script setup lang="ts">
import type { ApiResponse, OffboardingRecoveryCaseItem } from '~/types'

const route = useRoute()
const toast = useToast()
const caseCode = computed(() => String(route.params.caseCode || '').trim())
const selectedResponsibleUids = ref<string[]>([])
const saving = ref(false)
const { loadPermissions, hasPermission, loaded: permissionsLoaded } = usePermissions()
const canEditRecovery = computed(() => (
  permissionsLoaded.value && hasPermission('offboarding_recoveries', 'edit')
))

onMounted(() => {
  void loadPermissions()
})

const { data: response, refresh, error } = await useFetch<ApiResponse<OffboardingRecoveryCaseItem>>(
  () => `/api/v1/offboarding-recoveries/${encodeURIComponent(caseCode.value)}`
)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, message: '离职资产回收事项不存在' })
}
const recovery = computed(() => response.value?.data || null)
usePageTitle(computed(() => recovery.value?.case_code || '离职资产回收'))
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)
const assets = computed(() => recovery.value?.items || [])
const assetColumns = [
  { accessorKey: 'asset_code', header: '资产编号' },
  { accessorKey: 'asset_name', header: '资产名称' },
  { accessorKey: 'asset_category', header: '类别' },
  { accessorKey: 'asset_subtype', header: '子类' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'user_uid', header: '当前使用人' }
]

watch(recovery, (value) => {
  selectedResponsibleUids.value = value?.recovery_responsible_uid
    ? [value.recovery_responsible_uid]
    : []
}, { immediate: true })

async function saveResponsible(uid: string | null) {
  if (!recovery.value || !canEditRecovery.value) return
  if (uid && uid === recovery.value.departed_employee_uid) {
    toast.add({ title: '不能把离职员工设为回收责任人', color: 'warning' })
    return
  }
  saving.value = true
  try {
    await $fetch(`/api/v1/offboarding-recoveries/${encodeURIComponent(recovery.value.case_code)}`, {
      method: 'PATCH',
      body: { recovery_responsible_uid: uid }
    })
    toast.add({
      title: uid ? '回收责任人已更新' : '回收责任人已清除',
      description: uid ? '后续通知仅发送给该明确责任人。' : '未分配期间不会发送离职未回收通知。',
      color: 'success'
    })
    await refresh()
  } catch (requestError) {
    console.error('[OffboardingRecovery] responsibility update failed', requestError)
    toast.add({ title: '责任人更新失败', description: '请确认权限与用户状态后重试。', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function saveSelectedResponsible() {
  await saveResponsible(selectedResponsibleUids.value[0] || null)
}
</script>

<template>
  <UDashboardPanel id="offboarding-recovery-detail" grow>
    <template #body>
      <div v-if="recovery" class="space-y-4 p-4">
        <UAlert
          v-if="!recovery.recovery_responsible_uid"
          color="warning"
          variant="soft"
          icon="i-lucide-bell-off"
          title="尚未分配回收责任人"
          description="该事项会保留在工作清单中，但在分配明确且有效的责任人前不会发送通知。"
        />
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">回收事项</span>
              <UButton
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                to="/offboarding-recoveries"
              >
                返回
              </UButton>
            </div>
          </template>
          <div class="grid gap-3 text-sm md:grid-cols-2">
            <div><span class="text-muted">离职员工：</span>{{ recovery.departed_employee_name || recovery.departed_employee_uid }}</div>
            <div><span class="text-muted">员工 UID：</span>{{ recovery.departed_employee_uid }}</div>
            <div><span class="text-muted">离职时间：</span>{{ recovery.offboarded_at }}</div>
            <div><span class="text-muted">回收期限：</span>{{ recovery.recovery_due_at }}</div>
            <div><span class="text-muted">当前责任人：</span>{{ recovery.recovery_responsible_uid || '未分配（不通知）' }}</div>
            <div><span class="text-muted">未归还资产：</span>{{ recovery.outstanding_count }} 项</div>
          </div>
        </UCard>

        <UCard v-if="canEditRecovery">
          <template #header>
            <span class="font-semibold">维护回收责任</span>
          </template>
          <div class="space-y-3">
            <UAlert
              color="info"
              variant="soft"
              title="显式责任边界"
              description="只能选择一名 active Directory 用户；离职员工本人已排除，部门和管理员不会成为通知兜底。"
            />
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
              <UserTreeSelector
                v-model="selectedResponsibleUids"
                selection-mode="single"
                placeholder="选择回收责任人"
                :exclude-uids="[recovery.departed_employee_uid]"
                width-class="w-full sm:w-96"
              />
              <div class="flex gap-2">
                <UButton :loading="saving" @click="saveSelectedResponsible">
                  保存
                </UButton>
                <UButton
                  color="neutral"
                  variant="outline"
                  :disabled="saving || !recovery.recovery_responsible_uid"
                  @click="saveResponsible(null)"
                >
                  清除
                </UButton>
              </div>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <span class="font-semibold">未归还资产</span>
              <UBadge :color="assets.length ? 'error' : 'success'" variant="soft">
                {{ assets.length }} 项
              </UBadge>
            </div>
          </template>
          <UTable :data="assets" :columns="assetColumns">
            <template #asset_code-cell="{ row }">
              <NuxtLink :to="`/items/${encodeURIComponent(row.original.public_id || String(row.original.id))}`" class="text-primary hover:underline">
                {{ row.original.asset_code }}
              </NuxtLink>
            </template>
            <template #empty>
              <div class="py-8 text-center text-sm text-muted">
                当前没有未归还资产
              </div>
            </template>
          </UTable>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>

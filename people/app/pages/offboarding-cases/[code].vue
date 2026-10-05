<script setup lang="ts">
import type { ApiResponse, OffboardingCaseDetail, OffboardingTask } from '~/types'

const route = useRoute()
const caseCode = computed(() => String(route.params.code || '').trim())
const selectedTaskCode = computed(() => String(route.query.task || '').trim())
const toast = useToast()
const { ensurePeoplePermission } = usePeopleAuthorization()
const cancellingTask = ref<OffboardingTask | null>(null)
const cancellationReason = ref('')
const mutatingTaskCode = ref('')
const { data: response, refresh, error } = await useFetch<ApiResponse<OffboardingCaseDetail>>(
  () => `/api/v1/offboarding-cases/${encodeURIComponent(caseCode.value)}`
)
const detail = computed(() => response.value?.data || null)
usePageTitle(computed(() => detail.value?.case.caseCode || caseCode.value))
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

function taskLabel(taskType: OffboardingTask['taskType']) {
  return taskType === 'handover' ? '工作交接' : '资产回收协调'
}

async function confirmTask(task: OffboardingTask) {
  const permission = await ensurePeoplePermission('offboarding_tasks', 'confirm')
  if (!permission.authorized) {
    toast.add({ title: '当前角色无权限', description: '确认任务需要离职交接确认权限。', color: 'warning' })
    return
  }
  mutatingTaskCode.value = task.taskCode
  try {
    await $fetch(`/api/v1/offboarding-tasks/${encodeURIComponent(task.taskCode)}:confirm`, {
      method: 'POST',
      body: { expectedVersion: task.objectVersion }
    })
    toast.add({ title: `${taskLabel(task.taskType)}已确认`, color: 'success' })
    await refresh()
  } catch (errorValue) {
    console.error('[PeopleOffboarding] confirm failed', errorValue)
    toast.add({ title: '确认失败', description: '任务可能已变更，请刷新后重试。', color: 'error' })
  } finally {
    mutatingTaskCode.value = ''
  }
}

async function openCancellation(task: OffboardingTask) {
  const permission = await ensurePeoplePermission('offboarding_tasks', 'cancel')
  if (!permission.authorized) {
    toast.add({ title: '当前角色无权限', description: '取消任务需要离职交接取消权限。', color: 'warning' })
    return
  }
  cancellationReason.value = ''
  cancellingTask.value = task
}

async function cancelTask() {
  const task = cancellingTask.value
  const reason = cancellationReason.value.trim()
  if (!task || !reason) {
    toast.add({ title: '请填写取消原因', color: 'warning' })
    return
  }
  mutatingTaskCode.value = task.taskCode
  try {
    await $fetch(`/api/v1/offboarding-tasks/${encodeURIComponent(task.taskCode)}:cancel`, {
      method: 'POST',
      body: { expectedVersion: task.objectVersion, reason }
    })
    toast.add({ title: `${taskLabel(task.taskType)}已取消`, color: 'success' })
    cancellingTask.value = null
    await refresh()
  } catch (errorValue) {
    console.error('[PeopleOffboarding] cancel failed', errorValue)
    toast.add({ title: '取消失败', description: '任务可能已变更，请刷新后重试。', color: 'error' })
  } finally {
    mutatingTaskCode.value = ''
  }
}
</script>

<template>
  <div class="contents">
    <UDashboardPanel
      id="people-offboarding-case-detail"
      grow
    >
      <template #body>
        <div class="space-y-4 p-4">
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            to="/offboarding-cases"
          >
            返回离职交接
          </UButton>
          <UAlert
            v-if="error"
            color="warning"
            variant="soft"
            title="离职事项不可访问"
            description="事项不存在、当前用户已不再是责任人，或来源授权运行时暂不可用。"
          />
          <UCard v-if="detail">
            <template #header>
              <div class="flex items-center justify-between gap-3">
                <span class="font-semibold">离职事项</span>
                <UBadge
                  color="warning"
                  variant="soft"
                >
                  {{ detail.case.status }}
                </UBadge>
              </div>
            </template>
            <div class="grid gap-3 text-sm md:grid-cols-2">
              <div><span class="text-muted">员工 UID：</span>{{ detail.case.employeeUid }}</div>
              <div><span class="text-muted">离职任职记录：</span>{{ detail.case.leaveAssignmentCode }}</div>
              <div><span class="text-muted">创建时间：</span>{{ detail.case.createdAt }}</div>
              <div><span class="text-muted">更新时间：</span>{{ detail.case.updatedAt }}</div>
            </div>
          </UCard>

          <div
            v-if="detail"
            class="grid gap-4 xl:grid-cols-2"
          >
            <UCard
              v-for="task in detail.tasks"
              :key="task.taskCode"
              :class="selectedTaskCode === task.taskCode ? 'ring-2 ring-primary' : ''"
            >
              <template #header>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p class="font-semibold">
                      {{ taskLabel(task.taskType) }}
                    </p>
                    <p class="font-mono text-xs text-muted">
                      {{ task.taskCode }}
                    </p>
                  </div>
                  <UBadge
                    :color="task.status === 'pending' ? 'warning' : task.status === 'completed' ? 'success' : 'neutral'"
                    variant="soft"
                  >
                    {{ task.status }}
                  </UBadge>
                </div>
              </template>
              <div class="space-y-3 text-sm">
                <div><span class="text-muted">当前责任人：</span>{{ task.responsibleUid }}</div>
                <div><span class="text-muted">任务期限：</span>{{ task.dueAt }}</div>
                <div v-if="task.completedAt">
                  <span class="text-muted">确认时间：</span>{{ task.completedAt }} · {{ task.completedBy }}
                </div>
                <div v-if="task.cancelledAt">
                  <span class="text-muted">取消时间：</span>{{ task.cancelledAt }} · {{ task.cancelledBy }}
                </div>
                <p
                  v-if="task.cancellationReason"
                  class="rounded-lg bg-muted px-3 py-2 text-muted"
                >
                  {{ task.cancellationReason }}
                </p>
                <UAlert
                  v-if="task.taskType === 'asset_recovery_coordination'"
                  color="info"
                  variant="soft"
                  title="仅确认协调责任"
                  description="实际资产、账号与席位是否归还，仍需在 Assets 中按当前占用事实核验。"
                />
              </div>
              <template
                v-if="task.status === 'pending'"
                #footer
              >
                <div class="flex justify-end gap-2">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    :loading="mutatingTaskCode === task.taskCode"
                    @click="openCancellation(task)"
                  >
                    取消任务
                  </UButton>
                  <UButton
                    color="primary"
                    :loading="mutatingTaskCode === task.taskCode"
                    @click="confirmTask(task)"
                  >
                    确认完成
                  </UButton>
                </div>
              </template>
            </UCard>
          </div>
        </div>
      </template>
    </UDashboardPanel>

    <UModal
      :open="Boolean(cancellingTask)"
      title="取消离职任务"
      description="取消属于独立敏感动作，必须记录明确原因。"
      @update:open="value => { if (!value) cancellingTask = null }"
    >
      <template #body>
        <div class="space-y-3 p-4">
          <UFormField
            label="取消原因"
            required
          >
            <UTextarea
              v-model="cancellationReason"
              :rows="4"
              class="w-full"
              maxlength="500"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="cancellingTask = null"
          >
            返回
          </UButton>
          <UButton
            color="error"
            :loading="Boolean(mutatingTaskCode)"
            @click="cancelTask"
          >
            确认取消
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

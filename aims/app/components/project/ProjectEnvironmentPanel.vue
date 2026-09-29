<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'

// 同一份代码供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。
const { moduleUrl } = useAimsModule()
const props = withDefaults(defineProps<{
  projectId: number
  canManage?: boolean
  compact?: boolean
}>(), {
  canManage: false,
  compact: false
})

interface ProjectEnvironmentRow {
  id: number
  environment_code?: string
  delivery_asset_code?: string | null
  relation_type?: string
  delivery_status?: string
  is_primary?: boolean | number
  handover_status?: string
  delivery_version_snapshot?: string | null
  assets_sync_status?: string
  assets_sync_error?: string | null
}

const toast = useToast()
const projectEnvironments = ref<ProjectEnvironmentRow[]>([])
const loadingProjectEnvironments = ref(false)
const showEnvironmentModal = ref(false)
const savingEnvironment = ref(false)
const syncingEnvironmentId = ref<number | null>(null)
const environmentForm = reactive({
  environmentCode: '',
  environmentName: '',
  environmentType: 'customer_prod',
  deliveryAssetCode: '',
  relationType: 'initial_delivery',
  deliveryStatus: 'planned',
  deliveryVersionSnapshot: '',
  isPrimary: false
})

const relationTypeOptions = [
  { label: '初次实施', value: 'initial_delivery' },
  { label: '升级', value: 'upgrade' },
  { label: '迁移', value: 'migration' },
  { label: '维护', value: 'maintenance' },
  { label: '下线', value: 'decommission' },
  { label: '验证', value: 'verification' },
  { label: '其他', value: 'other' }
]

const deliveryStatusOptions = [
  { label: '计划', value: 'planned' },
  { label: '准备', value: 'provisioning' },
  { label: '已部署', value: 'deployed' },
  { label: '上线', value: 'online' },
  { label: '验收', value: 'accepted' },
  { label: '已交接', value: 'handed_over' }
]

const environmentTypeOptions = [
  { label: '客户生产', value: 'customer_prod' },
  { label: '客户测试', value: 'customer_test' },
  { label: '预发', value: 'staging' },
  { label: '测试', value: 'test' },
  { label: '开发', value: 'dev' },
  { label: '内部生产', value: 'internal_prod' }
]

const relationTypeLabel: Record<string, string> = {
  initial_delivery: '初次实施',
  upgrade: '升级',
  migration: '迁移',
  maintenance: '维护',
  decommission: '下线',
  verification: '验证',
  other: '其他'
}

const deliveryStatusLabel: Record<string, string> = {
  planned: '计划',
  provisioning: '准备',
  deployed: '已部署',
  online: '上线',
  accepted: '验收',
  handed_over: '已交接',
  suspended: '暂停',
  cancelled: '取消'
}

const syncStatusColor: Record<string, string> = {
  pending: 'warning',
  synced: 'success',
  failed: 'error'
}

const visibleEnvironments = computed(() => props.compact ? projectEnvironments.value.slice(0, 4) : projectEnvironments.value)

function resetEnvironmentForm() {
  environmentForm.environmentCode = ''
  environmentForm.environmentName = ''
  environmentForm.environmentType = 'customer_prod'
  environmentForm.deliveryAssetCode = ''
  environmentForm.relationType = 'initial_delivery'
  environmentForm.deliveryStatus = 'planned'
  environmentForm.deliveryVersionSnapshot = ''
  environmentForm.isPrimary = false
}

async function fetchProjectEnvironments() {
  if (!props.projectId) return
  loadingProjectEnvironments.value = true
  try {
    const res = await $fetch<{ code?: number, data?: { items?: ProjectEnvironmentRow[] }, items?: ProjectEnvironmentRow[] }>(
      moduleUrl(`/api/v1/projects/${props.projectId}/environments`)
    )
    const data = res.data || res
    projectEnvironments.value = Array.isArray(data.items) ? data.items : []
  } catch {
    projectEnvironments.value = []
  } finally {
    loadingProjectEnvironments.value = false
  }
}

async function saveProjectEnvironment() {
  if (!environmentForm.environmentCode.trim() && !environmentForm.environmentName.trim()) {
    toast.add({ title: '请填写环境名称或正式环境编码', color: 'warning' })
    return
  }
  savingEnvironment.value = true
  try {
    const res = await $fetch<{ code?: number, data?: { assetsSyncStatus?: string, assetsSyncError?: string } }>(moduleUrl(`/api/v1/projects/${props.projectId}/environments/upsert`), {
      method: 'POST',
      body: {
        environmentCode: environmentForm.environmentCode.trim() || undefined,
        environmentName: environmentForm.environmentName.trim() || undefined,
        environmentType: environmentForm.environmentType,
        deliveryAssetCode: environmentForm.deliveryAssetCode.trim() || undefined,
        relationType: environmentForm.relationType,
        deliveryStatus: environmentForm.deliveryStatus,
        deliveryVersionSnapshot: environmentForm.deliveryVersionSnapshot.trim() || undefined,
        isPrimary: environmentForm.isPrimary
      }
    })
    const syncStatus = res.data?.assetsSyncStatus
    toast.add({
      title: syncStatus === 'failed' ? '项目环境已保存，Assets 同步失败' : '项目环境已保存',
      description: syncStatus === 'failed' ? res.data?.assetsSyncError : undefined,
      color: syncStatus === 'failed' ? 'warning' : 'success'
    })
    showEnvironmentModal.value = false
    resetEnvironmentForm()
    await fetchProjectEnvironments()
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message || '') : ''
    toast.add({ title: message || '项目环境保存失败', color: 'error' })
  } finally {
    savingEnvironment.value = false
  }
}

async function retryProjectEnvironmentSync(env: ProjectEnvironmentRow) {
  if (!env.environment_code) return
  syncingEnvironmentId.value = env.id
  try {
    const res = await $fetch<{ code?: number, data?: { assetsSyncStatus?: string, assetsSyncError?: string } }>(moduleUrl(`/api/v1/projects/${props.projectId}/environments/upsert`), {
      method: 'POST',
      body: {
        environmentCode: env.environment_code,
        deliveryAssetCode: env.delivery_asset_code || undefined,
        relationType: env.relation_type || 'initial_delivery',
        deliveryStatus: env.delivery_status || 'planned',
        deliveryVersionSnapshot: env.delivery_version_snapshot || undefined,
        isPrimary: Boolean(env.is_primary)
      }
    })
    toast.add({
      title: res.data?.assetsSyncStatus === 'failed' ? 'Assets 同步仍失败' : 'Assets 同步已完成',
      description: res.data?.assetsSyncStatus === 'failed' ? res.data?.assetsSyncError : undefined,
      color: res.data?.assetsSyncStatus === 'failed' ? 'warning' : 'success'
    })
    await fetchProjectEnvironments()
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message || '') : ''
    toast.add({ title: message || 'Assets 同步重试失败', color: 'error' })
  } finally {
    syncingEnvironmentId.value = null
  }
}

function nextProjectEnvironmentStatus(status: string | undefined) {
  switch (status || 'planned') {
    case 'planned':
      return 'provisioning'
    case 'provisioning':
      return 'deployed'
    case 'deployed':
      return 'online'
    case 'online':
      return 'accepted'
    case 'accepted':
      return 'handed_over'
    default:
      return ''
  }
}

async function advanceProjectEnvironmentStatus(env: ProjectEnvironmentRow) {
  if (!env.environment_code) return
  const targetStatus = nextProjectEnvironmentStatus(env.delivery_status)
  if (!targetStatus) return
  syncingEnvironmentId.value = env.id
  try {
    const res = await $fetch<{ code?: number, data?: { assetsSyncStatus?: string, assetsSyncError?: string } }>(
      moduleUrl(`/api/v1/projects/${props.projectId}/environments/${encodeURIComponent(env.environment_code)}:status`),
      {
        method: 'POST',
        body: {
          deliveryStatus: targetStatus,
          deliveryAssetCode: env.delivery_asset_code || undefined,
          relationType: env.relation_type || 'initial_delivery',
          deliveryVersionSnapshot: env.delivery_version_snapshot || undefined
        }
      }
    )
    toast.add({
      title: res.data?.assetsSyncStatus === 'failed' ? '状态已保存，Assets 同步失败' : `已推进到${deliveryStatusLabel[targetStatus] || targetStatus}`,
      description: res.data?.assetsSyncStatus === 'failed' ? res.data?.assetsSyncError : undefined,
      color: res.data?.assetsSyncStatus === 'failed' ? 'warning' : 'success'
    })
    await fetchProjectEnvironments()
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message || '') : ''
    toast.add({ title: message || '环境状态推进失败', color: 'error' })
  } finally {
    syncingEnvironmentId.value = null
  }
}

onMounted(fetchProjectEnvironments)

watch(() => props.projectId, fetchProjectEnvironments)
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-server-cog"
            class="size-4 text-primary"
          />
          <span class="font-semibold text-sm">交付环境</span>
          <UBadge
            color="neutral"
            variant="subtle"
            size="xs"
          >
            {{ projectEnvironments.length }}
          </UBadge>
        </div>
        <UButton
          v-if="props.canManage"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="xs"
          @click="showEnvironmentModal = true"
        />
      </div>
    </template>

    <div
      v-if="loadingProjectEnvironments"
      class="py-4 text-center text-muted"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="size-5 animate-spin"
      />
    </div>
    <div
      v-else-if="projectEnvironments.length === 0"
      class="text-center py-4 text-xs text-muted"
    >
      暂无环境
    </div>
    <div
      v-else
      class="space-y-2"
    >
      <div
        v-for="env in visibleEnvironments"
        :key="env.id"
        class="rounded-md border border-default px-3 py-2 space-y-2"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="font-mono text-xs font-semibold truncate">{{ env.environment_code }}</span>
              <UBadge
                v-if="env.is_primary"
                color="primary"
                variant="subtle"
                size="xs"
              >
                主
              </UBadge>
            </div>
            <p
              v-if="env.delivery_asset_code"
              class="text-xs text-muted truncate mt-0.5"
            >
              {{ env.delivery_asset_code }}
            </p>
          </div>
          <div class="flex items-center gap-1">
            <UButton
              v-if="props.canManage && nextProjectEnvironmentStatus(env.delivery_status)"
              icon="i-lucide-arrow-up-right"
              :label="deliveryStatusLabel[nextProjectEnvironmentStatus(env.delivery_status)]"
              color="primary"
              variant="soft"
              size="xs"
              :loading="syncingEnvironmentId === env.id"
              :disabled="syncingEnvironmentId !== null && syncingEnvironmentId !== env.id"
              @click="advanceProjectEnvironmentStatus(env)"
            />
            <UButton
              v-if="props.canManage && env.assets_sync_status === 'failed'"
              icon="i-lucide-refresh-cw"
              color="warning"
              variant="ghost"
              size="xs"
              :loading="syncingEnvironmentId === env.id"
              :disabled="syncingEnvironmentId !== null && syncingEnvironmentId !== env.id"
              @click="retryProjectEnvironmentSync(env)"
            />
            <UBadge
              :color="(syncStatusColor[env.assets_sync_status || 'pending'] as any)"
              variant="subtle"
              size="xs"
            >
              {{ env.assets_sync_status || 'pending' }}
            </UBadge>
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <UBadge
            color="info"
            variant="subtle"
            size="xs"
          >
            {{ relationTypeLabel[env.relation_type || 'other'] || env.relation_type }}
          </UBadge>
          <UBadge
            color="neutral"
            variant="subtle"
            size="xs"
          >
            {{ deliveryStatusLabel[env.delivery_status || 'planned'] || env.delivery_status }}
          </UBadge>
          <UBadge
            v-if="env.delivery_version_snapshot"
            color="neutral"
            variant="outline"
            size="xs"
          >
            {{ env.delivery_version_snapshot }}
          </UBadge>
        </div>
        <p
          v-if="env.assets_sync_error"
          class="text-xs text-error line-clamp-2"
        >
          {{ env.assets_sync_error }}
        </p>
      </div>
      <div
        v-if="props.compact && projectEnvironments.length > visibleEnvironments.length"
        class="pt-1 text-center"
      >
        <UButton
          icon="i-lucide-arrow-right"
          label="查看全部环境"
          color="neutral"
          variant="ghost"
          size="xs"
          :to="`/projects/${props.projectId}/environments`"
        />
      </div>
    </div>
  </UCard>

  <UModal
    v-model:open="showEnvironmentModal"
    title="关联交付环境"
  >
    <template #body>
      <div class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UFormField label="环境名称">
            <UInput
              v-model="environmentForm.environmentName"
              class="w-full"
              placeholder="生产环境"
            />
          </UFormField>
          <UFormField label="已有环境编码">
            <UInput
              v-model="environmentForm.environmentCode"
              class="w-full"
              placeholder="ENV-..."
            />
          </UFormField>
          <UFormField label="环境类型">
            <USelect
              v-model="environmentForm.environmentType"
              :items="environmentTypeOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="交付资产">
            <UInput
              v-model="environmentForm.deliveryAssetCode"
              class="w-full"
              placeholder="CDA-..."
            />
          </UFormField>
          <UFormField label="关系类型">
            <USelect
              v-model="environmentForm.relationType"
              :items="relationTypeOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="交付状态">
            <USelect
              v-model="environmentForm.deliveryStatus"
              :items="deliveryStatusOptions"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField label="版本快照">
          <UInput
            v-model="environmentForm.deliveryVersionSnapshot"
            class="w-full"
            placeholder="V1.0"
          />
        </UFormField>
        <UCheckbox
          v-model="environmentForm.isPrimary"
          label="设为本项目主环境"
        />
      </div>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="savingEnvironment"
        @click="showEnvironmentModal = false"
      >
        取消
      </UButton>
      <UButton
        color="primary"
        :loading="savingEnvironment"
        @click="saveProjectEnvironment"
      >
        保存
      </UButton>
    </template>
  </UModal>
</template>

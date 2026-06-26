<script setup lang="ts">
import type { ApiResponse, AssetDetail } from '~/types'
import type { DropdownMenuItem } from '@nuxt/ui'

const route = useRoute()
const assetIdentifier = computed(() => String(route.params.id || ''))
const editOpen = ref(false)
const operationOpen = ref(false)
const operationAction = ref<string | null>(null)
const documentOpen = ref(false)
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const { data: response, refresh, error } = await useFetch<ApiResponse<AssetDetail>>(() => `/api/v1/assets/${assetIdentifier.value}`)

if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, message: '资产不存在' })
}

const asset = computed(() => response.value?.data)
watch(() => asset.value, (value) => {
  if (!import.meta.client || !value?.public_id) {
    return
  }

  const current = String(route.params.id || '')
  if (current === value.public_id || current !== String(value.id)) {
    return
  }

  navigateTo(`/assets/${value.public_id}`, { replace: true })
})
const backTo = computed(() => asset.value?.asset_category === 'physical' ? '/assets/physical' : '/assets/resources')
const assetCategoryLabel = computed(() => getLabel('asset_category', asset.value?.asset_category))
const assetSubtypeLabel = computed(() => {
  if (!asset.value) return '-'
  if (asset.value.asset_category === 'physical' && asset.value.physical_item_type) {
    return `${asset.value.asset_subtype} / ${asset.value.physical_item_type}`
  }

  return asset.value.asset_subtype
})
const assetPurposeLabel = computed(() => getLabel('asset_purpose', asset.value?.asset_purpose))
const assetStatusLabel = computed(() => getLabel(asset.value?.asset_category === 'physical' ? 'asset_status_physical' : 'asset_status_resource', asset.value?.status))
const documentTypeLabels: Record<string, string> = {
  requirement: '需求文档',
  design: '设计文档',
  api: '接口文档',
  ops: '运维文档',
  delivery: '交付文档',
  attachment: '附件',
  other: '其他'
}
const documentItems = computed(() => (asset.value?.documents || []).map(item => ({
  ...item,
  document_type_label: documentTypeLabels[item.document_type] || item.document_type
})))

const documentColumns = [
  { accessorKey: 'document_id', header: '文档编号' },
  { accessorKey: 'document_type_label', header: '类型' },
  { accessorKey: 'remark', header: '说明' }
]

const eventColumns = [
  { accessorKey: 'event_type', header: '事件' },
  { accessorKey: 'summary', header: '摘要' },
  { accessorKey: 'operator_uid', header: '操作人' },
  { accessorKey: 'occurred_at', header: '时间' }
]

const operationItems = computed<DropdownMenuItem[]>(() => ([
  {
    label: '分配',
    icon: 'i-lucide-arrow-right-left',
    onSelect: () => {
      operationAction.value = 'assign'
      operationOpen.value = true
    }
  },
  {
    label: '领用',
    icon: 'i-lucide-user-plus',
    onSelect: () => {
      operationAction.value = 'claim'
      operationOpen.value = true
    }
  },
  {
    label: '转移',
    icon: 'i-lucide-repeat',
    onSelect: () => {
      operationAction.value = 'transfer'
      operationOpen.value = true
    }
  },
  {
    label: '归还',
    icon: 'i-lucide-undo-2',
    onSelect: () => {
      operationAction.value = 'return'
      operationOpen.value = true
    }
  },
  {
    label: '释放',
    icon: 'i-lucide-log-out',
    onSelect: () => {
      operationAction.value = 'release'
      operationOpen.value = true
    }
  },
  {
    label: '报废',
    icon: 'i-lucide-trash-2',
    color: 'error',
    onSelect: () => {
      operationAction.value = 'scrap'
      operationOpen.value = true
    }
  }
]))

const handleRefresh = () => refresh()
const handleUpdated = async () => {
  await refresh()
}
const handleAssignmentCreated = async () => {
  await refresh()
}
const handleDocumentCreated = async () => {
  await refresh()
}

function printLabel() {
  if (!asset.value) return
  window.print()
}
</script>

<template>
  <UDashboardPanel id="asset-detail" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          {{ asset?.asset_name || '资产详情' }}
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          :to="backTo"
        >
          返回
        </UButton>
        <UButton
          icon="i-lucide-pencil"
          color="primary"
          variant="soft"
          @click="editOpen = true"
        >
          编辑
        </UButton>
        <UButton
          v-if="asset?.asset_category === 'physical'"
          icon="i-lucide-printer"
          color="neutral"
          variant="soft"
          @click="printLabel"
        >
          打印标签
        </UButton>
        <UDropdownMenu :items="operationItems" :content="{ align: 'end' }">
          <UButton
            icon="i-lucide-arrow-right-left"
            color="primary"
            variant="soft"
          >
            快捷操作
          </UButton>
        </UDropdownMenu>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="handleRefresh"
        >
          刷新
        </UButton>
      </Teleport>

      <div class="p-4 space-y-4">
        <AssetsPageIntroCard
          :title="asset?.asset_name || '资产详情'"
          description="展示资产基础信息、归属关系、文档引用与最近操作记录。"
        >
          <template #right>
            <UBadge color="info" variant="subtle">
              {{ asset?.asset_code || '-' }}
            </UBadge>
          </template>
        </AssetsPageIntroCard>

        <div v-if="asset" class="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <UCard>
            <template #header>
              <span class="font-semibold">基础信息</span>
            </template>
            <div class="grid gap-3 md:grid-cols-2 text-sm">
              <div><span class="text-muted">资产分类：</span>{{ assetCategoryLabel }} / {{ assetSubtypeLabel }}</div>
              <div><span class="text-muted">设备编码：</span>{{ asset.asset_code }}</div>
              <div><span class="text-muted">系统标识：</span><span class="font-mono break-all">{{ asset.public_id || '-' }}</span></div>
              <div><span class="text-muted">采购目的：</span>{{ assetPurposeLabel }}</div>
              <div><span class="text-muted">状态：</span>{{ assetStatusLabel }}</div>
              <div><span class="text-muted">归属部门：</span>{{ asset.dept_code }}</div>
              <div><span class="text-muted">采购日期：</span>{{ asset.purchased_at || '-' }}</div>
              <div><span class="text-muted">项目：</span>{{ asset.project_code || '-' }}</div>
              <div><span class="text-muted">负责人：</span>{{ asset.owner_uid || '-' }}</div>
              <div><span class="text-muted">使用人：</span>{{ asset.user_uid || '-' }}</div>
              <div><span class="text-muted">客户：</span>{{ asset.customer_code || '-' }}</div>
              <div><span class="text-muted">合同：</span>{{ asset.contract_code || '-' }}</div>
              <div><span class="text-muted">环境：</span>{{ asset.environment_name || '-' }}</div>
              <div><span class="text-muted">月度成本：</span>{{ asset.monthly_cost ? `¥${asset.monthly_cost}` : '-' }}</div>
              <div><span class="text-muted">到期时间：</span>{{ asset.expires_at || '-' }}</div>
            </div>
            <p class="mt-4 text-sm text-muted">
              {{ asset.notes || '暂无备注' }}
            </p>
          </UCard>

          <UCard>
            <template #header>
              <span class="font-semibold">标签与扩展</span>
            </template>
            <div v-if="asset.asset_category === 'physical'" class="space-y-3 text-sm">
              <div><span class="text-muted">品牌 / 型号：</span>{{ asset.brand || '-' }} / {{ asset.model || '-' }}</div>
              <div><span class="text-muted">序列号：</span>{{ asset.serial_number || '-' }}</div>
              <div><span class="text-muted">位置：</span>{{ asset.location || '-' }}</div>
              <div><span class="text-muted">二维码内容：</span><span class="font-mono break-all">{{ asset.qr_code || `HZY-ASSET:${asset.public_id || asset.asset_code}` }}</span></div>
              <div><span class="text-muted">条码编码值：</span><span class="font-mono">{{ asset.asset_code }}</span></div>
              <div>
                <span class="text-muted">详细配置：</span>
                <div class="mt-1 whitespace-pre-wrap rounded border border-default p-3">
                  {{ asset.config_detail || '-' }}
                </div>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <UBadge
                v-for="tag in asset.tags || []"
                :key="tag"
                color="neutral"
                variant="soft"
              >
                {{ tag }}
              </UBadge>
            </div>
          </UCard>
        </div>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold">关联文档</span>
              <UButton
                icon="i-lucide-plus"
                color="primary"
                variant="soft"
                size="sm"
                @click="documentOpen = true"
              >
                关联文档
              </UButton>
            </div>
          </template>
          <UTable :data="documentItems" :columns="documentColumns" />
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">最近操作记录</span>
          </template>
          <UTable :data="asset?.latest_events || []" :columns="eventColumns" />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsAssetEditModal
    :open="editOpen"
    :asset="asset || null"
    @update:open="editOpen = $event"
    @updated="handleUpdated"
  />

  <AssetsAssignmentCreateModal
    :open="operationOpen"
    :asset="asset || null"
    :default-action-type="operationAction"
    @update:open="operationOpen = $event"
    @created="handleAssignmentCreated"
  />

  <AssetsAssetDocumentLinkModal
    :open="documentOpen"
    :asset="asset || null"
    @update:open="documentOpen = $event"
    @created="handleDocumentCreated"
  />
</template>

<style scoped>
@media print {
  :global(header),
  :global(nav),
  :global(button),
  :global(.noprint) {
    display: none !important;
  }
}
</style>

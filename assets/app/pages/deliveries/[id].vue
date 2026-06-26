<script setup lang="ts">
import type { ApiResponse, DeliveryItem } from '~/types'

const route = useRoute()
const deliveryId = computed(() => String(route.params.id))
const editOpen = ref(false)
const linkProductOpen = ref(false)
const linkEnvironmentOpen = ref(false)
const linkDocumentOpen = ref(false)
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const { data: response, refresh, error } = await useFetch<ApiResponse<DeliveryItem>>(() => `/api/v1/deliveries/${deliveryId.value}`)

if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, message: '交付视图不存在' })
}

const delivery = computed(() => response.value?.data)
const deliveryStatusLabel = computed(() => getLabel('delivery_status', delivery.value?.status))
const relationTypeLabels: Record<string, string> = {
  delivered_product: '交付产品',
  supporting_product: '支撑产品',
  integrated_product: '集成产品'
}
const linkedProducts = computed(() => (delivery.value?.linked_products || []).map(item => ({
  ...item,
  status_label: getLabel('product_status', item.status),
  relation_label: relationTypeLabels[item.relation_type] || item.relation_type
})))
const environmentRelationLabels: Record<string, string> = {
  primary: '主交付环境',
  backup: '备份环境',
  test: '测试环境',
  training: '培训环境',
  other: '其他'
}
const linkedEnvironments = computed(() => (delivery.value?.linked_environments || []).map(item => ({
  ...item,
  environment_type_label: getLabel('environment_type', item.environment_type),
  status_label: getLabel('environment_status', item.status),
  relation_label: environmentRelationLabels[item.relation_type] || item.relation_type
})))
const artifactTypeLabels: Record<string, string> = {
  solution: '方案',
  requirement: '需求',
  design: '设计',
  test_report: '测试报告',
  deployment_manual: '部署手册',
  acceptance_report: '验收报告',
  training_material: '培训材料',
  ops_knowledge: '运维知识',
  customer_environment_record: '客户环境记录'
}
const documentTypeLabels: Record<string, string> = {
  requirement: '需求文档',
  design: '设计文档',
  api: '接口文档',
  ops: '运维文档',
  delivery: '交付文档',
  attachment: '附件',
  other: '其他'
}
const documentItems = computed(() => (delivery.value?.documents || []).map(item => ({
  ...item,
  artifact_type_label: artifactTypeLabels[item.artifact_type || ''] || '-',
  document_type_label: documentTypeLabels[item.document_type] || item.document_type
})))
const environmentColumns = [
  { accessorKey: 'environment_code', header: '环境编号' },
  { accessorKey: 'environment_name', header: '环境名称' },
  { accessorKey: 'environment_type_label', header: '环境类型' },
  { accessorKey: 'relation_label', header: '关联类型' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'monthly_cost', header: '月度成本' }
]
const productColumns = [
  { accessorKey: 'product_code', header: '产品编码' },
  { accessorKey: 'product_name', header: '产品名称' },
  { accessorKey: 'relation_label', header: '关联类型' },
  { accessorKey: 'status_label', header: '状态' }
]
const documentColumns = [
  { accessorKey: 'document_id', header: '文档 UUID' },
  { accessorKey: 'artifact_type_label', header: '成果类型' },
  { accessorKey: 'document_type_label', header: '归档类型' },
  { accessorKey: 'remark', header: '说明' }
]
const handleRefresh = () => refresh()
const handleUpdated = async () => {
  await refresh()
}
</script>

<template>
  <UDashboardPanel id="delivery-detail" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          {{ delivery?.delivery_name || '交付详情' }}
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/deliveries"
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
          icon="i-lucide-box"
          color="primary"
          variant="soft"
          @click="linkProductOpen = true"
        >
          关联产品
        </UButton>
        <UButton
          icon="i-lucide-server"
          color="info"
          variant="soft"
          @click="linkEnvironmentOpen = true"
        >
          关联环境
        </UButton>
        <UButton
          icon="i-lucide-file-text"
          color="primary"
          variant="soft"
          @click="linkDocumentOpen = true"
        >
          关联文档
        </UButton>
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
        <UCard v-if="delivery">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold">{{ delivery.delivery_code }}</span>
              <UBadge color="warning" variant="soft">
                {{ deliveryStatusLabel }}
              </UBadge>
            </div>
          </template>

          <div class="grid gap-3 md:grid-cols-2 text-sm">
            <div><span class="text-muted">客户：</span>{{ delivery.customer_code }}</div>
            <div><span class="text-muted">合同：</span>{{ delivery.contract_code || '-' }}</div>
            <div><span class="text-muted">项目：</span>{{ delivery.project_code }}</div>
            <div><span class="text-muted">环境数量：</span>{{ delivery.environment_count }}</div>
            <div><span class="text-muted">月度成本：</span>¥{{ delivery.monthly_cost }}</div>
            <div><span class="text-muted">负责人：</span>{{ delivery.owner_uid || '-' }}</div>
            <div><span class="text-muted">计划上线：</span>{{ delivery.go_live_at || '-' }}</div>
            <div><span class="text-muted">验收时间：</span>{{ delivery.accepted_at || '-' }}</div>
          </div>
          <p class="mt-4 text-sm text-muted">
            {{ delivery.notes || '暂无说明' }}
          </p>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">关联环境</span>
          </template>
          <UTable :data="linkedEnvironments" :columns="environmentColumns" />
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">关联产品</span>
          </template>
          <UTable :data="linkedProducts" :columns="productColumns" />
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">交付文档包</span>
          </template>
          <UTable :data="documentItems" :columns="documentColumns" />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsDeliveryEditModal
    :open="editOpen"
    :delivery="delivery || null"
    @update:open="editOpen = $event"
    @updated="handleUpdated"
  />

  <AssetsDeliveryProductLinkModal
    :open="linkProductOpen"
    :delivery="delivery || null"
    @update:open="linkProductOpen = $event"
    @created="handleUpdated"
  />

  <AssetsDeliveryEnvironmentLinkModal
    :open="linkEnvironmentOpen"
    :delivery="delivery || null"
    @update:open="linkEnvironmentOpen = $event"
    @created="handleUpdated"
  />

  <AssetsDeliveryDocumentLinkModal
    :open="linkDocumentOpen"
    :delivery="delivery || null"
    @update:open="linkDocumentOpen = $event"
    @created="handleUpdated"
  />
</template>

<script setup lang="ts">
import { unwrapApiList } from '~/utils/apiResponse'

const toast = useToast()
const runtimeConfig = useRuntimeConfig()
const accountBaseUrl = computed(() => (runtimeConfig.public.accountUrl as string | undefined) || '')

// 加载配置数据
// 行业/区域字典由 account 模块统一维护，altoc 只做只读展示
const { data: industries } = useFetch('/api/v1/config/industries', { transform: unwrapApiList })
const { data: regions } = useFetch('/api/v1/config/regions', { transform: unwrapApiList })
// 本地字典 — 设置页要看到禁用项，统一带 includeDisabled=1
const { data: levels, refresh: refreshLevels } = useFetch('/api/v1/config/customer-levels', {
  query: { includeDisabled: 1 },
  transform: unwrapApiList
})
const { data: types, refresh: refreshTypes } = useFetch('/api/v1/config/customer-types', {
  query: { includeDisabled: 1 },
  transform: unwrapApiList
})
const { data: stages, refresh: refreshStages } = useFetch('/api/v1/config/opportunity-stages', {
  query: { includeDisabled: 1 },
  transform: unwrapApiList
})
const { data: templates } = useFetch('/api/v1/config/payment-term-templates', { transform: unwrapApiList })

const activeTab = ref('stages')
const tabs = [
  { label: '商机阶段', value: 'stages', icon: 'i-lucide-git-branch' },
  { label: '行业', value: 'industries', icon: 'i-lucide-factory' },
  { label: '区域', value: 'regions', icon: 'i-lucide-map-pin' },
  { label: '客户等级', value: 'levels', icon: 'i-lucide-star' },
  { label: '客户类型', value: 'types', icon: 'i-lucide-tag' },
  { label: '付款模板', value: 'templates', icon: 'i-lucide-file-text' }
]

// ---- 通用本地字典 CRUD（商机阶段 / 客户等级 / 客户类型）----
type DictEntity = 'opportunity_stage' | 'customer_level' | 'customer_type'

interface DictModalState {
  entity: DictEntity
  mode: 'create' | 'edit'
  row: Record<string, any>
}

const dictModal = ref<DictModalState | null>(null)

function refreshByEntity(entity: DictEntity) {
  if (entity === 'opportunity_stage') refreshStages()
  else if (entity === 'customer_level') refreshLevels()
  else if (entity === 'customer_type') refreshTypes()
}

function openCreate(entity: DictEntity) {
  const defaults: Record<DictEntity, Record<string, any>> = {
    opportunity_stage: { code: '', name: '', sort_no: 0, win_rate: 0, is_closed: 0, is_won: 0, is_lost: 0, is_enabled: 1 },
    customer_level: { code: '', name: '', sort_no: 0, is_enabled: 1 },
    customer_type: { code: '', name: '', is_partner_type: 0, is_enabled: 1 }
  }
  dictModal.value = { entity, mode: 'create', row: { ...defaults[entity] } }
}

function openEdit(entity: DictEntity, row: any) {
  dictModal.value = { entity, mode: 'edit', row: { ...row } }
}

async function saveDict() {
  if (!dictModal.value) return
  const { entity, mode, row } = dictModal.value
  try {
    await $fetch('/api/v1/config/dict', {
      method: mode === 'create' ? 'POST' : 'PUT',
      body: { entity, ...row }
    })
    toast.add({ title: '保存成功', color: 'success' })
    dictModal.value = null
    refreshByEntity(entity)
  } catch (err: any) {
    toast.add({
      title: '保存失败',
      description: err?.data?.statusMessage || String(err?.message || ''),
      color: 'error'
    })
  }
}

async function disableDict(entity: DictEntity, row: any) {
  if (!confirm(`确定禁用 "${row.name}"？\n禁用后业务页面将不再显示，但已关联数据保持不变。可在设置页恢复。`)) return
  try {
    await $fetch('/api/v1/config/dict', {
      method: 'DELETE',
      body: { entity, id: row.id }
    })
    toast.add({ title: '已禁用', color: 'success' })
    refreshByEntity(entity)
  } catch (err: any) {
    toast.add({ title: '操作失败', description: err?.data?.statusMessage || '', color: 'error' })
  }
}

async function enableDict(entity: DictEntity, row: any) {
  try {
    await $fetch('/api/v1/config/dict', {
      method: 'PUT',
      body: { entity, id: row.id, is_enabled: 1 }
    })
    toast.add({ title: '已启用', color: 'success' })
    refreshByEntity(entity)
  } catch {
    toast.add({ title: '操作失败', color: 'error' })
  }
}

// ---- 行业/区域：只读 ----
// 由 account 模块统一维护（GET /api/v1/companies/:code/business-domains + /regions）
// altoc 不提供本地 CRUD，管理员如需增删改请前往 Account 控制台

const stageColumns = [
  { accessorKey: 'sort_no', header: '排序' },
  { accessorKey: 'code', header: '编码' },
  { accessorKey: 'name', header: '名称' },
  { accessorKey: 'win_rate', header: '赢率(%)' },
  { accessorKey: 'is_closed', header: '关闭阶段' },
  { accessorKey: 'is_won', header: '赢单' },
  { accessorKey: 'is_lost', header: '输单' },
  { accessorKey: 'is_enabled', header: '启用' },
  { accessorKey: 'actions', header: '' }
]

const industryColumns = [
  { accessorKey: 'sort_no', header: '排序' },
  { accessorKey: 'code', header: '编码' },
  { accessorKey: 'name', header: '名称' },
  { accessorKey: 'category', header: '大类' }
]

const regionColumns = [
  { accessorKey: 'sort_no', header: '排序' },
  { accessorKey: 'code', header: '编码' },
  { accessorKey: 'name', header: '名称' }
]

const levelColumns = [
  { accessorKey: 'sort_no', header: '排序' },
  { accessorKey: 'code', header: '编码' },
  { accessorKey: 'name', header: '名称' },
  { accessorKey: 'is_enabled', header: '启用' },
  { accessorKey: 'actions', header: '' }
]

const typeColumns = [
  { accessorKey: 'code', header: '编码' },
  { accessorKey: 'name', header: '名称' },
  { accessorKey: 'is_partner_type', header: '渠道伙伴' },
  { accessorKey: 'is_enabled', header: '启用' },
  { accessorKey: 'actions', header: '' }
]

const templateColumns = [
  { accessorKey: 'code', header: '编码' },
  { accessorKey: 'name', header: '名称' }
]
</script>

<template>
  <UDashboardPanel id="settings">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          系统设置
        </h1>
      </Teleport>

      <div class="p-4 space-y-4">
        <UTabs v-model="activeTab" :items="tabs" class="w-full" />

        <!-- 商机阶段 -->
        <UCard v-if="activeTab === 'stages'">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">商机阶段配置</span>
              <UButton
                label="新增"
                icon="i-lucide-plus"
                size="sm"
                variant="soft"
                @click="openCreate('opportunity_stage')"
              />
            </div>
          </template>
          <UTable :data="stages || []" :columns="stageColumns">
            <template #win_rate-cell="{ row }">
              <span class="font-mono">{{ (row.original as any).win_rate }}%</span>
            </template>
            <template #is_closed-cell="{ row }">
              <UIcon v-if="(row.original as any).is_closed" name="i-lucide-check" class="text-success" />
            </template>
            <template #is_won-cell="{ row }">
              <UIcon v-if="(row.original as any).is_won" name="i-lucide-check" class="text-success" />
            </template>
            <template #is_lost-cell="{ row }">
              <UIcon v-if="(row.original as any).is_lost" name="i-lucide-check" class="text-error" />
            </template>
            <template #is_enabled-cell="{ row }">
              <UBadge
                v-if="(row.original as any).is_enabled"
                color="success"
                variant="subtle"
                size="xs"
              >
                启用
              </UBadge>
              <UBadge
                v-else
                color="neutral"
                variant="subtle"
                size="xs"
              >
                已禁用
              </UBadge>
            </template>
            <template #actions-cell="{ row }">
              <div class="flex gap-1">
                <UButton
                  icon="i-lucide-pencil"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  @click="openEdit('opportunity_stage', row.original)"
                />
                <UButton
                  v-if="(row.original as any).is_enabled"
                  icon="i-lucide-circle-slash"
                  variant="ghost"
                  color="error"
                  size="xs"
                  @click="disableDict('opportunity_stage', row.original)"
                />
                <UButton
                  v-else
                  icon="i-lucide-circle-check"
                  variant="ghost"
                  color="success"
                  size="xs"
                  @click="enableDict('opportunity_stage', row.original)"
                />
              </div>
            </template>
          </UTable>
        </UCard>

        <!-- 行业（只读 — 由 Account 统一管理） -->
        <UCard v-if="activeTab === 'industries'">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">行业配置（只读）</span>
              <UButton
                v-if="accountBaseUrl"
                label="前往 Account 管理"
                icon="i-lucide-external-link"
                size="sm"
                variant="soft"
                :to="`${accountBaseUrl}/companies`"
                target="_blank"
              />
            </div>
          </template>
          <UAlert
            icon="i-lucide-info"
            color="info"
            variant="subtle"
            title="行业字典由 Account 模块统一维护"
            description="为保证跨模块数据一致性，行业/业务领域字典已收归 Account。altoc 通过 API 实时获取，不提供本地增删改。"
            class="mb-4"
          />
          <UTable :data="industries || []" :columns="industryColumns" />
        </UCard>

        <!-- 区域（只读 — 由 Account 统一管理） -->
        <UCard v-if="activeTab === 'regions'">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">区域配置（只读）</span>
              <UButton
                v-if="accountBaseUrl"
                label="前往 Account 管理"
                icon="i-lucide-external-link"
                size="sm"
                variant="soft"
                :to="`${accountBaseUrl}/companies`"
                target="_blank"
              />
            </div>
          </template>
          <UAlert
            icon="i-lucide-info"
            color="info"
            variant="subtle"
            title="区域字典由 Account 模块统一维护"
            description="公司区域划分在 Account 企业管理中配置（支持模板初始化）。altoc 通过 API 实时获取。"
            class="mb-4"
          />
          <UTable :data="regions || []" :columns="regionColumns" />
        </UCard>

        <!-- 客户等级 -->
        <UCard v-if="activeTab === 'levels'">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">客户等级配置</span>
              <UButton
                label="新增"
                icon="i-lucide-plus"
                size="sm"
                variant="soft"
                @click="openCreate('customer_level')"
              />
            </div>
          </template>
          <UTable :data="levels || []" :columns="levelColumns">
            <template #is_enabled-cell="{ row }">
              <UBadge
                v-if="(row.original as any).is_enabled"
                color="success"
                variant="subtle"
                size="xs"
              >
                启用
              </UBadge>
              <UBadge
                v-else
                color="neutral"
                variant="subtle"
                size="xs"
              >
                已禁用
              </UBadge>
            </template>
            <template #actions-cell="{ row }">
              <div class="flex gap-1">
                <UButton
                  icon="i-lucide-pencil"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  @click="openEdit('customer_level', row.original)"
                />
                <UButton
                  v-if="(row.original as any).is_enabled"
                  icon="i-lucide-circle-slash"
                  variant="ghost"
                  color="error"
                  size="xs"
                  @click="disableDict('customer_level', row.original)"
                />
                <UButton
                  v-else
                  icon="i-lucide-circle-check"
                  variant="ghost"
                  color="success"
                  size="xs"
                  @click="enableDict('customer_level', row.original)"
                />
              </div>
            </template>
          </UTable>
        </UCard>

        <!-- 客户类型 -->
        <UCard v-if="activeTab === 'types'">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">客户类型配置</span>
              <UButton
                label="新增"
                icon="i-lucide-plus"
                size="sm"
                variant="soft"
                @click="openCreate('customer_type')"
              />
            </div>
          </template>
          <UTable :data="types || []" :columns="typeColumns">
            <template #is_partner_type-cell="{ row }">
              <UIcon v-if="(row.original as any).is_partner_type" name="i-lucide-check" class="text-success" />
            </template>
            <template #is_enabled-cell="{ row }">
              <UBadge
                v-if="(row.original as any).is_enabled"
                color="success"
                variant="subtle"
                size="xs"
              >
                启用
              </UBadge>
              <UBadge
                v-else
                color="neutral"
                variant="subtle"
                size="xs"
              >
                已禁用
              </UBadge>
            </template>
            <template #actions-cell="{ row }">
              <div class="flex gap-1">
                <UButton
                  icon="i-lucide-pencil"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  @click="openEdit('customer_type', row.original)"
                />
                <UButton
                  v-if="(row.original as any).is_enabled"
                  icon="i-lucide-circle-slash"
                  variant="ghost"
                  color="error"
                  size="xs"
                  @click="disableDict('customer_type', row.original)"
                />
                <UButton
                  v-else
                  icon="i-lucide-circle-check"
                  variant="ghost"
                  color="success"
                  size="xs"
                  @click="enableDict('customer_type', row.original)"
                />
              </div>
            </template>
          </UTable>
        </UCard>

        <!-- 付款模板 -->
        <UCard v-if="activeTab === 'templates'">
          <template #header>
            <span class="font-semibold text-sm">付款条款模板</span>
          </template>
          <UTable :data="templates || []" :columns="templateColumns" />
        </UCard>

        <!-- 统一字典编辑弹窗（商机阶段 / 客户等级 / 客户类型） -->
        <UModal v-if="dictModal" :open="!!dictModal" @update:open="(v: boolean) => { if (!v) dictModal = null }">
          <template #content>
            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <span class="font-semibold">{{ dictModal.mode === 'create' ? '新增' : '编辑' }}{{
                    dictModal.entity === 'opportunity_stage' ? '商机阶段'
                    : dictModal.entity === 'customer_level' ? '客户等级' : '客户类型'
                  }}</span>
                  <UButton
                    icon="i-lucide-x"
                    variant="ghost"
                    color="neutral"
                    size="xs"
                    @click="dictModal = null"
                  />
                </div>
              </template>
              <div class="space-y-4">
                <UFormField label="编码" required>
                  <UInput
                    v-model="dictModal.row.code"
                    :disabled="dictModal.mode === 'edit'"
                    placeholder="如 vip_a"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="名称" required>
                  <UInput v-model="dictModal.row.name" placeholder="显示名称" class="w-full" />
                </UFormField>
                <!-- 商机阶段专属字段 -->
                <template v-if="dictModal.entity === 'opportunity_stage'">
                  <UFormField label="排序号">
                    <UInput v-model.number="dictModal.row.sort_no" type="number" class="w-full" />
                  </UFormField>
                  <UFormField label="赢率(%)">
                    <UInput v-model.number="dictModal.row.win_rate" type="number" class="w-full" />
                  </UFormField>
                  <div class="flex gap-4">
                    <UCheckbox v-model="dictModal.row.is_closed" label="关闭阶段" />
                    <UCheckbox v-model="dictModal.row.is_won" label="赢单" />
                    <UCheckbox v-model="dictModal.row.is_lost" label="输单" />
                  </div>
                </template>
                <!-- 客户等级专属字段 -->
                <template v-else-if="dictModal.entity === 'customer_level'">
                  <UFormField label="排序号">
                    <UInput v-model.number="dictModal.row.sort_no" type="number" class="w-full" />
                  </UFormField>
                </template>
                <!-- 客户类型专属字段 -->
                <template v-else-if="dictModal.entity === 'customer_type'">
                  <UCheckbox v-model="dictModal.row.is_partner_type" label="是渠道伙伴类型" />
                </template>
              </div>
              <template #footer>
                <div class="flex justify-end gap-2">
                  <UButton
                    label="取消"
                    variant="ghost"
                    color="neutral"
                    @click="dictModal = null"
                  />
                  <UButton :label="dictModal.mode === 'create' ? '创建' : '保存'" color="primary" @click="saveDict" />
                </div>
              </template>
            </UCard>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>

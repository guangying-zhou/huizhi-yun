<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'
import { getProjectCategoryLabel } from '../../config/project'
import { projectStatusPresentation } from '../../utils/projectOverviewPresentation'

const props = defineProps<{ projectId: string, project: Record<string, unknown>, canManage: boolean }>()
const { moduleUrl } = useAimsModule()
const { confirm } = useConfirm()
const toast = useToast()
const value = (camel: string, snake = camel) => props.project[camel] ?? props.project[snake]
const fields = computed(() => [
  ['项目名称', value('name')], ['项目简称', value('shortName', 'short_name')], ['项目编码', value('projectCode', 'project_code')],
  ['内部代号', value('internalCode', 'internal_code')], ['类别', getProjectCategoryLabel(String(value('category') || ''))], ['方法论', value('methodology')],
  ['项目集', value('portfolioName', 'portfolio_name') || value('portfolioId', 'portfolio_id')], ['所属部门', value('deptName', 'dept_name') || value('deptCode', 'dept_code')],
  ['负责人', value('leaderName', 'leader_name') || value('leaderUid', 'leader_uid')], ['业务领域', value('domainName', 'domain_name') || value('domainCode', 'domain_code')],
  ['可见范围', ({ company: '公司可见', department: '部门可见', project_team: '项目团队', whitelist: '指定白名单' } as Record<string, string>)[String(value('securityLevel', 'security_level'))]],
  ['密级', value('confidentialityLevel', 'confidentiality_level')], ['客户编码', value('customerCode', 'customer_code')], ['客户名称', value('customerName', 'customer_name')],
  ['商机', value('oppId', 'opp_id')], ['合同', value('contractCode', 'contract_code') || value('contractId', 'contract_id')],
  ['开始日期', String(value('startDate', 'start_date') || '').slice(0, 10)], ['结束日期', String(value('endDate', 'end_date') || '').slice(0, 10)],
  ['服务线', value('serviceLineCode', 'service_line_code')], ['服务周期', value('servicePeriodLabel', 'service_period_label')],
  ['模板', value('templateSetName', 'template_set_name')], ['模板版本', value('templateVersionLabel', 'template_version_label')],
  ['创建人', value('createdBy', 'created_by')], ['创建时间', value('createdAt', 'created_at')], ['更新时间', value('updatedAt', 'updated_at')]
])
const status = computed(() => projectStatusPresentation(value('lifecycleStatus', 'lifecycle_status')))
const products = ref<{ product_code: string, product_name?: string, version_name?: string, is_primary?: number }[]>([])
const repos = ref<{ repoProjectCode: string, lastCommitSha?: string }[]>([])
const loading = ref(false)
const error = ref('')
const productCode = ref('')
const repoCode = ref('')
const saving = ref(false)
const operation = ref<{ key: string, kind: 'product' | 'repo-link' | 'repo-unlink', code: string } | null>(null)
const canLinkProduct = computed(() => props.canManage && value('category') === 'product_dev' && value('lifecycleStatus', 'lifecycle_status') === 'active')
async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const [p, r] = await Promise.all([
      $fetch<{ code: number, data: { items: typeof products.value } }>(moduleUrl(`/api/v1/projects/${props.projectId}/products`)),
      $fetch<{ code: number, data: { items: typeof repos.value } }>(moduleUrl(`/api/v1/projects/${props.projectId}/repos`))
    ])
    if (p.code !== 0 || r.code !== 0) throw Error('关联资料响应无效')
    products.value = p.data.items || []
    repos.value = r.data.items || []
  } catch {
    error.value = '产品或仓库关联资料暂不可用，请稍后刷新。'
  } finally {
    loading.value = false
  }
}
async function write(kind: 'product' | 'repo-link' | 'repo-unlink', code: string) {
  if (!props.canManage || !code.trim()) return
  if (!operation.value) {
    if (kind === 'repo-unlink' && !(await confirm({ title: '解绑项目仓库', message: `确定将仓库“${code}”从项目“${String(value('name'))}”解绑？不会删除 GitLab 仓库，但项目将失去此关联。`, confirmLabel: '解绑', tone: 'danger' }))) return
    operation.value = { key: crypto.randomUUID(), kind, code: code.trim() }
  }
  saving.value = true
  try {
    const intent = operation.value
    const response = await $fetch<{ code: number }>(moduleUrl(`/api/v1/projects/${props.projectId}/${intent.kind === 'product' ? 'products' : 'repos'}`), {
      method: intent.kind === 'repo-unlink' ? 'DELETE' : 'POST',
      headers: { 'Idempotency-Key': intent.key },
      ...(intent.kind === 'repo-unlink' ? { query: { repoProjectCode: intent.code } } : { body: intent.kind === 'product' ? { productCode: intent.code } : { repoProjectCode: intent.code } })
    })
    if (response.code !== 0) throw Error('关联操作响应无效')
    operation.value = null
    productCode.value = ''
    repoCode.value = ''
    toast.add({ title: intent.kind === 'product' ? '产品已关联' : intent.kind === 'repo-link' ? '仓库已关联' : '仓库已解绑', color: 'success' })
    await refresh()
  } catch (cause) {
    const failure = cause as { statusCode?: number, status?: number }
    const status = failure.statusCode || failure.status || 0
    toast.add({ title: status === 403 ? '没有此关联操作权限' : status === 409 ? '关联已变化，请刷新后重新确认' : '操作结果未确认，请使用原请求重试', color: 'error' })
    if (status && status < 500) operation.value = null
  } finally {
    saving.value = false
  }
}
onMounted(refresh)
</script>

<template>
  <div class="space-y-5">
    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h3 class="font-semibold">
            项目资料
          </h3>
          <UBadge :color="status.color" variant="subtle">
            {{ status?.label || value('lifecycleStatus', 'lifecycle_status') }}
          </UBadge>
        </div>
      </template>
      <dl class="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div v-for="[label, content] in fields" :key="String(label)" class="min-w-0">
          <dt class="text-sm text-muted">
            {{ label }}
          </dt>
          <dd class="mt-1 break-words [overflow-wrap:anywhere]">
            {{ content || '未设置' }}
          </dd>
        </div>
        <div class="min-w-0 sm:col-span-2 xl:col-span-3">
          <dt class="text-sm text-muted">
            项目说明
          </dt>
          <dd class="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {{ value('description') || '未设置' }}
          </dd>
        </div>
      </dl>
      <UButton
        class="mt-4"
        :to="moduleUrl(`/projects/${projectId}/members`)"
        color="neutral"
        variant="outline"
        label="项目成员"
        icon="i-lucide-users"
      />
    </UCard>
    <UAlert v-if="error" color="error" :description="error">
      <template #actions>
        <UButton
          label="刷新关联资料"
          color="neutral"
          variant="outline"
          :loading="loading"
          @click="refresh"
        />
      </template>
    </UAlert>
    <div class="grid min-w-0 gap-5 lg:grid-cols-2">
      <UCard>
        <template #header>
          <h3 class="font-semibold">
            关联产品
          </h3>
        </template>
        <div class="space-y-3">
          <USkeleton v-if="loading" class="h-16" />
          <CommonEmptyState v-else-if="!products.length && !error" title="暂无关联产品" />
          <div v-for="product in products" :key="product.product_code" class="flex min-w-0 flex-wrap items-center gap-2 rounded border border-muted p-3">
            <span class="break-words [overflow-wrap:anywhere]">{{ product.product_name || product.product_code }}</span>
            <span class="break-all text-sm text-muted">{{ product.product_code }}</span>
            <UBadge v-if="product.is_primary" color="primary" variant="subtle">
              主产品
            </UBadge>
            <span v-if="product.version_name" class="text-sm text-muted">{{ product.version_name }}</span>
          </div>
          <div v-if="canLinkProduct" class="flex flex-wrap items-end gap-2">
            <UFormField label="产品编码" class="min-w-0 flex-1">
              <UInput v-model="productCode" class="w-full" :disabled="!!operation" />
            </UFormField>
            <UButton
              label="关联产品"
              :loading="saving"
              :disabled="!productCode.trim() || !!operation"
              @click="write('product', productCode)"
            />
          </div>
        </div>
      </UCard>
      <UCard>
        <template #header>
          <h3 class="font-semibold">
            关联仓库
          </h3>
        </template>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            如需新建仓库请到 GitLab 创建后再关联。
          </p>
          <USkeleton v-if="loading" class="h-16" />
          <CommonEmptyState v-else-if="!repos.length && !error" title="暂无关联仓库" />
          <div v-for="repo in repos" :key="repo.repoProjectCode" class="flex min-w-0 items-center justify-between gap-2 rounded border border-muted p-3">
            <div class="min-w-0">
              <p class="break-all">
                {{ repo.repoProjectCode }}
              </p><p v-if="repo.lastCommitSha" class="truncate text-xs text-muted">
                {{ repo.lastCommitSha }}
              </p>
            </div>
            <UButton
              v-if="canManage"
              class="shrink-0"
              label="解绑"
              color="error"
              variant="ghost"
              :disabled="saving || !!operation"
              @click="write('repo-unlink', repo.repoProjectCode)"
            />
          </div>
          <div v-if="canManage" class="flex flex-wrap items-end gap-2">
            <UFormField label="已有仓库编码" class="min-w-0 flex-1">
              <UInput v-model="repoCode" class="w-full" :disabled="!!operation" />
            </UFormField>
            <UButton
              label="关联仓库"
              :loading="saving"
              :disabled="!repoCode.trim() || !!operation"
              @click="write('repo-link', repoCode)"
            />
          </div>
          <p v-else class="text-sm text-muted">
            仓库关联只读，仅有项目编辑范围权限的管理者可修改。
          </p>
        </div>
      </UCard>
    </div>
    <UAlert
      v-if="operation && !saving"
      color="warning"
      title="关联操作结果未确认"
      description="输入已保留，重试将沿用同一操作标识。"
    >
      <template #actions>
        <UButton label="按原请求重试" @click="write(operation.kind, operation.code)" />
      </template>
    </UAlert>
  </div>
</template>

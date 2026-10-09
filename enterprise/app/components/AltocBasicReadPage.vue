<script setup lang="ts">
import { altocReadFields, altocContractChildFields, altocQuotationItemFields, altocReadLabels, type AltocReadResource, type AltocReadRow } from '../../shared/altoc-basic-read'
import { applicationShellTargetUrl } from '../../../foundation/app/utils/applicationShell'

const props = defineProps<{ resource: AltocReadResource, title: string, detail?: boolean }>()
const route = useRoute()
const router = useRouter()
const folder = computed(() => props.resource === 'customer' ? 'customers' : props.resource === 'contract' ? 'contracts' : props.resource === 'receivable' ? 'payments' : props.resource === 'lead' ? 'leads' : props.resource === 'opportunity' ? 'opportunities' : 'quotes')
const listPath = computed(() => `/altoc/${folder.value}`)
const backPath = computed(() => {
  const value = typeof route.query.returnTo === 'string' ? route.query.returnTo : ''
  try {
    const url = new URL(value, 'https://host.invalid')
    return url.origin === 'https://host.invalid' && url.pathname === listPath.value ? `${url.pathname}${url.search}${url.hash}` : listPath.value
  } catch {
    return listPath.value
  }
})
const page = computed(() => Math.max(1, Number(route.query.page) || 1))
const search = ref(String(route.query.search || ''))
const status = ref(String(route.query.status || ''))
const customerId = ref(String(route.query.customerId || ''))
const opportunityId = ref(String(route.query.opportunityId || ''))
watch(() => route.query.customerId, (value) => {
  customerId.value = String(value || '')
})
watch(() => route.query.opportunityId, (value) => {
  opportunityId.value = String(value || '')
})
watch(() => route.query.search, (value) => {
  search.value = String(value || '')
})
watch(() => route.query.status, (value) => {
  status.value = String(value || '')
})
const { apps, loadApps } = useUserApplications()
const managementUrl = computed(() => {
  if (!import.meta.client)
    return ''
  const app = apps.value.find(item => item.appCode === 'altoc' && item.status !== 'disabled' && item.homeUrl)
  if (!app)
    return ''
  const url = applicationShellTargetUrl('', app.homeUrl, window.location.origin, app.basePath)
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin !== window.location.origin ? url : ''
  } catch {
    return ''
  }
})
onMounted(() => {
  void loadApps()
})
const data = ref<{ items?: AltocReadRow[], total?: number, [key: string]: unknown } | null>(null)
const pending = ref(false)
const errorStatus = ref(0)
let generation = 0
let controller: AbortController | undefined
const scopeKey = useState<string>('enterprise-cache-scope', () => '')
const { status: accessStatus } = useEnterpriseNavigationAccess()
async function load() {
  const epoch = ++generation
  controller?.abort()
  controller = new AbortController()
  data.value = null
  errorStatus.value = 0
  if (!scopeKey.value || accessStatus.value !== 'ready') {
    pending.value = accessStatus.value === 'loading'
    return
  }
  pending.value = true
  try {
    const id = props.detail ? String(route.params.customerId || route.params.contractId || route.params.planId || route.params.leadId || route.params.opportunityId || route.params.quotationId || '') : ''
    const response = await $fetch<{ code: number, data: NonNullable<typeof data.value> }>(`/altoc/api/v1/${folder.value}${props.detail ? `/${encodeURIComponent(id)}` : ''}`, { query: props.detail ? {} : route.query, signal: controller.signal })
    if (epoch === generation)
      data.value = response.data
  } catch (error) {
    if (epoch === generation)
      errorStatus.value = Number((error as { statusCode?: number, status?: number }).statusCode || (error as { status?: number }).status || 503)
  } finally {
    if (epoch === generation)
      pending.value = false
  }
}
watch([() => route.fullPath, scopeKey, accessStatus], load, { immediate: true, flush: 'sync' })
onScopeDispose(() => {
  generation++
  controller?.abort()
})
const errorText = computed(() => ({ 400: '筛选参数无效，请重新筛选', 401: '请先登录', 403: '无查看权限', 404: '记录不存在或不可访问' } as Record<number, string>)[errorStatus.value] || '资料暂不可用，请稍后重试')
const rows = computed(() => data.value?.items || [])
const detailFields = computed(() => altocReadFields[props.resource].filter(key => data.value && key in data.value))
const childLabels: Record<string, string> = { lines: '合同行', payment_terms: '付款条款', obligations: '合同义务', billing_schedules: '结算计划' }
const children = computed(() => props.resource === 'contract' && props.detail ? Object.entries(altocContractChildFields).map(([key, fields]) => ({ key, fields, title: childLabels[key], rows: (data.value?.[key] || []) as AltocReadRow[] })) : props.resource === 'quotation' && props.detail ? [{ key: 'items', fields: altocQuotationItemFields, title: '报价明细', rows: (data.value?.items || []) as AltocReadRow[] }] : [])
function show(value: unknown) {
  return value === null || value === undefined || value === '' ? '—' : String(value)
}
function applyFilters() {
  return router.push({ path: listPath.value, query: { ...(search.value.trim() ? { search: search.value.trim() } : {}), ...(status.value.trim() ? { status: status.value.trim() } : {}), ...(['opportunity', 'quotation'].includes(props.resource) && customerId.value.trim() ? { customerId: customerId.value.trim() } : {}), ...(props.resource === 'quotation' && opportunityId.value.trim() ? { opportunityId: opportunityId.value.trim() } : {}), page: '1' } })
}
function changePage(next: number) {
  return router.push({ path: listPath.value, query: { ...route.query, page: String(next) } })
}
</script>

<template>
  <div class="space-y-4 min-w-0">
    <ContentPageHeader
      :title="title"
      hosted
    >
      <template #actions>
        <UButton
          v-if="detail"
          :to="backPath"
          color="neutral"
          variant="outline"
        >
          返回列表
        </UButton>
        <UButton
          v-if="managementUrl"
          :href="managementUrl"
          target="_blank"
          rel="noopener noreferrer"
          color="neutral"
          variant="outline"
        >
          在 Altoc 管理
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          :loading="pending"
          @click="load"
        >
          刷新
        </UButton>
      </template>
    </ContentPageHeader>
    <p class="text-sm text-muted">
      仅展示基础资料。合同与回款金额不含实际收款、开票汇总；报价不含成本与毛利。
    </p>
    <p
      v-if="!managementUrl"
      class="text-sm text-muted"
    >
      独立 Altoc 管理入口尚未配置。
    </p>
    <form
      v-if="!detail"
      class="flex flex-wrap gap-2"
      @submit.prevent="applyFilters"
    >
      <UInput
        v-model="search"
        aria-label="搜索名称或编号"
        placeholder="搜索名称或编号"
        :maxlength="200"
      />
      <UInput
        v-model="status"
        aria-label="状态编码"
        placeholder="状态编码"
        :maxlength="40"
      />
      <UInput
        v-if="['opportunity', 'quotation'].includes(resource)"
        v-model="customerId"
        aria-label="客户标识"
        placeholder="客户标识"
        :maxlength="16"
      />
      <UInput
        v-if="resource === 'quotation'"
        v-model="opportunityId"
        aria-label="商机标识"
        placeholder="商机标识"
        :maxlength="16"
      />
      <UButton type="submit">
        筛选
      </UButton>
    </form>
    <p
      v-if="pending"
      role="status"
    >
      加载中…
    </p>
    <UAlert
      v-else-if="errorStatus"
      color="error"
      :title="errorText"
    />
    <template v-else-if="data">
      <template v-if="detail">
        <dl class="grid gap-3 sm:grid-cols-2">
          <div
            v-for="key in detailFields"
            :key="key"
            class="min-w-0 rounded border border-default p-3"
          >
            <dt class="text-sm text-muted">
              {{ altocReadLabels[key] || key }}
            </dt>
            <dd class="break-words whitespace-pre-wrap">
              {{ show(data[key]) }}
            </dd>
          </div>
        </dl>
        <section
          v-for="child in children"
          :key="child.key"
          class="space-y-2 min-w-0"
        >
          <h2 class="font-semibold">
            {{ child.title }}
          </h2>
          <p
            v-if="!child.rows.length"
            class="text-muted"
          >
            暂无记录
          </p>
          <div
            v-else
            class="overflow-x-auto"
          >
            <table class="w-full text-sm">
              <thead>
                <tr>
                  <th
                    v-for="field in child.fields"
                    :key="field"
                    class="p-2 text-left whitespace-nowrap"
                  >
                    {{ altocReadLabels[field] || field }}
                  </th>
                </tr>
              </thead><tbody>
                <tr
                  v-for="row in child.rows"
                  :key="String(row.id)"
                >
                  <td
                    v-for="field in child.fields"
                    :key="field"
                    class="p-2 max-w-64 break-words"
                  >
                    {{ show(row[field]) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
      <template v-else>
        <p
          v-if="!rows.length"
          class="text-muted"
        >
          暂无记录
        </p>
        <div
          v-else
          class="overflow-x-auto"
        >
          <table class="w-full text-sm">
            <thead>
              <tr>
                <th class="p-2 text-left">
                  编号
                </th><th class="p-2 text-left">
                  名称
                </th><th class="p-2 text-left">
                  状态
                </th><th class="p-2 text-left">
                  更新时间
                </th>
              </tr>
            </thead><tbody>
              <tr
                v-for="row in rows"
                :key="String(row.id)"
              >
                <td class="p-2 break-words">
                  {{ show(row.code) }}
                </td><td class="p-2 max-w-64 break-words">
                  <NuxtLink
                    :to="{ path: `${listPath}/${row.id}`, query: { returnTo: route.fullPath } }"
                    class="text-primary"
                  >{{ show(row.name || row.plan_name || row.quotation_no || row.code) }}</NuxtLink>
                </td><td class="p-2">
                  {{ show(row.status) }}
                </td><td class="p-2">
                  {{ show(row.updated_at) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-sm">共 {{ data.total }} 条 · 第 {{ page }} 页</span>
          <UButton
            color="neutral"
            variant="outline"
            :disabled="page <= 1"
            @click="changePage(page - 1)"
          >
            上一页
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            :disabled="page * Number(route.query.pageSize || 20) >= Number(data.total)"
            @click="changePage(page + 1)"
          >
            下一页
          </UButton>
        </div>
      </template>
    </template>
  </div>
</template>

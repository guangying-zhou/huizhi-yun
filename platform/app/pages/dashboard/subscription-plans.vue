<script setup lang="ts">
definePageMeta({ layout: 'console' })
usePageTitle('企业全量服务')
interface Order { orderNo: string, status: string, amount: string, currency: string, effectiveFrom: string, effectiveUntil: string, approvalReference: string, acceptedAt: string | null }
interface Entitlement { effectiveStatus: string, effectiveFrom: string, end: { kind: string, effectiveUntil?: string } }
const toast = useToast()
const state = ref<{ entitlement: Entitlement | null, legacySubscription?: { status: string, effectiveFrom: string, effectiveUntil: string | null } | null, orders: Order[] }>({ entitlement: null, orders: [] })
const loading = ref(false), busy = ref(''), error = ref('')
const labels: Record<string, string> = { active: '有效', suspended: '已暂停', revoked: '已撤销', expired: '已到期', pending: '尚未生效' }
async function refresh() {
  loading.value = true
  error.value = ''
  try {
    state.value = (await platformFetchJson<{ success: true, data: typeof state.value }>('/api/platform/tenant-admin/enterprise-orders')).data
  } catch (caught) {
    error.value = (caught as { data?: { message?: string }
    }).data?.message || '服务信息暂时无法加载，请重试。'
  } finally {
    loading.value = false
  }
}
function utc(value: string | undefined) {
  return value ? `${value.replace('T', ' ').replace('.000Z', '').replace('Z', '')} UTC` : '—'
}
async function accept(order: Order) {
  busy.value = order.orderNo
  try {
    await platformFetchJson('/api/platform/tenant-admin/enterprise-orders/accept', { method: 'POST', body: { orderNo: order.orderNo } })
    toast.add({ title: '已确认报价', description: '请按约定方式付款，运营核实实际到账后更新企业服务期间。', color: 'success' })
    await refresh()
  } catch (caught) {
    toast.add({ title: '确认失败', description: (caught as { data?: { message?: string } }).data?.message || '请联系企业所有者或重试。', color: 'error'
    })
  } finally {
    busy.value = ''
  }
}
await refresh()
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">
          企业全量服务
        </h1><p class="mt-1 text-sm text-muted">
          统一提供全量功能，人员权限由企业管理员配置。
        </p>
      </div><UButton
        label="刷新"
        variant="ghost"
        color="neutral"
        :loading="loading"
        @click="refresh"
      />
    </div>
    <UAlert
      v-if="error"
      color="error"
      :title="error"
    />
    <UCard>
      <div class="flex items-center justify-between gap-3">
        <h2 class="font-semibold">
          汇智云企业全量功能
        </h2><UBadge :color="state.entitlement?.effectiveStatus==='active' ? 'success' : 'neutral'">
          {{ state.entitlement ? labels[state.entitlement.effectiveStatus] || state.entitlement.effectiveStatus : state.legacySubscription ? '现有服务待统一' : '尚未开通' }}
        </UBadge>
      </div>
      <p
        v-if="state.entitlement"
        class="mt-3 text-sm"
      >
        {{ utc(state.entitlement.effectiveFrom) }} 至 {{ state.entitlement.end.kind==='unlimited' ? '无期限（已有批准依据）' : utc(state.entitlement.end.effectiveUntil) }}
      </p>
      <p
        v-else-if="!state.legacySubscription"
        class="mt-3 text-sm text-muted"
      >
        确认运营已批准的报价后，按约定付款。服务期间以批准订单为准。
      </p>
      <p
        v-if="state.legacySubscription"
        class="mt-3 text-sm text-muted"
      >
        历史服务记录已保留，等待按原服务期间转换为统一资格。
      </p>
      <p class="mt-2 text-sm text-muted">
        结束时间不包含该时刻。续用不会自动恢复暂停或撤销状态。
      </p>
    </UCard>
    <section class="space-y-3">
      <h2 class="font-semibold">
        已批准报价与订单
      </h2>
      <UEmpty
        v-if="!loading && !state.orders.length"
        icon="i-lucide-receipt-text"
        title="暂无已批准报价"
        description="请联系平台运营确认报价和服务期间。历史订阅及付款记录继续保留。"
      />
      <UCard
        v-for="order in state.orders"
        :key="order.orderNo"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="font-medium">
              {{ order.approvalReference }}
            </p><p class="mt-1 break-all text-xs text-muted">
              {{ order.orderNo }}
            </p>
          </div><UBadge color="neutral">
            {{ order.status==='paid' ? '已确认到账' : order.status!=='pending' ? order.status : order.acceptedAt ? '待确认到账' : '待企业确认' }}
          </UBadge>
        </div>
        <p class="mt-3 text-lg font-semibold">
          {{ order.amount }} {{ order.currency }}
        </p>
        <p class="mt-2 text-sm">
          {{ utc(order.effectiveFrom) }} 至 {{ utc(order.effectiveUntil) }}（结束时刻不含）
        </p>
        <div
          v-if="order.status==='pending'"
          class="mt-4 flex flex-wrap items-center justify-between gap-3"
        >
          <p class="text-sm text-muted">
            {{ order.acceptedAt ? '请按双方已确认的收款信息转账，等待运营核实到账。' : '企业所有者确认报价后，按约定方式付款。' }}
          </p><UButton
            v-if="!order.acceptedAt"
            label="确认此报价"
            :loading="busy===order.orderNo"
            @click="accept(order)"
          />
        </div>
      </UCard>
    </section>
  </div>
</template>

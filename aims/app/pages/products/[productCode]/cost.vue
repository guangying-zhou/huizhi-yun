<script setup lang="ts">
import type { ProductCostResult } from '~/types/productCost'
import { productCostBasisText, productCostReasonText } from '~/utils/productCostPresentation'

definePageMeta({ layoutHeaderTitle: '产品经营结果' })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const project = ref<{ id: number, project_code: string, name: string } | null>(null)
const period = ref(new Date().toISOString().slice(0, 7))
const selection = computed(() => `${code.value}:${project.value?.project_code || ''}:${period.value}`)
const result = ref<ProductCostResult | null>(null)
const error = shallowRef<unknown>(null)
const busy = ref(false)
let generation = 0
const alert = useApiErrorAlert(error, { fallbackTitle: '经营结果加载失败' })
watch(selection, () => {
  generation++
  result.value = null
  error.value = null
  busy.value = false
})
async function query() {
  if (!project.value || !period.value) return
  const current = ++generation
  const key = selection.value
  result.value = null
  error.value = null
  busy.value = true
  try {
    const response = await $fetch<{ code: number, data: ProductCostResult }>(`/api/v1/products/${encodeURIComponent(code.value)}/roadmaps/cost`, {
      query: { projectCode: project.value.project_code, periodMonth: period.value }, timeout: 30000
    })
    if (current !== generation || key !== selection.value) return
    if (response.code !== 0) throw new Error('经营服务响应无效')
    result.value = response.data
  } catch (cause) {
    if (current === generation && key === selection.value) error.value = cause
  } finally {
    if (current === generation) busy.value = false
  }
}
</script>

<template>
  <div class="min-w-0 space-y-6 p-4 sm:p-6">
    <h1 class="text-xl font-semibold">
      产品经营结果
    </h1>
    <UAlert
      color="info"
      variant="soft"
      title="按项目期间查看产品成本"
      :description="productCostBasisText"
    />
    <UButton :to="`/products/${encodeURIComponent(code)}/cost-rules`" color="neutral" variant="outline">
      维护分摊规则
    </UButton>
    <ProductsCostProjectPicker v-model="project" :product-code="code" :disabled="busy" />
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="query">
      <UFormField label="经营期间" required>
        <UInput v-model="period" type="month" :disabled="busy" />
      </UFormField>
      <UButton type="submit" :loading="busy" :disabled="!project || !period">
        查询经营结果
      </UButton>
    </form>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="busy" role="status" class="text-sm text-muted">
      正在核对成本与分摊规则…
    </p>
    <section v-if="result" class="space-y-4" aria-label="经营查询结果">
      <p class="break-words font-medium">
        {{ project?.name }} · {{ result.periodMonth }}
      </p>
      <p class="text-sm text-muted">
        产品分摊比例：{{ result.basisPoints === null ? '未配置' : `${result.basisPoints / 100}%` }}
      </p>
      <template v-if="result.ready">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UCard v-for="cost in result.costs" :key="cost.currencyCode">
            <p class="text-sm text-muted">
              产品成本 · {{ cost.currencyCode }}
            </p>
            <p class="mt-2 break-all text-2xl font-semibold tabular-nums">
              {{ cost.amount }}
            </p>
          </UCard>
        </div>
      </template>
      <UAlert v-else color="warning" title="成本尚未就绪">
        <template #description>
          <ul class="list-inside list-disc space-y-1">
            <li v-for="reason in result.reasons" :key="reason">
              {{ productCostReasonText(reason) }}
            </li>
          </ul>
        </template>
      </UAlert>
      <UAlert color="neutral" title="收入与毛利尚未就绪" description="尚未配置产品收入归因规则，合同金额、开票额和到账额不会替代产品收入。" />
      <details class="text-sm text-muted">
        <summary class="cursor-pointer">
          查看结果依据
        </summary>
        <p class="mt-2">
          分摊规则修订：{{ result.ruleRevision || '未配置' }}
        </p>
        <p class="break-all">
          来源修订：{{ result.sourceRevision }}
        </p>
      </details>
    </section>
  </div>
</template>

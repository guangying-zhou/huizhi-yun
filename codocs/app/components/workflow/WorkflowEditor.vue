<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- 元数据表单 -->
    <div class="shrink-0 px-4 py-3 border-b bg-gray-50 dark:bg-gray-900/50">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <UFormField label="模板名称" required>
          <UInput v-model="form.name" placeholder="请输入模板名称" />
        </UFormField>
        <UFormField label="审批类型" required>
          <USelectMenu
            v-model="form.review_type"
            :items="REVIEW_TYPES"
            placeholder="请选择"
            @update:model-value="form.sub_type = ''"
          />
        </UFormField>
        <UFormField v-if="form.review_type === '公司发文'" label="公文子类型" required>
          <USelectMenu v-model="form.sub_type" :items="SUB_TYPES" placeholder="请选择" />
        </UFormField>
        <UFormField label="状态">
          <USelectMenu v-model="form.status" :items="STATUS_OPTIONS" value-key="value" />
        </UFormField>
      </div>
    </div>

    <!-- 画布 + 配置面板 -->
    <div class="flex flex-1 min-h-0">
      <!-- VueFlow 画布 -->
      <div class="relative flex-1 min-w-0 bg-[#f8fafc]">
        <ClientOnly>
          <VueFlow
            :key="vueFlowKey"
            :nodes="flowNodes"
            :edges="flowEdges"
            :node-types="nodeTypes"
            :nodes-draggable="false"
            :nodes-connectable="false"
            :zoom-on-scroll="true"
            fit-view-on-init
            class="absolute inset-0"
            @node-click="onNodeClick"
            @pane-click="selectedNodeIndex = null"
          >
            <Background :gap="20" :size="1.5" pattern-color="#cbd5e1" />
            <Controls position="top-left" />
          </VueFlow>
          <template #fallback>
            <div class="absolute inset-0 flex items-center justify-center text-gray-400">
              <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin" />
            </div>
          </template>
        </ClientOnly>

        <!-- 添加步骤按钮 -->
        <div class="absolute bottom-4 left-0 right-0 flex justify-center z-10 pointer-events-none">
          <UButton
            icon="i-lucide-plus-circle"
            variant="soft"
            color="primary"
            size="sm"
            class="pointer-events-auto shadow-sm"
            :disabled="form.nodes.length >= 5"
            @click="addNode"
          >
            {{ form.nodes.length >= 5 ? '已达上限（5步）' : '添加审批步骤' }}
          </UButton>
        </div>
      </div>

      <!-- 节点配置面板 -->
      <div class="w-72 shrink-0 border-l flex flex-col bg-white dark:bg-gray-900">
        <!-- 空状态 -->
        <div
          v-if="selectedNodeIndex === null"
          class="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <UIcon name="i-lucide-mouse-pointer-click" class="w-12 h-12 text-gray-300" />
          <div>
            <p class="text-sm font-medium text-gray-500">
              点击节点配置审批步骤
            </p>
            <p class="mt-1 text-xs text-gray-400">
              选中步骤后可在此编辑名称、角色和通过方式
            </p>
          </div>
          <div class="mt-2 text-xs text-gray-400 bg-gray-50 rounded-lg p-3 space-y-1 w-full text-left">
            <p><UIcon name="i-lucide-info" class="inline w-3 h-3 mr-1" />最多可配置 5 个审批步骤</p>
            <p><UIcon name="i-lucide-info" class="inline w-3 h-3 mr-1" />步骤按顺序依次执行</p>
          </div>
        </div>

        <!-- 节点配置 -->
        <div v-else class="flex-1 overflow-y-auto p-4 space-y-4">
          <div class="flex items-center gap-2 pb-3 border-b">
            <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold">
              {{ selectedNodeIndex + 1 }}
            </span>
            <h3 class="font-semibold text-gray-900">
              步骤 {{ selectedNodeIndex + 1 }} 配置
            </h3>
          </div>

          <UFormField label="步骤名称" required>
            <UInput v-model="selectedNode!.name" placeholder="如：部门经理审批" />
          </UFormField>

          <UFormField label="审批角色" required>
            <USelectMenu
              v-model="selectedNode!.role"
              :items="ROLE_OPTIONS"
              value-key="value"
            />
          </UFormField>

          <UFormField label="通过方式" required>
            <USelectMenu
              v-model="selectedNode!.pass_type"
              :items="PASS_TYPE_OPTIONS"
              value-key="value"
            />
          </UFormField>

          <template v-if="selectedNode!.pass_type !== 'any'">
            <UFormField label="通过人数" required>
              <UInput v-model.number="selectedNode!.pass_count" type="number" :min="1" />
            </UFormField>
          </template>

          <template v-if="selectedNode!.pass_type === 'ratio'">
            <UFormField label="总人数" required>
              <UInput v-model.number="selectedNode!.pass_total" type="number" :min="1" />
            </UFormField>
          </template>

          <!-- 操作按钮 -->
          <div class="flex items-center gap-1 pt-1">
            <UButton
              v-if="selectedNodeIndex > 0"
              size="xs"
              variant="ghost"
              icon="i-lucide-chevron-left"
              @click="moveNode(-1)"
            >
              前移
            </UButton>
            <UButton
              v-if="selectedNodeIndex < form.nodes.length - 1"
              size="xs"
              variant="ghost"
              icon="i-lucide-chevron-right"
              trailing
              @click="moveNode(1)"
            >
              后移
            </UButton>
            <div class="flex-1" />
            <UButton
              size="xs"
              color="error"
              variant="soft"
              icon="i-lucide-trash-2"
              @click="removeNode"
            >
              删除
            </UButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作 -->
    <div class="shrink-0 px-4 py-3 border-t flex items-center justify-between bg-white dark:bg-gray-900">
      <span class="text-xs text-gray-400">
        {{ form.nodes.length }} 个审批步骤
        <template v-if="form.nodes.length === 0">
          · 请添加至少一个步骤
        </template>
      </span>
      <div class="flex gap-2">
        <UButton variant="outline" color="neutral" @click="$emit('cancel')">
          取消
        </UButton>
        <UButton color="primary" :loading="saving" @click="handleSave">
          保存模板
        </UButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { VueFlow, MarkerType } from '@vue-flow/core'
import type { Node as FlowNode, Edge as FlowEdge, NodeTypesObject } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import WorkflowApprovalNode from './WorkflowApprovalNode.vue'
import WorkflowStartEndNode from './WorkflowStartEndNode.vue'

// ---------- 类型定义 ----------

export interface ApprovalNodeData {
  index: number
  name: string
  role: string
  pass_type: 'all' | 'any' | 'ratio'
  pass_count: number
  pass_total?: number
}

export interface ReviewTemplateInput {
  id?: number
  name: string
  review_type: string
  sub_type?: string | null
  target_category: string
  status: number
  nodes: ApprovalNodeData[] | string
}

// ---------- Props & Emits ----------

const props = defineProps<{
  template: ReviewTemplateInput | null
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'save', data: Omit<ReviewTemplateInput, 'id'>): void
  (e: 'cancel'): void
}>()

// ---------- 常量 ----------

const REVIEW_TYPES = [
  '对外发文',
  '部门发文',
  '公司发文'
]

const SUB_TYPES = ['通知公告', '公司制度', '法务合规', '企业文化', '技术规范', '产品资料', '公司知识库', '文档模板']

const STATUS_OPTIONS = [
  { label: '启用', value: 1 },
  { label: '禁用', value: 0 }
]

const ROLE_OPTIONS = [
  { label: '部门经理', value: 'dept_manager' },
  { label: '分管领导', value: 'supervisor' },
  { label: '管理员', value: 'admin' }
]

const PASS_TYPE_OPTIONS = [
  { label: '全部通过', value: 'all' },
  { label: '任一通过', value: 'any' },
  { label: '按比例通过', value: 'ratio' }
]

const DEFAULT_NODE_NAMES = ['部门经理审批', '分管领导审批', '管理员审批', '审批步骤四', '审批步骤五']
const DEFAULT_NODE_ROLES = ['dept_manager', 'supervisor', 'admin', 'dept_manager', 'supervisor']

// ---------- 节点类型（需 markRaw 防止 Vue 代理化组件对象）----------

const nodeTypes: NodeTypesObject = {
  approvalStep: markRaw(WorkflowApprovalNode) as Component,
  startEnd: markRaw(WorkflowStartEndNode) as Component
}

// ---------- 表单状态 ----------

interface FormState {
  name: string
  review_type: string
  sub_type: string
  status: number
  nodes: ApprovalNodeData[]
}

const form = reactive<FormState>({
  name: '',
  review_type: '',
  sub_type: '',
  status: 1,
  nodes: []
})

// 根据审批类型+子类型自动推导归档目标
const autoTargetCategory = computed(() => {
  if (form.review_type === '部门发文') return 'department'
  if (form.review_type === '公司发文') {
    const map: Record<string, string> = {
      产品资料: 'product',
      公司知识库: 'knowledge',
      文档模板: 'template'
    }
    return map[form.sub_type] ?? 'company'
  }
  return 'company'
})

function parseNodes(raw: ApprovalNodeData[] | string | undefined): ApprovalNodeData[] {
  if (!raw) return []
  const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
  return arr.map((n: ApprovalNodeData, i: number) => ({ ...n, index: i }))
}

watch(() => props.template, (t) => {
  form.name = t?.name ?? ''
  form.review_type = t?.review_type ?? ''
  form.sub_type = t?.sub_type ?? ''
  form.status = t?.status ?? 1
  form.nodes = parseNodes(t?.nodes)
  vueFlowKey.value++
}, { immediate: true })

// ---------- 选中节点 ----------

const selectedNodeIndex = ref<number | null>(null)

const selectedNode = computed(() =>
  selectedNodeIndex.value !== null ? form.nodes[selectedNodeIndex.value] ?? null : null
)

// ---------- VueFlow 画布 ----------

const vueFlowKey = ref(0)

// 数据变化时防抖刷新（避免输入时频繁重渲染）
const debouncedRemount = useDebounceFn(() => {
  vueFlowKey.value++
}, 500)

watch(
  () => form.nodes.map(n => `${n.name}|${n.role}|${n.pass_type}|${n.pass_count}|${n.pass_total}`).join(','),
  debouncedRemount
)

const NODE_GAP = 240

function buildFlowNodes(nodes: ApprovalNodeData[]): FlowNode[] {
  const result: FlowNode[] = []

  result.push({
    id: 'start',
    type: 'startEnd',
    position: { x: 0, y: 40 },
    data: { label: '文档提交', type: 'start' },
    connectable: false,
    draggable: false
  })

  nodes.forEach((node, i) => {
    result.push({
      id: `approval-${i}`,
      type: 'approvalStep',
      position: { x: (i + 1) * NODE_GAP, y: 15 },
      data: { ...node },
      connectable: false,
      draggable: false
    })
  })

  result.push({
    id: 'end',
    type: 'startEnd',
    position: { x: (nodes.length + 1) * NODE_GAP, y: 40 },
    data: { label: '完成归档', type: 'end' },
    connectable: false,
    draggable: false
  })

  return result
}

function buildFlowEdges(nodes: ApprovalNodeData[]): FlowEdge[] {
  const edges: FlowEdge[] = []
  const edgeStyle = { stroke: '#94a3b8', strokeWidth: 2 }
  const markerEnd = { type: MarkerType.ArrowClosed, color: '#94a3b8' }

  if (nodes.length === 0) {
    edges.push({ id: 'e-start-end', source: 'start', target: 'end', style: edgeStyle, markerEnd })
    return edges
  }

  edges.push({ id: 'e-start-0', source: 'start', target: 'approval-0', style: edgeStyle, markerEnd })

  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `e-${i}-${i + 1}`,
      source: `approval-${i}`,
      target: `approval-${i + 1}`,
      style: edgeStyle,
      markerEnd
    })
  }

  edges.push({
    id: 'e-last-end',
    source: `approval-${nodes.length - 1}`,
    target: 'end',
    style: edgeStyle,
    markerEnd
  })

  return edges
}

const flowNodes = computed(() => buildFlowNodes(form.nodes))
const flowEdges = computed(() => buildFlowEdges(form.nodes))

// ---------- 节点操作 ----------

function onNodeClick({ node }: { node: FlowNode }) {
  if (node.type === 'approvalStep') {
    const match = node.id.match(/approval-(\d+)/)
    selectedNodeIndex.value = match?.[1] !== undefined ? parseInt(match[1]) : null
  } else {
    selectedNodeIndex.value = null
  }
}

function addNode() {
  if (form.nodes.length >= 5) return
  const idx = form.nodes.length
  form.nodes.push({
    index: idx,
    name: DEFAULT_NODE_NAMES[idx] ?? `步骤${idx + 1}`,
    role: DEFAULT_NODE_ROLES[idx] ?? 'dept_manager',
    pass_type: 'all',
    pass_count: 1
  })
  selectedNodeIndex.value = idx
  vueFlowKey.value++
}

function removeNode() {
  if (selectedNodeIndex.value === null) return
  const idx = selectedNodeIndex.value
  form.nodes.splice(idx, 1)
  form.nodes.forEach((n, i) => {
    n.index = i
  })
  selectedNodeIndex.value = form.nodes.length > 0 ? Math.min(idx, form.nodes.length - 1) : null
  vueFlowKey.value++
}

function moveNode(direction: -1 | 1) {
  if (selectedNodeIndex.value === null) return
  const idx = selectedNodeIndex.value
  const newIdx = idx + direction
  if (newIdx < 0 || newIdx >= form.nodes.length) return
  const tmp = form.nodes[idx]!
  form.nodes[idx] = form.nodes[newIdx]!
  form.nodes[newIdx] = tmp
  form.nodes.forEach((n, i) => {
    n.index = i
  })
  selectedNodeIndex.value = newIdx
  vueFlowKey.value++
}

// ---------- 保存 ----------

const toast = useToast()

function handleSave() {
  if (!form.name.trim()) {
    toast.add({ title: '请输入模板名称', color: 'warning' })
    return
  }
  if (!form.review_type) {
    toast.add({ title: '请选择审批类型', color: 'warning' })
    return
  }
  if (form.review_type === '公司发文' && !form.sub_type) {
    toast.add({ title: '请选择公文子类型', color: 'warning' })
    return
  }
  if (form.nodes.length === 0) {
    toast.add({ title: '请至少添加一个审批步骤', color: 'warning' })
    return
  }

  emit('save', {
    name: form.name.trim(),
    review_type: form.review_type,
    sub_type: form.sub_type || null,
    target_category: autoTargetCategory.value,
    status: form.status,
    nodes: form.nodes.map((n, i) => ({
      index: i,
      name: n.name,
      role: n.role,
      pass_type: n.pass_type,
      pass_count: n.pass_count,
      ...(n.pass_total !== undefined ? { pass_total: n.pass_total } : {})
    }))
  })
}
</script>

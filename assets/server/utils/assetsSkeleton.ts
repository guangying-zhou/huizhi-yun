const summaryColor = (color: 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error') => color

const assetEventsById: Record<number, Array<{
  id: number
  event_type: string
  operator_uid: string
  occurred_at: string
  summary: string
}>> = {
  1: [
    { id: 101, event_type: 'claim', operator_uid: 'zhangsan', occurred_at: '2026-03-18 10:30:00', summary: '笔记本分配给当前使用人' },
    { id: 102, event_type: 'inventory', operator_uid: 'asset-admin', occurred_at: '2026-03-10 09:00:00', summary: '完成季度盘点' }
  ],
  2: [
    { id: 201, event_type: 'activation', operator_uid: 'ops01', occurred_at: '2026-03-17 16:00:00', summary: '客户生产环境云主机开通并接入环境视图' },
    { id: 202, event_type: 'renewal', operator_uid: 'finance01', occurred_at: '2026-03-01 11:20:00', summary: '续费一年并更新月均成本' }
  ],
  3: [
    { id: 301, event_type: 'assignment', operator_uid: 'asset-admin', occurred_at: '2026-03-19 09:12:00', summary: '新增 5 个 GitLab Seat 分配到研发项目' }
  ]
}

const assetDocumentsById: Record<number, Array<{
  id: number
  document_id: string
  document_type: string
  remark: string
}>> = {
  2: [
    { id: 1, document_id: 'DOC-OPS-001', document_type: 'ops', remark: '客户生产环境部署手册' },
    { id: 2, document_id: 'DOC-DESIGN-023', document_type: 'design', remark: '交付环境网络拓扑' }
  ],
  3: [
    { id: 3, document_id: 'DOC-DEV-011', document_type: 'requirement', remark: '研发工具包授权说明' }
  ]
}

export const assetItems = [
  {
    id: 1,
    public_id: '8c486450-0d79-4c0d-85f5-59575e49aaaa',
    asset_code: 'PH-2026-001',
    asset_name: '研发部 MacBook Pro',
    asset_category: 'physical',
    asset_subtype: '办公设备',
    physical_item_type: '笔记本',
    brand: 'Apple',
    model: 'MacBook Pro 14',
    config_detail: 'M4 Pro / 36GB / 1TB SSD / 14英寸',
    serial_number: 'SN-MBP-001',
    qr_code: 'HZY-ASSET:8c486450-0d79-4c0d-85f5-59575e49aaaa',
    location: '深圳研发中心 7F / A-12',
    ownership_type: 'internal',
    status: 'in_use',
    dept_code: 'RD',
    project_code: 'HZY/AIMS',
    customer_code: null,
    contract_code: null,
    owner_uid: 'asset-admin',
    user_uid: 'zhangsan',
    custodian_uid: 'zhangsan',
    environment_name: null,
    monthly_cost: 580,
    expires_at: null,
    notes: '研发办公设备'
  },
  {
    id: 2,
    public_id: '8c486450-0d79-4c0d-85f5-59575e49aaab',
    asset_code: 'RS-2026-021',
    asset_name: '阿里云 ECS 生产节点',
    asset_category: 'resource',
    asset_subtype: '基础设施',
    ownership_type: 'customer_delivery',
    status: 'active',
    dept_code: 'OPS',
    project_code: 'HZY/AIMS',
    customer_code: 'CUS-SZGT',
    contract_code: 'HT-2026-018',
    owner_uid: 'ops01',
    user_uid: null,
    custodian_uid: null,
    environment_name: '苏州国土生产环境',
    monthly_cost: 2380,
    expires_at: '2026-04-20',
    notes: '客户交付生产节点'
  },
  {
    id: 3,
    public_id: '8c486450-0d79-4c0d-85f5-59575e49aaac',
    asset_code: 'RS-2026-034',
    asset_name: 'GitLab 企业版席位',
    asset_category: 'resource',
    asset_subtype: '订阅与席位',
    ownership_type: 'internal',
    status: 'active',
    dept_code: 'RD',
    project_code: 'HZY/PLATFORM',
    customer_code: null,
    contract_code: null,
    owner_uid: 'it01',
    user_uid: null,
    custodian_uid: null,
    environment_name: null,
    monthly_cost: 1260,
    expires_at: '2026-04-05',
    notes: '研发工具统一采购'
  }
]

export const environments = [
  {
    id: 1,
    environment_code: 'ENV-AIMS-PRD',
    environment_name: '苏州国土生产环境',
    environment_type: 'customer_prod',
    status: 'active',
    project_code: 'HZY/AIMS',
    customer_code: 'CUS-SZGT',
    contract_code: 'HT-2026-018',
    owner_uid: 'ops01',
    maintainer_uid: 'ops02',
    asset_count: 6,
    monthly_cost: 5820,
    topology_summary: 'ECS + RDS + OSS + 域名证书',
    notes: '客户生产环境'
  },
  {
    id: 2,
    environment_code: 'ENV-ASSETS-TEST',
    environment_name: 'Assets 测试环境',
    environment_type: 'test',
    status: 'active',
    project_code: 'HZY/ASSETS',
    customer_code: null,
    contract_code: null,
    owner_uid: 'devops01',
    maintainer_uid: 'devops01',
    asset_count: 4,
    monthly_cost: 1580,
    topology_summary: '测试用云主机和数据库',
    notes: '内部测试环境'
  }
]

export const deliveries = [
  {
    id: 1,
    delivery_code: 'DLV-2026-001',
    delivery_name: '苏州国土 Aims 项目交付',
    customer_code: 'CUS-SZGT',
    contract_code: 'HT-2026-018',
    project_code: 'HZY/AIMS',
    status: 'delivering',
    environment_count: 2,
    monthly_cost: 5820,
    owner_uid: 'pm01',
    go_live_at: '2026-04-01',
    accepted_at: null,
    notes: '一期交付进行中'
  }
]

export const suppliers = [
  {
    id: 1,
    supplier_code: 'SUP-ALIYUN',
    supplier_name: '阿里云',
    supplier_type: 'cloud',
    status: 'active',
    contact_name: '李顾问',
    contact_phone: '13800000001'
  },
  {
    id: 2,
    supplier_code: 'SUP-GITLAB',
    supplier_name: 'GitLab China',
    supplier_type: 'software',
    status: 'active',
    contact_name: '王经理',
    contact_phone: '13800000002'
  }
]

interface PurchaseOrderSkeleton {
  id: number
  order_no: string
  purchase_type: string
  purpose_type: string
  project_code: string | null
  contract_code: string | null
  supplier_name: string | null
  status: string
  budget_amount: number
  actual_amount: number | null
  applicant_uid: string
  created_at: string
}

interface PurchaseOrderDetailSkeleton extends PurchaseOrderSkeleton {
  items: Array<{
    id: number
    line_no: number
    item_name: string
    asset_category: string
    asset_subtype: string
    specification: string
    quantity: number
    total_price: number
  }>
}

export const purchaseOrders: PurchaseOrderSkeleton[] = [
  {
    id: 1,
    order_no: 'PO-2026-001',
    purchase_type: 'resource',
    purpose_type: 'customer_delivery',
    project_code: 'HZY/AIMS',
    contract_code: 'HT-2026-018',
    supplier_name: '阿里云',
    status: 'approved',
    budget_amount: 28800,
    actual_amount: null,
    applicant_uid: 'pm01',
    created_at: '2026-03-18 09:30:00'
  },
  {
    id: 2,
    order_no: 'PO-2026-002',
    purchase_type: 'physical',
    purpose_type: 'internal',
    project_code: 'HZY/ASSETS',
    contract_code: null,
    supplier_name: '京东政企',
    status: 'received',
    budget_amount: 13600,
    actual_amount: 13200,
    applicant_uid: 'asset-admin',
    created_at: '2026-03-15 14:10:00'
  }
]

export const purchaseOrderDetails: Record<number, PurchaseOrderDetailSkeleton> = {
  1: {
    ...purchaseOrders[0]!,
    items: [
      { id: 1, line_no: 1, item_name: '阿里云 ECS 节点', asset_category: 'resource', asset_subtype: '基础设施', specification: '4核8G', quantity: 2, total_price: 16800 },
      { id: 2, line_no: 2, item_name: '阿里云 RDS 实例', asset_category: 'resource', asset_subtype: '平台资源', specification: '双节点版', quantity: 1, total_price: 12000 }
    ]
  },
  2: {
    ...purchaseOrders[1]!,
    items: [
      { id: 3, line_no: 1, item_name: '联想笔记本', asset_category: 'physical', asset_subtype: '办公设备', specification: 'ThinkBook 16', quantity: 2, total_price: 13200 }
    ]
  }
}

export const receipts = [
  {
    id: 1,
    receipt_no: 'RC-2026-001',
    order_no: 'PO-2026-002',
    receipt_type: 'physical_stock_in',
    status: 'processed',
    operator_uid: 'asset-admin',
    processed_at: '2026-03-19 11:40:00'
  },
  {
    id: 2,
    receipt_no: 'RC-2026-002',
    order_no: 'PO-2026-001',
    receipt_type: 'resource_activation',
    status: 'draft',
    operator_uid: null,
    processed_at: null
  }
]

export const assignments = [
  {
    id: 1,
    assignment_no: 'OP-2026-001',
    asset_code: 'PH-2026-001',
    asset_name: '研发部 MacBook Pro',
    action_type: 'claim',
    target_type: 'user',
    target_ref: 'zhangsan',
    status: 'active',
    effective_at: '2026-03-18 10:30:00'
  },
  {
    id: 2,
    assignment_no: 'OP-2026-002',
    asset_code: 'RS-2026-034',
    asset_name: 'GitLab 企业版席位',
    action_type: 'assign',
    target_type: 'project',
    target_ref: 'HZY/PLATFORM',
    status: 'completed',
    effective_at: '2026-03-19 09:12:00'
  }
]

export const alerts = [
  {
    id: 1,
    alert_no: 'ALT-2026-001',
    alert_type: 'subscription_expiring',
    severity: summaryColor('warning'),
    title: 'GitLab 企业版席位 15 天后到期',
    status: 'pending',
    project_code: 'HZY/PLATFORM',
    due_at: '2026-04-05',
    triggered_at: '2026-03-21 09:00:00'
  },
  {
    id: 2,
    alert_no: 'ALT-2026-002',
    alert_type: 'resource_expiring',
    severity: summaryColor('error'),
    title: '客户生产环境 ECS 30 天内到期',
    status: 'pending',
    project_code: 'HZY/AIMS',
    due_at: '2026-04-20',
    triggered_at: '2026-03-21 08:40:00'
  },
  {
    id: 3,
    alert_no: 'ALT-2026-003',
    alert_type: 'seat_over_allocated',
    severity: summaryColor('info'),
    title: '设计工具 Seat 分配接近上限',
    status: 'acknowledged',
    project_code: 'HZY/ASSETS',
    due_at: null,
    triggered_at: '2026-03-20 15:20:00'
  }
]

export function getDashboardOverview() {
  return {
    metrics: [
      { label: '资产总数', value: 128, hint: 'P0 台账对象', color: 'primary' },
      { label: '活跃环境', value: 12, hint: '含客户与内部环境', color: 'success' },
      { label: '待处理预警', value: alerts.filter(item => item.status === 'pending').length, hint: '需要闭环', color: 'warning' },
      { label: '月度资源成本', value: '¥18,640', hint: '样例口径', color: 'info' }
    ],
    quick_links: [
      { label: '实物资产', description: '查看办公设备、家具设施、IT基础设施等台账', to: '/assets/physical', icon: 'i-lucide-laptop' },
      { label: '资源资产', description: '查看云资源、Seat、额度、证书', to: '/assets/resources', icon: 'i-lucide-cloud-cog' },
      { label: '环境视图', description: '按环境查看资源、责任人与成本', to: '/environments', icon: 'i-lucide-server-cog' },
      { label: '采购单', description: '进入采购申请与入库激活台', to: '/procurement/orders', icon: 'i-lucide-shopping-cart' }
    ],
    urgent_alerts: alerts.filter(item => item.status === 'pending'),
    expiring_assets: assetItems.filter(item => item.expires_at)
  }
}

export function listAssetItems(category?: string) {
  return category
    ? assetItems.filter(item => item.asset_category === category)
    : assetItems
}

export function getAssetDetail(id: number) {
  const item = assetItems.find(asset => asset.id === id)
  if (!item) return null

  return {
    ...item,
    tags: item.asset_category === 'resource'
      ? ['客户交付', '需续费']
      : [item.physical_item_type || item.asset_subtype, '可盘点'],
    documents: assetDocumentsById[id] || [],
    latest_events: assetEventsById[id] || []
  }
}

export function getAssetEvents(id: number) {
  return assetEventsById[id] || []
}

export function listEnvironments() {
  return environments
}

export function getEnvironment(id: number) {
  return environments.find(item => item.id === id) || null
}

export function listDeliveries() {
  return deliveries
}

export function getDelivery(id: number) {
  return deliveries.find(item => item.id === id) || null
}

export function listSuppliers() {
  return suppliers
}

export function listPurchaseOrders() {
  return purchaseOrders
}

export function getPurchaseOrderDetail(id: number) {
  return purchaseOrderDetails[id] || null
}

export function listReceipts() {
  return receipts
}

export function listAssignments() {
  return assignments
}

export function listAlerts() {
  return alerts
}

export function getSummaryCards(type: 'assets' | 'environments' | 'deliveries' | 'suppliers' | 'purchase_orders' | 'receipts' | 'assignments' | 'alerts') {
  switch (type) {
    case 'assets':
      return [
        { label: '总资产', value: assetItems.length, hint: '统一资产主表', color: 'primary' },
        { label: '资源资产', value: assetItems.filter(item => item.asset_category === 'resource').length, hint: '云资源 / Seat / 额度', color: 'info' },
        { label: '客户交付', value: assetItems.filter(item => item.ownership_type === 'customer_delivery').length, hint: '交付项目使用中', color: 'warning' }
      ]
    case 'environments':
      return [
        { label: '环境总数', value: environments.length, hint: '横向视图', color: 'primary' },
        { label: '活跃环境', value: environments.filter(item => item.status === 'active').length, hint: '当前运行中', color: 'success' },
        { label: '客户环境', value: environments.filter(item => item.customer_code).length, hint: '交付场景', color: 'info' }
      ]
    case 'deliveries':
      return [
        { label: '交付视图', value: deliveries.length, hint: '客户/合同/项目链路', color: 'primary' },
        { label: '交付中', value: deliveries.filter(item => item.status === 'delivering').length, hint: '待上线或待验收', color: 'warning' },
        { label: '月度成本', value: '¥5,820', hint: '样例口径', color: 'info' }
      ]
    case 'suppliers':
      return [
        { label: '供应商总数', value: suppliers.length, hint: '基础台账', color: 'primary' },
        { label: '云服务商', value: suppliers.filter(item => item.supplier_type === 'cloud').length, hint: '资源资产主力供应商', color: 'info' }
      ]
    case 'purchase_orders':
      return [
        { label: '采购单总数', value: purchaseOrders.length, hint: '当前样例', color: 'primary' },
        { label: '待入库/激活', value: purchaseOrders.filter(item => ['approved', 'received'].includes(item.status)).length, hint: '仍需处理', color: 'warning' }
      ]
    case 'receipts':
      return [
        { label: '入库/激活记录', value: receipts.length, hint: '当前样例', color: 'primary' },
        { label: '待处理', value: receipts.filter(item => item.status === 'draft').length, hint: '待激活或登记', color: 'warning' }
      ]
    case 'assignments':
      return [
        { label: '操作记录', value: assignments.length, hint: '分配/归还/释放', color: 'primary' },
        { label: '进行中', value: assignments.filter(item => item.status === 'active').length, hint: '尚未归还或结束', color: 'info' }
      ]
    case 'alerts':
      return [
        { label: '预警总数', value: alerts.length, hint: '样例预警', color: 'primary' },
        { label: '待处理', value: alerts.filter(item => item.status === 'pending').length, hint: '需要闭环', color: 'warning' },
        { label: '已确认', value: alerts.filter(item => item.status === 'acknowledged').length, hint: '已有人跟进', color: 'info' }
      ]
  }
}

export function getReports() {
  return {
    assets_summary: {
      summary: [
        { label: '资产总数', value: '128', hint: '含实物与资源', color: 'primary' },
        { label: '在用率', value: '81%', hint: '按样例估算', color: 'success' }
      ],
      rows: [
        { label: '实物资产', value: '52', hint: '办公设备、家具设施、IT基础设施' },
        { label: '资源资产', value: '76', hint: '云资源、Seat、额度、证书' }
      ]
    },
    expiring: {
      summary: getSummaryCards('alerts'),
      items: assetItems.filter(item => item.expires_at)
    },
    project_costs: {
      summary: [
        { label: '项目数', value: '2', hint: '当前样例', color: 'primary' },
        { label: '最高成本项目', value: 'HZY/AIMS', hint: '客户交付环境', color: 'warning' }
      ],
      rows: [
        { label: 'HZY/AIMS', value: '¥5,820 / 月', hint: '交付环境 + 云资源' },
        { label: 'HZY/PLATFORM', value: '¥1,260 / 月', hint: '研发工具与平台订阅' }
      ]
    },
    delivery_costs: {
      summary: [
        { label: '交付项目', value: '1', hint: '当前样例', color: 'primary' },
        { label: '交付月成本', value: '¥5,820', hint: '客户环境投入', color: 'info' }
      ],
      rows: [
        { label: '苏州国土 Aims 项目交付', value: '¥5,820 / 月', hint: 'ECS + RDS + 域名证书' }
      ]
    },
    environment_resources: {
      summary: getSummaryCards('environments'),
      rows: environments.map(item => ({
        label: item.environment_name,
        value: `¥${item.monthly_cost} / 月`,
        hint: `${item.asset_count} 个资产`
      }))
    }
  }
}

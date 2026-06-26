/**
 * Altoc 核心业务类型定义
 */

// ============================================================
// 通用类型
// ============================================================

export interface PaginationParams {
  page?: number
  pageSize?: number
  sort?: string
  order?: 'asc' | 'desc'
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface ApiResult<T = unknown> {
  code: number
  message: string
  data: T
}

// ============================================================
// 配置类型
// ============================================================

export interface Industry {
  id: number
  code: string
  name: string
  sort_no: number
  is_enabled: number
}

export interface Region {
  id: number
  code: string
  name: string
  parent_id: number | null
  sort_no: number
  is_enabled: number
  children?: Region[]
}

export interface CustomerLevel {
  id: number
  code: string
  name: string
  sort_no: number
  is_enabled: number
}

export interface CustomerType {
  id: number
  code: string
  name: string
  is_partner_type: number
  is_enabled: number
}

export interface OpportunityStage {
  id: number
  code: string
  pipeline_code?: string | null
  name: string
  stage_kind?: 'normal' | 'won' | 'lost' | 'paused' | string | null
  sort_no: number
  win_rate: number
  is_closed: number
  is_won: number
  is_lost: number
  required_fields_json: string | null
  exit_criteria_json: string | null
  is_enabled: number
}

// ============================================================
// 客户类型
// ============================================================

export interface Customer {
  id: number
  code: string
  name: string
  short_name: string | null
  customer_type_id: number | null
  industry_code: string | null
  region_code: string | null
  customer_level_id: number | null
  source_type: string | null
  status: 'draft' | 'approval_pending' | 'approved' | 'active' | 'inactive' | 'archived'
  owner_user_id: string
  owner_dept_code: string | null
  website: string | null
  province: string | null
  city: string | null
  address: string | null
  description: string | null
  is_partner: number
  credit_level: string | null
  last_follow_up_at: string | null
  remark: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  // 关联展示字段
  customer_type_name?: string
  industry_name?: string
  region_name?: string
  customer_level_name?: string
  owner_name?: string
  contact_count?: number
  opportunity_count?: number
}

export interface CustomerForm {
  name: string
  short_name?: string
  customer_type_id?: number | null
  industry_code?: string | null
  region_code?: string | null
  customer_level_id?: number | null
  source_type?: string
  status?: string
  owner_user_id: string
  owner_dept_code?: string
  website?: string
  province?: string
  city?: string
  address?: string
  description?: string
  is_partner?: number
  credit_level?: string
  remark?: string
}

// ============================================================
// 联系人类型
// ============================================================

export interface Contact {
  id: number
  customer_id: number
  name: string
  gender: number
  dept_name: string | null
  job_title: string | null
  mobile: string | null
  phone: string | null
  email: string | null
  wechat: string | null
  decision_role: string | null
  influence_level: string | null
  is_key_contact: number
  status: string
  owner_user_id: string | null
  remark: string | null
  created_at: string
  updated_at: string
}

export interface ContactForm {
  customer_id: number
  name: string
  gender?: number
  dept_name?: string
  job_title?: string
  mobile?: string
  phone?: string
  email?: string
  wechat?: string
  decision_role?: string
  influence_level?: string
  is_key_contact?: number
  remark?: string
}

// ============================================================
// 线索类型
// ============================================================

export interface Lead {
  id: number
  code: string
  name: string
  org_name: string | null
  source_type: string | null
  source_detail: string | null
  need_summary: string | null
  project_type: string | null
  budget_status: string | null
  estimated_budget: number | null
  procurement_mode: string | null
  expected_procurement_date: string | null
  source_evidence_url: string | null
  qualification_result: string | null
  qualification_reason_code: string | null
  contact_name: string | null
  contact_mobile: string | null
  contact_email: string | null
  status: 'new' | 'pending_assign' | 'following' | 'converted' | 'closed_invalid'
  owner_user_id: string | null
  owner_dept_code: string | null
  score: number | null
  next_action: string | null
  next_action_due_at: string | null
  last_follow_up_at: string | null
  invalid_reason_code: string | null
  invalid_reason: string | null
  converted_customer_id: number | null
  converted_opportunity_id: number | null
  converted_at: string | null
  remark: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // 关联展示字段
  owner_name?: string
}

export interface LeadForm {
  name: string
  org_name?: string
  source_type?: string
  source_detail?: string
  need_summary?: string
  project_type?: string
  budget_status?: string
  estimated_budget?: number | null
  procurement_mode?: string
  expected_procurement_date?: string
  source_evidence_url?: string
  qualification_result?: string
  qualification_reason_code?: string
  contact_name?: string
  contact_mobile?: string
  contact_email?: string
  owner_user_id?: string
  owner_dept_code?: string
  next_action?: string
  next_action_due_at?: string
  remark?: string
}

// ============================================================
// 商机类型
// ============================================================

export interface Opportunity {
  id: number
  code: string
  name: string
  customer_id: number
  lead_id: number | null
  source_type: string | null
  source_detail: string | null
  stage_id: number
  forecast_category: 'pipeline' | 'best_case' | 'commit'
  status: 'active' | 'won' | 'lost' | 'paused'
  amount_tax_inclusive: number | null
  amount_tax_exclusive: number | null
  currency_code: string
  expected_sign_date: string | null
  expected_payment_date: string | null
  win_rate: number | null
  owner_user_id: string
  owner_dept_code: string | null
  pre_sales_user_id: string | null
  delivery_user_id: string | null
  next_action: string | null
  next_action_due_at: string | null
  last_follow_up_at: string | null
  risk_level: string | null
  risk_reason: string | null
  competitor_info: string | null
  key_contact_complete_rate: number | null
  won_at: string | null
  won_reason_code: string | null
  won_reason: string | null
  lost_at: string | null
  lost_reason_code: string | null
  lost_reason: string | null
  pause_reason_code: string | null
  pause_reason: string | null
  remark: string | null
  created_at: string
  updated_at: string
  // 关联展示字段
  customer_code?: string
  customer_name?: string
  stage_name?: string
  stage_win_rate?: number | null
  owner_name?: string
}

export interface OpportunityForm {
  name: string
  customer_id: number
  stage_id: number
  source_type?: string
  source_detail?: string
  forecast_category?: string
  amount_tax_inclusive?: number | null
  amount_tax_exclusive?: number | null
  expected_sign_date?: string
  expected_payment_date?: string
  owner_user_id: string
  owner_dept_code?: string
  pre_sales_user_id?: string
  delivery_user_id?: string
  next_action?: string
  next_action_due_at?: string
  competitor_info?: string
  remark?: string
}

export interface OpportunityContactRole {
  id: number
  opportunity_id: number
  contact_id: number
  role: string
  influence_level: string | null
  attitude: string | null
  is_primary: number
  remark: string | null
  contact_name?: string | null
  contact_mobile?: string | null
  contact_email?: string | null
  contact_job_title?: string | null
  contact_dept_name?: string | null
}

// ============================================================
// 枚举/选项常量
// ============================================================

export const CUSTOMER_STATUS_OPTIONS = [
  { label: '草稿', value: 'draft', color: 'neutral' as const },
  { label: '审批中', value: 'approval_pending', color: 'warning' as const },
  { label: '已批准', value: 'approved', color: 'success' as const },
  { label: '活跃', value: 'active', color: 'success' as const },
  { label: '不活跃', value: 'inactive', color: 'warning' as const },
  { label: '已归档', value: 'archived', color: 'neutral' as const }
]

export const SOURCE_TYPE_OPTIONS = [
  { label: '市场活动', value: 'marketing' },
  { label: '渠道推荐', value: 'referral' },
  { label: '主动拜访', value: 'visit' },
  { label: '招标信息', value: 'tender' },
  { label: '合作伙伴', value: 'partner' },
  { label: '官网', value: 'website' },
  { label: '其他', value: 'other' }
]

export const LEAD_PROJECT_TYPE_OPTIONS = [
  { label: 'ToB 项目', value: 'tob' },
  { label: 'ToG 项目', value: 'tog' },
  { label: '续约', value: 'renewal' },
  { label: '增购', value: 'upsell' },
  { label: '渠道', value: 'channel' }
]

export const BUDGET_STATUS_OPTIONS = [
  { label: '未知', value: 'unknown' },
  { label: '申请中', value: 'applying' },
  { label: '已立项', value: 'approved' },
  { label: '已批复', value: 'allocated' }
]

export const PROCUREMENT_MODE_OPTIONS = [
  { label: '直采', value: 'direct' },
  { label: '竞争性磋商', value: 'competitive_consultation' },
  { label: '公开招标', value: 'open_tender' },
  { label: '框架采购', value: 'framework' },
  { label: '其他', value: 'other' }
]

export const QUALIFICATION_RESULT_OPTIONS = [
  { label: '通过', value: 'passed' },
  { label: '培育', value: 'nurture' },
  { label: '无效', value: 'invalid' },
  { label: '重复', value: 'duplicate' }
]

export const INVALID_REASON_OPTIONS = [
  { label: '联系方式无效', value: 'invalid_contact' },
  { label: '无真实需求', value: 'no_real_demand' },
  { label: '非目标客户', value: 'not_target_customer' },
  { label: '重复线索', value: 'duplicate' },
  { label: '项目已结束', value: 'project_finished' },
  { label: '无预算', value: 'no_budget' },
  { label: '客户拒绝', value: 'customer_rejected' },
  { label: '其他', value: 'other' }
]

export const LEAD_STATUS_OPTIONS = [
  { label: '新建', value: 'new', color: 'info' as const },
  { label: '待分配', value: 'pending_assign', color: 'warning' as const },
  { label: '跟进中', value: 'following', color: 'primary' as const },
  { label: '已转商机', value: 'converted', color: 'success' as const },
  { label: '已关闭', value: 'closed_invalid', color: 'neutral' as const }
]

export const OPPORTUNITY_STATUS_OPTIONS = [
  { label: '进行中', value: 'active', color: 'primary' as const },
  { label: '赢单', value: 'won', color: 'success' as const },
  { label: '输单', value: 'lost', color: 'error' as const },
  { label: '暂停', value: 'paused', color: 'warning' as const }
]

export const FORECAST_CATEGORY_OPTIONS = [
  { label: '管线', value: 'pipeline' },
  { label: '最佳预期', value: 'best_case' },
  { label: '承诺', value: 'commit' }
]

export const OPPORTUNITY_PIPELINE_OPTIONS = [
  { label: '通用项目销售', value: 'default' },
  { label: 'ToB 解决方案销售', value: 'solution' },
  { label: 'ToG 项目销售', value: 'tog_project' }
]

export const OPPORTUNITY_WON_REASON_OPTIONS = [
  { label: '业务价值明确', value: 'business_value' },
  { label: '客户关系优势', value: 'relationship_advantage' },
  { label: '技术方案匹配', value: 'technical_fit' },
  { label: '价格优势', value: 'price_advantage' },
  { label: '交付能力认可', value: 'delivery_capability' },
  { label: '采购时机成熟', value: 'procurement_timing' },
  { label: '其他', value: 'other' }
]

export const OPPORTUNITY_LOST_REASON_OPTIONS = [
  { label: '价格不匹配', value: 'price_mismatch' },
  { label: '竞品胜出', value: 'competitor_won' },
  { label: '预算取消', value: 'budget_cancelled' },
  { label: '需求变化', value: 'requirement_changed' },
  { label: '采购暂停', value: 'procurement_suspended' },
  { label: '关系不足', value: 'relationship_gap' },
  { label: '其他', value: 'other' }
]

export const OPPORTUNITY_PAUSE_REASON_OPTIONS = [
  { label: '客户预算暂停', value: 'customer_budget_paused' },
  { label: '采购流程暂停', value: 'procurement_paused' },
  { label: '关键人变动', value: 'stakeholder_changed' },
  { label: '需求待确认', value: 'requirement_pending' },
  { label: '内部资源不足', value: 'internal_capacity' },
  { label: '其他', value: 'other' }
]

export const OPPORTUNITY_SOURCE_OPTIONS = [
  { label: '客户拜访', value: 'customer_visit' },
  { label: '老客户回访', value: 'existing_customer_revisit' },
  { label: '电话营销', value: 'telemarketing' },
  { label: '网络推广', value: 'online_promotion' },
  { label: '他人推荐', value: 'referral' },
  { label: '其他', value: 'other' }
]

export const OPPORTUNITY_CONTACT_ROLE_OPTIONS = [
  { label: '决策人', value: 'decision_maker' },
  { label: '经济买方', value: 'economic_buyer' },
  { label: '支持者', value: 'sponsor' },
  { label: '采购负责人', value: 'procurement' },
  { label: '技术影响人', value: 'technical_influencer' },
  { label: '最终使用人', value: 'end_user' },
  { label: '竞品支持者', value: 'competitor_supporter' }
]

export const CONTACT_INFLUENCE_LEVEL_OPTIONS = [
  { label: '高', value: 'high' },
  { label: '中', value: 'medium' },
  { label: '低', value: 'low' }
]

export const CONTACT_ATTITUDE_OPTIONS = [
  { label: '支持', value: 'supportive' },
  { label: '中立', value: 'neutral' },
  { label: '阻力', value: 'resistant' },
  { label: '未知', value: 'unknown' }
]

export const DECISION_ROLE_OPTIONS = [
  { label: '决策人', value: 'decision_maker' },
  { label: '采购人', value: 'purchaser' },
  { label: '技术影响人', value: 'tech_influencer' },
  { label: '使用人', value: 'user' },
  { label: '其他', value: 'other' }
]

export const CREDIT_LEVEL_OPTIONS = [
  { label: 'A级', value: 'A' },
  { label: 'B级', value: 'B' },
  { label: 'C级', value: 'C' },
  { label: 'D级', value: 'D' }
]

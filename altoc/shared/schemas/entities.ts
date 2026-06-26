/**
 * 核心业务实体的 zod schema（前后端共享）
 *
 * 设计原则：
 * 1. **单一真相源** — 同一实体的字段名、类型、约束只在这里定义一次
 * 2. 前端页面与后端 API handler 都从这里 import
 * 3. **宽松 insert / 严格 update** — create 时允许省略默认字段；update 时允许 partial
 * 4. **不包含** id / created_at / updated_at / deleted_at / created_by / updated_by 等系统字段
 *
 * 使用示例：
 * ```ts
 * // 后端 API handler
 * import { customerCreateSchema } from '~~/shared/schemas/entities'
 *
 * const body = await readBody(event)
 * const parsed = customerCreateSchema.parse(body)  // throws on invalid
 * // 或 safeParse: const { success, data, error } = customerCreateSchema.safeParse(body)
 * ```
 *
 * 参数类型推导：
 * ```ts
 * type CustomerCreateInput = z.infer<typeof customerCreateSchema>
 * ```
 */
import { z } from 'zod'

// ---------- 通用片段 ----------
const nonEmptyStr = (label: string, max = 200) =>
  z.string({ message: `${label}不能为空` })
    .trim()
    .min(1, `${label}不能为空`)
    .max(max, `${label}长度不能超过 ${max} 字符`)

const optionalStr = (max = 500) =>
  z.string().trim().max(max).optional().nullable()

const moneyAmount = z.coerce.number({ message: '金额必须是数字' })
  .min(0, '金额不能为负')
  .max(1_000_000_000_000, '金额超出合理范围')

const percentRate = z.coerce.number({ message: '百分比必须是数字' })
  .min(0).max(100)

// ISO 日期字符串（YYYY-MM-DD）或 datetime
const isoDateStr = z.string().regex(
  /^\d{4}-\d{2}-\d{2}(T.*)?$/,
  '日期格式无效（应为 YYYY-MM-DD）'
).optional().nullable()

const requiredIsoDateStr = (label: string) =>
  z.string({ message: `${label}不能为空` })
    .trim()
    .min(1, `${label}不能为空`)
    .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, '日期格式无效（应为 YYYY-MM-DD）')

const uidStr = z.string().min(1, '用户 ID 不能为空').max(50)

// ---------- 1. Customer ----------
export const customerCreateSchema = z.object({
  name: nonEmptyStr('客户名称'),
  short_name: optionalStr(100),
  customer_type_id: z.coerce.number().int().positive().optional().nullable(),
  industry_code: optionalStr(50),
  region_code: optionalStr(50),
  customer_level_id: z.coerce.number().int().positive().optional().nullable(),
  source_type: optionalStr(30),
  owner_user_id: uidStr,
  owner_dept_code: optionalStr(50),
  website: z.string().trim().max(200).optional().nullable(),
  province: optionalStr(50),
  city: optionalStr(50),
  address: optionalStr(300),
  description: optionalStr(1000),
  is_partner: z.coerce.number().int().min(0).max(1).default(0).optional(),
  credit_level: optionalStr(30),
  remark: optionalStr(500)
})
export const customerUpdateSchema = customerCreateSchema.partial()

// ---------- 2. Lead ----------
const leadBaseSchema = z.object({
  name: nonEmptyStr('线索名称'),
  org_name: optionalStr(200),
  source_type: optionalStr(30),
  source_detail: optionalStr(300),
  need_summary: optionalStr(1000),
  project_type: optionalStr(30),
  budget_status: optionalStr(30),
  estimated_budget: moneyAmount.optional().nullable(),
  procurement_mode: optionalStr(50),
  expected_procurement_date: isoDateStr,
  source_evidence_url: z.union([
    z.literal(''),
    z.string().url('来源证据链接格式无效').max(500)
  ]).optional().nullable(),
  contact_name: optionalStr(100),
  contact_mobile: optionalStr(30),
  contact_email: z.union([
    z.literal(''),
    z.string().email('邮箱格式无效').max(100)
  ]).optional().nullable(),
  owner_user_id: uidStr.optional().nullable(),
  owner_dept_code: optionalStr(50),
  next_action: optionalStr(500),
  next_action_due_at: isoDateStr,
  remark: optionalStr(500)
})

export const leadCreateSchema = leadBaseSchema.extend({
  org_name: nonEmptyStr('组织/公司名称'),
  source_type: nonEmptyStr('来源渠道', 30),
  need_summary: nonEmptyStr('需求摘要', 1000),
  owner_user_id: uidStr,
  next_action: nonEmptyStr('下一步动作', 500),
  next_action_due_at: requiredIsoDateStr('下一步截止日期')
}).superRefine((value, ctx) => {
  const hasContact = Boolean(value.contact_name || value.contact_mobile || value.contact_email)
  const hasEvidence = Boolean(value.source_evidence_url)
  if (!hasContact && !hasEvidence) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contact_name'],
      message: '请提供联系人或来源证据'
    })
  }
})
export const leadUpdateSchema = leadBaseSchema.partial()

// ---------- 3. Opportunity ----------
export const opportunityCreateSchema = z.object({
  name: nonEmptyStr('商机名称'),
  customer_id: z.coerce.number({ message: '必须选择客户' }).int().positive('必须选择客户'),
  lead_id: z.coerce.number().int().positive().optional().nullable(),
  stage_id: z.coerce.number().int().positive().optional().nullable(),
  pipeline_code: optionalStr(50),
  source_type: optionalStr(50),
  source_detail: optionalStr(500),
  forecast_category: z.enum(['pipeline', 'best_case']).default('pipeline').optional(),
  amount_tax_inclusive: moneyAmount.optional().nullable(),
  amount_tax_exclusive: moneyAmount.optional().nullable(),
  currency_code: z.string().length(3).default('CNY').optional(),
  expected_sign_date: isoDateStr,
  expected_payment_date: isoDateStr,
  owner_user_id: uidStr,
  owner_dept_code: optionalStr(50),
  pre_sales_user_id: optionalStr(50),
  delivery_user_id: optionalStr(50),
  next_action: nonEmptyStr('下一步动作', 500),
  next_action_due_at: requiredIsoDateStr('下一步截止日期'),
  competitor_info: optionalStr(2000),
  remark: optionalStr(500)
})
export const opportunityUpdateSchema = z.object({
  name: nonEmptyStr('商机名称').optional(),
  customer_id: z.coerce.number().int().positive('必须选择客户').optional(),
  source_type: optionalStr(50),
  source_detail: optionalStr(500),
  forecast_category: z.enum(['pipeline', 'best_case', 'commit']).optional().nullable(),
  amount_tax_inclusive: moneyAmount.optional().nullable(),
  amount_tax_exclusive: moneyAmount.optional().nullable(),
  currency_code: z.string().length(3).optional(),
  expected_sign_date: isoDateStr,
  expected_payment_date: isoDateStr,
  owner_user_id: uidStr.optional(),
  owner_dept_code: optionalStr(50),
  pre_sales_user_id: optionalStr(50),
  delivery_user_id: optionalStr(50),
  next_action: optionalStr(500),
  next_action_due_at: isoDateStr,
  risk_level: z.enum(['high', 'medium', 'low']).optional().nullable(),
  risk_reason: optionalStr(500),
  competitor_info: optionalStr(2000),
  remark: optionalStr(500)
})

// ---------- 4. Quotation ----------
export const quotationCreateSchema = z.object({
  customer_id: z.coerce.number().int().positive('必须选择客户'),
  opportunity_id: z.coerce.number().int().positive().optional().nullable(),
  amount_tax_inclusive: moneyAmount.optional().nullable(),
  amount_tax_exclusive: moneyAmount.optional().nullable(),
  currency_code: z.string().length(3).default('CNY').optional(),
  tax_rate: percentRate.default(6).optional(),
  discount_rate: percentRate.optional().nullable(),
  gross_margin_rate: percentRate.optional().nullable(),
  valid_until: isoDateStr,
  owner_user_id: uidStr,
  owner_dept_code: optionalStr(50),
  remark: optionalStr(500)
})
export const quotationUpdateSchema = quotationCreateSchema.extend({
  status: z.enum([
    'draft', 'pending_approval', 'approved', 'rejected',
    'sent', 'accepted', 'expired', 'voided'
  ]).optional(),
  reject_reason: optionalStr(500)
}).partial()

// ---------- 5. Contract ----------
export const contractCreateSchema = z.object({
  name: nonEmptyStr('合同名称'),
  customer_id: z.coerce.number().int().positive('必须选择客户'),
  opportunity_id: z.coerce.number().int().positive().optional().nullable(),
  quotation_id: z.coerce.number().int().positive().optional().nullable(),
  amount_tax_inclusive: moneyAmount.optional().nullable(),
  amount_tax_exclusive: moneyAmount.optional().nullable(),
  currency_code: z.string().length(3).default('CNY').optional(),
  tax_rate: percentRate.default(6).optional(),
  sign_date: isoDateStr,
  effective_date: isoDateStr,
  expiry_date: isoDateStr,
  owner_user_id: uidStr,
  owner_dept_code: optionalStr(50),
  our_signatory: optionalStr(100),
  customer_signatory: optionalStr(100),
  description: optionalStr(2000),
  remark: optionalStr(500)
})
export const contractUpdateSchema = contractCreateSchema.extend({
  status: z.enum([
    'draft', 'pending_approval', 'approved', 'rejected',
    'effective', 'executing', 'delivering', 'accepted', 'service_ended',
    'completed', 'terminated', 'expired', 'invalid', 'archived'
  ]).optional(),
  execution_status: optionalStr(30),
  terminate_reason: optionalStr(500)
}).partial()

// ---------- 6. Receivable plan ----------
export const receivablePlanCreateSchema = z.object({
  contract_id: z.coerce.number().int().positive('必须指定合同'),
  customer_id: z.coerce.number().int().positive().optional().nullable(), // 可从 contract 反推
  opportunity_id: z.coerce.number().int().positive().optional().nullable(),
  payment_term_id: z.coerce.number().int().positive().optional().nullable(),
  plan_name: nonEmptyStr('计划名称'),
  plan_type: z.enum(['advance', 'milestone', 'acceptance', 'retention']).optional().nullable(),
  amount: moneyAmount,
  planned_invoice_date: isoDateStr,
  planned_payment_date: isoDateStr,
  owner_user_id: uidStr.optional().nullable(),
  remark: optionalStr(500)
})
export const receivablePlanUpdateSchema = receivablePlanCreateSchema.extend({
  status: z.enum([
    'pending', 'to_invoice', 'to_receive', 'partially_received',
    'received', 'overdue', 'bad_debt'
  ]).optional(),
  received_amount: moneyAmount.optional().nullable(),
  risk_level: z.enum(['high', 'medium', 'low']).optional().nullable()
}).partial()

// ---------- 导出类型推导 ----------
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>
export type LeadCreateInput = z.infer<typeof leadCreateSchema>
export type OpportunityCreateInput = z.infer<typeof opportunityCreateSchema>
export type QuotationCreateInput = z.infer<typeof quotationCreateSchema>
export type ContractCreateInput = z.infer<typeof contractCreateSchema>
export type ReceivablePlanCreateInput = z.infer<typeof receivablePlanCreateSchema>

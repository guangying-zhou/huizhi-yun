export type AltocReadResource = 'customer' | 'contract' | 'receivable' | 'lead' | 'opportunity' | 'quotation'
export const altocReadFields = {
  customer: ['id', 'code', 'name', 'short_name', 'status', 'industry_code', 'region_code', 'telephone', 'website', 'address', 'owner_user_id', 'owner_dept_code', 'created_at', 'updated_at'],
  contract: ['id', 'code', 'name', 'customer_id', 'parent_contract_id', 'status', 'legal_status', 'fulfillment_status', 'activation_status', 'direction', 'primary_type', 'sign_date', 'effective_date', 'end_date', 'amount_tax_inclusive', 'currency_code', 'owner_user_id', 'owner_dept_code', 'created_at', 'updated_at'],
  receivable: ['id', 'code', 'plan_name', 'contract_id', 'customer_id', 'amount', 'planned_payment_date', 'status', 'owner_user_id', 'collection_responsible_uid', 'updated_at'],
  lead: ['id','code','name','org_name','source_type','score','status','owner_user_id','owner_dept_code','last_follow_up_at','converted_customer_id','converted_opportunity_id','created_at','updated_at'],
  opportunity: ['id','code','name','status','customer_id','lead_id','stage_id','stage_name','stage_win_rate','amount_tax_inclusive','currency_code','forecast_category','win_rate','expected_sign_date','expected_payment_date','version_no','owner_user_id','owner_dept_code','created_at','updated_at'],
  quotation: ['id','code','quotation_no','version_no','status','customer_id','opportunity_id','amount_tax_inclusive','currency_code','valid_until','discount_rate','tax_rate','owner_user_id','owner_dept_code','created_at','updated_at']
} as const
export const altocContractChildFields = {
  lines: ['id', 'code', 'line_no', 'line_type', 'name', 'quantity', 'unit_price', 'amount_tax_inclusive'],
  payment_terms: ['id', 'term_name', 'term_type', 'amount', 'ratio', 'expected_date', 'sort_no'],
  obligations: ['id', 'code', 'contract_line_id', 'name', 'obligation_type', 'status', 'planned_due_at'],
  billing_schedules: ['id', 'code', 'contract_line_id', 'name', 'direction', 'amount', 'expected_date', 'status']
} as const
export type AltocReadRow = Record<string, string | number | boolean | null>
export const altocReadLabels: Record<string, string> = {
  id: '标识', code: '编号', name: '名称', short_name: '简称', plan_name: '计划名称', status: '状态', industry_code: '行业编码', region_code: '区域编码', telephone: '电话', website: '网站', address: '地址', owner_user_id: '负责人标识', owner_dept_code: '负责部门编码', created_at: '创建时间', updated_at: '更新时间', customer_id: '客户标识', parent_contract_id: '上级合同标识', contract_id: '合同标识', legal_status: '法律状态', fulfillment_status: '履约状态', activation_status: '启动状态', direction: '方向', primary_type: '类型', sign_date: '签订日期', effective_date: '生效日期', end_date: '结束日期', amount_tax_inclusive: '含税金额', currency_code: '币种', amount: '计划金额', planned_payment_date: '计划回款日期', collection_responsible_uid: '催收负责人标识', line_no: '行号', line_type: '行类型', quantity: '数量', unit_price: '单价', term_name: '条款名称', term_type: '条款类型', ratio: '比例', expected_date: '预计日期', sort_no: '顺序', contract_line_id: '合同行标识', obligation_type: '义务类型', planned_due_at: '计划到期时间'
}

export const altocQuotationItemFields = ['id','quotation_id','item_name','specification','unit','quantity','unit_price','amount_tax_inclusive','sort_no'] as const
Object.assign(altocReadLabels, { org_name:'组织名称',source_type:'来源类型',score:'评分',last_follow_up_at:'最近跟进',converted_customer_id:'已转换客户标识',converted_opportunity_id:'已转换商机标识',lead_id:'来源线索标识',stage_id:'阶段标识',stage_name:'阶段',stage_win_rate:'阶段默认赢率',forecast_category:'预测分类',win_rate:'赢率',expected_sign_date:'预计签约日期',expected_payment_date:'预计付款日期',version_no:'版本',quotation_no:'报价单号',opportunity_id:'商机标识',valid_until:'有效期',discount_rate:'折扣率',tax_rate:'税率',quotation_id:'报价标识',item_name:'项目名称',specification:'规格',unit:'单位' })

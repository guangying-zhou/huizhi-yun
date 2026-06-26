export type UiColor = 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'

export interface ApiResponse<T> {
  code: number
  message?: string
  data: T
}

export interface ListResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface SummaryMetric {
  label: string
  value: string | number
  hint?: string
  color?: UiColor
}

export interface QuickLinkItem {
  label: string
  description: string
  to: string
  icon: string
}

export interface DashboardOverview {
  metrics: SummaryMetric[]
  quick_links: QuickLinkItem[]
  active_cycles: PerformanceCycle[]
  recent_assignments: Assignment[]
}

export interface Employee {
  id: number
  employee_uid: string
  employee_no: string
  display_name: string
  initials?: string | null
  login_name?: string | null
  employment_status: string
  employment_type: string
  dept_code?: string | null
  dept_name?: string | null
  position_code?: string | null
  position_name?: string | null
  rank_code?: string | null
  rank_name?: string | null
  manager_uid?: string | null
  onboard_date?: string | null
  leave_date?: string | null
  work_location?: string | null
  cost_center_code?: string | null
  monthly_standard_cost?: number | string | null
  created_at?: string
  updated_at?: string
}

export interface EmployeeProfile {
  employee: Employee
  assignments: Assignment[]
  cost_snapshots: CostSnapshot[]
  project_contributions: ContributionSnapshot[]
  performance_cycles: PerformanceCycle[]
  documents: PeopleDocument[]
}

export interface Assignment {
  id: number
  assignment_code: string
  employee_uid: string
  change_type: string
  effective_from: string
  effective_to?: string | null
  dept_code?: string | null
  dept_name?: string | null
  position_code?: string | null
  position_name?: string | null
  rank_code?: string | null
  rank_name?: string | null
  manager_uid?: string | null
  workflow_instance_id?: string | null
  approval_status: string
  source_app?: string | null
  source_biz_type?: string | null
  source_biz_id?: string | null
  remarks?: string | null
  created_at?: string
  updated_at?: string
}

export interface CostSnapshot {
  id: number
  snapshot_code: string
  employee_uid: string
  period_month: string
  standard_cost: number | string
  actual_cost: number | string
  currency: string
  cost_source: string
  cost_basis?: string | null
  standard_rate_code?: string | null
  source_app?: string | null
  source_biz_type?: string | null
  source_biz_id?: string | null
  confirmed_at?: string | null
}

export interface PerformanceCycle {
  id: number
  cycle_code: string
  cycle_name: string
  cycle_type: string
  scope_type: string
  project_code?: string | null
  period_start: string
  period_end: string
  status: string
  workflow_instance_id?: string | null
  confirmed_at?: string | null
  closed_at?: string | null
}

export interface PerformanceCycleDetail {
  cycle: PerformanceCycle
  summary: Record<string, number | string>
  contribution_snapshots: ContributionSnapshot[]
}

export interface FinancePerformanceAmount {
  id: number
  code: string
  employee_uid: string
  employee_name?: string | null
  dept_code?: string | null
  period_month: string
  performance_type: string
  base_amount?: number | string | null
  performance_amount?: number | string | null
  performance_score?: number | string | null
  status: string
  calculated_at?: string | null
  project_codes?: string | null
  contribution_base_amount?: number | string | null
  cycle_code?: string | null
  project_code_filter?: string | null
}

export interface ContributionSnapshot {
  id: number
  contribution_code: string
  cycle_code: string
  employee_uid: string
  employee_name?: string | null
  project_code?: string | null
  role_code?: string | null
  work_hours: number | string
  contribution_score: number | string
  source_app: string
  source_biz_type?: string | null
  source_biz_id?: string | null
  captured_at?: string | null
  confirmed_at?: string | null
}

export interface PeopleDocument {
  id: number
  document_code: string
  employee_uid?: string | null
  cycle_code?: string | null
  project_code?: string | null
  document_uuid: string
  document_title?: string | null
  document_type: string
  source_app: string
  source_biz_type?: string | null
  source_biz_id?: string | null
}

export interface Position {
  id: number
  position_code: string
  position_name: string
  job_family?: string | null
  description?: string | null
  enabled: number | boolean
  sort_order: number
}

export interface Rank {
  id: number
  rank_code: string
  rank_name: string
  rank_level: number
  description?: string | null
  enabled: number | boolean
  sort_order: number
}

export interface StandardCostRate {
  id: number
  rate_code: string
  rate_name: string
  position_code?: string | null
  position_name?: string | null
  rank_code?: string | null
  rank_name?: string | null
  rank_series?: 'M' | 'P' | string | null
  rank_level?: number | string | null
  rank_salary?: number | string | null
  performance_salary_min?: number | string | null
  performance_salary_max?: number | string | null
  employment_type?: string | null
  cost_center_code?: string | null
  effective_from: string
  effective_to?: string | null
  currency: string
  direct_labor_cost: number | string
  benefit_cost: number | string
  management_allocation_cost: number | string
  resource_allocation_cost: number | string
  other_allocation_cost: number | string
  monthly_standard_cost: number | string
  enabled: number | boolean
  sort_order: number
  remarks?: string | null
}

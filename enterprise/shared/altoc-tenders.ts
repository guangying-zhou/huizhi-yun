export const tenderOperations = ['tenders-page', 'tenders-view', 'tenders-create', 'tenders-update', 'tender-agencies-page', 'tender-agencies-create', 'tender-members-add', 'tender-members-remove', 'tender-milestones-create', 'tender-milestones-update'] as const
export type TenderOperation = typeof tenderOperations[number]
export const tenderFields = ['name', 'owner_uid', 'owner_dept_code', 'presales_user_id', 'project_code', 'tenderer_name', 'contact_phone', 'contact_email', 'competitors', 'key_requirements', 'lost_to', 'lost_reason_detail', 'improvement_suggestion', 'remark', 'status', 'tender_type', 'lost_reason_type', 'publish_date', 'registration_deadline', 'bid_submission_deadline', 'bid_opening_date', 'winning_notice_date', 'budget_amount', 'bid_amount', 'bid_bond_amount', 'winning_amount', 'lost_to_amount', 'opportunity_id', 'customer_id', 'agency_id', 'contact_id']
export const tenderRowFields = ['id', 'code', 'row_version', 'created_at', 'updated_at', 'owner_user_id', ...tenderFields]
export const tenderStatuses = { info_gathering: '收集信息', qualification: '资质准备', bid_preparation: '编制投标', bid_submitted: '已提交', bid_opening: '已开标', won: '中标', lost: '落标', review_done: '复盘完成', abandoned: '已放弃' }
export const tenderTypes = { open: '公开招标', invited: '邀请招标', negotiation: '竞争性谈判', single_source: '单一来源', inquiry: '询价' }
export const tenderRoles = { pm: '项目经理', business: '商务', presales: '售前', technical: '技术', finance: '财务', member: '成员' }
export const tenderMilestoneStatuses = { todo: '待开始', in_progress: '进行中', done: '已完成', overdue: '已逾期' }

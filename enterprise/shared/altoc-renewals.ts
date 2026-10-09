export const renewalOperations = ['renewals-page', 'renewals-view', 'renewals-create', 'renewals-update'] as const
export type RenewalOperation = typeof renewalOperations[number]
export const renewalFields = ['customer_id', 'contract_id', 'name', 'renewal_type', 'expected_amount', 'expected_sign_date', 'stage', 'status', 'owner_uid', 'owner_dept_code', 'risk_level', 'reason', 'next_action', 'next_action_due_date']
export const renewalRowFields = ['id', 'code', 'row_version', 'customer_name', 'contract_name', ...renewalFields]

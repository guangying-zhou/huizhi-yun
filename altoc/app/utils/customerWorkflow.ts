export type CustomerWorkflowActionCode = 'approve'

interface CustomerWorkflowActionConfig {
  name: string
  submitLabel: string
  successLabel: string
}

export const customerWorkflowActionConfigs: Record<CustomerWorkflowActionCode, CustomerWorkflowActionConfig> = {
  approve: {
    name: '新增客户审批',
    submitLabel: '发起客户审批',
    successLabel: '客户审批'
  }
}

import { z } from 'zod'

const workItemTypeValues = ['requirement', 'task', 'bug'] as const
const priorityValues = ['P0', 'P1', 'P2', 'P3'] as const
const severityValues = ['critical', 'high', 'medium', 'low', 'suggestion'] as const

export const createWorkItemSchema = z.object({
  title: z
    .string({ error: '标题不能为空' })
    .trim()
    .min(1, '标题不能为空')
    .max(200, '标题不能超过200个字符'),
  type: z.enum(workItemTypeValues, {
    error: '请选择有效的工作项类型'
  }),
  priority: z.enum(priorityValues, {
    error: '请选择有效的优先级'
  }),
  description: z
    .string()
    .max(5000, '描述不能超过5000个字符')
    .nullable()
    .optional(),
  milestoneId: z
    .number()
    .int('里程碑ID必须为整数')
    .positive('里程碑ID必须为正整数')
    .nullable()
    .optional(),
  routineScope: z.enum(['department', 'cross_dept']).nullable().optional(),
  beneficiaryDeptCode: z.string().trim().nullable().optional(),
  isUnplanned: z.boolean().optional(),
  severity: z
    .enum(severityValues, {
      error: '请选择有效的严重程度'
    })
    .nullable()
    .optional(),
  assigneeUid: z
    .string()
    .nullable()
    .optional(),
  parentId: z
    .number()
    .int('父工作项ID必须为整数')
    .positive('父工作项ID必须为正整数')
    .nullable()
    .optional()
}).refine(
  (data) => {
    if (data.type === 'bug') {
      return data.severity != null
    }
    return true
  },
  { message: '缺陷类型必须指定严重程度', path: ['severity'] }
).refine(
  data => data.routineScope !== 'cross_dept' || Boolean(data.beneficiaryDeptCode),
  { message: '跨部门协作必须选择受益部门', path: ['beneficiaryDeptCode'] }
)

export const updateWorkItemSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, '标题不能为空')
    .max(200, '标题不能超过200个字符')
    .optional(),
  type: z.enum(workItemTypeValues, {
    error: '请选择有效的工作项类型'
  }).optional(),
  priority: z.enum(priorityValues, {
    error: '请选择有效的优先级'
  }).optional(),
  description: z
    .string()
    .max(5000, '描述不能超过5000个字符')
    .nullable()
    .optional(),
  milestoneId: z
    .number()
    .int('里程碑ID必须为整数')
    .positive('里程碑ID必须为正整数')
    .nullable()
    .optional(),
  routineScope: z.enum(['department', 'cross_dept']).nullable().optional(),
  beneficiaryDeptCode: z.string().trim().nullable().optional(),
  isUnplanned: z.boolean().optional(),
  severity: z
    .enum(severityValues, {
      error: '请选择有效的严重程度'
    })
    .nullable()
    .optional(),
  assigneeUid: z
    .string()
    .nullable()
    .optional(),
  parentId: z
    .number()
    .int('父工作项ID必须为整数')
    .positive('父工作项ID必须为正整数')
    .nullable()
    .optional()
})

export type CreateWorkItemInput = z.infer<typeof createWorkItemSchema>
export type UpdateWorkItemInput = z.infer<typeof updateWorkItemSchema>

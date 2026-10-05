import { z } from 'zod'

const pivrStageValues = ['P', 'I', 'V', 'R'] as const
const milestoneModeValues = ['strong_constraint', 'rolling_plan', 'periodic'] as const

export const createMilestoneSchema = z.object({
  name: z
    .string({ error: '里程碑名称不能为空' })
    .trim()
    .min(1, '里程碑名称不能为空')
    .max(100, '里程碑名称不能超过100个字符'),
  pivrStage: z.enum(pivrStageValues, {
    error: '请选择有效的PIVR阶段'
  }),
  mode: z.enum(milestoneModeValues, {
    error: '请选择有效的里程碑模式'
  }),
  startDate: z
    .string()
    .date('日期格式不正确')
    .nullable()
    .optional(),
  endDate: z
    .string()
    .date('日期格式不正确')
    .nullable()
    .optional(),
  description: z
    .string()
    .max(2000, '描述不能超过2000个字符')
    .nullable()
    .optional()
}).refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return new Date(data.endDate) > new Date(data.startDate)
    }
    return true
  },
  { message: '结束日期必须晚于开始日期', path: ['endDate'] }
).refine(
  (data) => {
    if (data.mode === 'strong_constraint') {
      return data.endDate != null
    }
    return true
  },
  { message: '强约束模式下必须指定结束日期', path: ['endDate'] }
)

export const updateMilestoneSchema = createMilestoneSchema.partial()

export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>

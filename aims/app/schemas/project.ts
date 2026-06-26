import { z } from 'zod'

const projectCategoryValues = [
  'product_dev',
  'custom_dev',
  'delivery',
  'maintenance',
  'sales',
  'presales',
  'improvement',
  'compliance'
] as const

const methodologyValues = ['PIVR', 'agile', 'waterfall', 'kanban', 'hybrid'] as const

export const createProjectSchema = z.object({
  name: z
    .string({ error: '项目名称不能为空' })
    .trim()
    .min(2, '项目名称至少2个字符')
    .max(100, '项目名称不能超过100个字符'),
  projectCode: z
    .string()
    .trim()
    .toUpperCase()
    .optional(),
  category: z.enum(projectCategoryValues, {
    error: '请选择有效的项目类别'
  }),
  methodology: z.enum(methodologyValues, {
    error: '请选择有效的项目管理方法论'
  }),
  description: z
    .string()
    .max(2000, '描述不能超过2000个字符')
    .nullable()
    .optional(),
  startDate: z
    .string()
    .date('日期格式不正确')
    .nullable()
    .optional(),
  endDate: z
    .string()
    .date('日期格式不正确')
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
)

export const updateProjectSchema = createProjectSchema.partial()

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>

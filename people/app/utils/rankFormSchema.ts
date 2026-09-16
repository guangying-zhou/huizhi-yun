import { z } from 'zod'

const nonNegativeInteger = (label: string) => z.union([z.string(), z.number()])
  .refine(value => String(value).trim().length > 0, `请输入${label}`)
  .transform(Number)
  .refine(value => Number.isInteger(value) && value >= 0, `${label}必须是非负整数`)

export const rankFormSchema = z.object({
  rankCode: z.string().trim().min(1, '请输入职级编码').max(32, '职级编码不能超过 32 个字符'),
  rankName: z.string().trim().min(1, '请输入职级名称').max(100, '职级名称不能超过 100 个字符'),
  rankSeries: z.enum(['M', 'P'], { message: '请选择职级类型' }),
  rankLevel: nonNegativeInteger('职级层级'),
  description: z.string().max(255, '说明不能超过 255 个字符'),
  enabled: z.boolean(),
  sortOrder: nonNegativeInteger('排序')
})

export type RankFormData = z.output<typeof rankFormSchema>

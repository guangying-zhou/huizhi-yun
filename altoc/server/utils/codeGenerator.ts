import { createError } from 'h3'

export async function generateCode(_prefix: string, _tableName: string): Promise<string> {
  throw createError({
    statusCode: 500,
    message: 'Local code generation DB helper is retired. Generate business codes in Altoc tenant-runtime.'
  })
}

import type { RowDataPacket } from '~~/server/utils/db'
import { createError } from 'h3'
import { execute, queryRow } from './db'
import { recalculateContractSummary } from './financeSummary'

export interface FinanceRecordConfig {
  table: string
  notFoundMessage: string
  summaryContractColumn?: string
}

export async function getFinanceRecord<T extends RowDataPacket>(
  code: string,
  config: FinanceRecordConfig
): Promise<T> {
  if (!code) {
    throw createError({ statusCode: 400, statusMessage: 'code is required' })
  }

  const row = await queryRow<T>(
    `SELECT * FROM ${config.table} WHERE code = ? ${hasSoftDelete(config.table) ? 'AND deleted_at IS NULL' : ''}`,
    [code]
  )
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: config.notFoundMessage })
  }
  return row
}

export async function softDeleteFinanceRecord(
  code: string,
  config: FinanceRecordConfig
): Promise<{ code: string, deleted: true }> {
  if (!code) {
    throw createError({ statusCode: 400, statusMessage: 'code is required' })
  }

  const row = await queryRow<RowDataPacket & { contract_code?: string | null }>(
    `SELECT * FROM ${config.table} WHERE code = ? ${hasSoftDelete(config.table) ? 'AND deleted_at IS NULL' : ''}`,
    [code]
  )
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: config.notFoundMessage })
  }

  if (!hasSoftDelete(config.table)) {
    throw createError({ statusCode: 400, statusMessage: `${config.table} does not support soft delete` })
  }

  await execute(
    `UPDATE ${config.table} SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE code = ? AND deleted_at IS NULL`,
    [code]
  )

  if (config.summaryContractColumn === 'contract_code') {
    await recalculateContractSummary(row.contract_code || null)
  }

  return { code, deleted: true }
}

function hasSoftDelete(table: string): boolean {
  return [
    'finance_bank_account',
    'invoice_request',
    'finance_invoice',
    'finance_receipt',
    'finance_expense',
    'expense_claim',
    'project_expense_request',
    'payment_request'
  ].includes(table)
}

import { createDbPool, queryRow, queryRows } from '../db.js';
const requiredFinanceTables = [
    'finance_bank_account',
    'finance_account_balance_snapshot',
    'finance_invoice',
    'finance_receipt',
    'finance_reconciliation',
    'finance_contract_summary',
    'expense_claim',
    'project_expense_request',
    'payment_request',
    'project_finance_summary'
];
function likeKeyword(keyword) {
    const escaped = keyword.replace(/[\\%_]/g, value => `\\${value}`);
    return `%${escaped}%`;
}
function isTruthy(value) {
    return value === '1' || value === 'true' || value === 'yes';
}
function normalizeSummary(row) {
    return {
        contractCode: row.contract_code,
        customerCode: row.customer_code,
        projectCode: row.project_code,
        contractAmount: row.contract_amount === null ? null : String(row.contract_amount),
        invoiceAmount: String(row.invoice_amount || '0.00'),
        receivedAmount: String(row.received_amount || '0.00'),
        reconciledAmount: String(row.reconciled_amount || '0.00'),
        unreceivedAmount: row.unreceived_amount === null ? null : String(row.unreceived_amount),
        unreconciledAmount: row.unreconciled_amount === null ? null : String(row.unreconciled_amount),
        invoiceCount: Number(row.invoice_count || 0),
        receiptCount: Number(row.receipt_count || 0),
        latestInvoiceDate: row.latest_invoice_date,
        latestReceivedAt: row.latest_received_at,
        riskStatus: row.risk_status || 'normal',
        calculatedAt: row.calculated_at
    };
}
export class FinanceAdapter {
    config;
    pool;
    constructor(config) {
        this.config = config;
        this.pool = createDbPool(config);
    }
    async ping() {
        await queryRow(this.pool, 'SELECT 1 AS ok');
    }
    async schemaStatus() {
        const rows = await queryRows(this.pool, `
      SELECT TABLE_NAME AS table_name
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${requiredFinanceTables.map(() => '?').join(', ')})
    `, requiredFinanceTables);
        const existing = new Set(rows.map(row => row.table_name));
        const missing = requiredFinanceTables.filter(table => !existing.has(table));
        return {
            app: 'finance',
            database: this.config.database,
            status: missing.length ? 'schema_mismatch' : 'ok',
            checkedTables: requiredFinanceTables,
            missingTables: missing
        };
    }
    async dashboardSummary() {
        const row = await queryRow(this.pool, `
      SELECT
        COALESCE((SELECT SUM(invoice_amount) FROM finance_invoice WHERE deleted_at IS NULL AND status <> 'canceled' AND DATE_FORMAT(COALESCE(invoice_date, created_at), '%Y-%m') = DATE_FORMAT(CURRENT_DATE(), '%Y-%m')), 0) AS monthInvoiceAmount,
        COALESCE((SELECT SUM(received_amount) FROM finance_receipt WHERE deleted_at IS NULL AND status <> 'canceled' AND DATE_FORMAT(received_at, '%Y-%m') = DATE_FORMAT(CURRENT_DATE(), '%Y-%m')), 0) AS monthReceiptAmount,
        COALESCE((SELECT COUNT(*) FROM expense_claim WHERE deleted_at IS NULL AND status = 'pending_approval'), 0)
          + COALESCE((SELECT COUNT(*) FROM project_expense_request WHERE deleted_at IS NULL AND status = 'pending_approval'), 0)
          + COALESCE((SELECT COUNT(*) FROM payment_request WHERE deleted_at IS NULL AND status = 'pending_approval'), 0) AS pendingExpenseCount,
        COALESCE((SELECT SUM(gross_profit_amount) FROM project_finance_summary WHERE period_month = DATE_FORMAT(CURRENT_DATE(), '%Y-%m')), 0) AS projectGrossProfitAmount,
        COALESCE((SELECT SUM(COALESCE(unreconciled_amount, received_amount - reconciled_amount)) FROM finance_receipt WHERE deleted_at IS NULL AND status IN ('confirmed', 'partially_reconciled')), 0) AS unreconciledReceiptAmount,
        COALESCE((SELECT COUNT(*) FROM finance_bank_account WHERE deleted_at IS NULL AND status = 'active'), 0) AS bankAccountCount
    `);
        return {
            data: {
                monthInvoiceAmount: String(row?.monthInvoiceAmount || '0.00'),
                monthReceiptAmount: String(row?.monthReceiptAmount || '0.00'),
                pendingExpenseCount: Number(row?.pendingExpenseCount || 0),
                projectGrossProfitAmount: String(row?.projectGrossProfitAmount || '0.00'),
                unreconciledReceiptAmount: String(row?.unreconciledReceiptAmount || '0.00'),
                bankAccountCount: Number(row?.bankAccountCount || 0)
            }
        };
    }
    async contractSummaries(url) {
        const codes = String(url.searchParams.get('contractCodes') || url.searchParams.get('contract_codes') || '')
            .split(',')
            .map(code => code.trim())
            .filter(Boolean)
            .slice(0, 100);
        if (codes.length === 0)
            return { data: [] };
        const seedSql = codes.map(() => 'SELECT ? AS contract_code').join(' UNION ALL ');
        const inSql = codes.map(() => '?').join(', ');
        const rows = await queryRows(this.pool, `
      SELECT
        seed.contract_code,
        COALESCE(summary.customer_code, invoice.customer_code, receipt.customer_code) AS customer_code,
        COALESCE(summary.project_code, invoice.project_code, receipt.project_code) AS project_code,
        summary.contract_amount,
        COALESCE(summary.invoice_amount, invoice.invoice_amount, 0) AS invoice_amount,
        COALESCE(summary.received_amount, receipt.received_amount, 0) AS received_amount,
        COALESCE(summary.reconciled_amount, reconciliation.reconciled_amount, 0) AS reconciled_amount,
        summary.unreceived_amount,
        COALESCE(summary.unreconciled_amount, COALESCE(receipt.received_amount, 0) - COALESCE(reconciliation.reconciled_amount, 0)) AS unreconciled_amount,
        COALESCE(summary.invoice_count, invoice.invoice_count, 0) AS invoice_count,
        COALESCE(summary.receipt_count, receipt.receipt_count, 0) AS receipt_count,
        COALESCE(summary.latest_invoice_date, invoice.latest_invoice_date) AS latest_invoice_date,
        COALESCE(summary.latest_received_at, receipt.latest_received_at) AS latest_received_at,
        COALESCE(summary.risk_status, 'normal') AS risk_status,
        COALESCE(summary.calculated_at, NOW()) AS calculated_at
      FROM (${seedSql}) seed
      LEFT JOIN finance_contract_summary summary ON summary.contract_code = seed.contract_code
      LEFT JOIN (
        SELECT
          contract_code,
          MAX(customer_code) AS customer_code,
          MAX(project_code) AS project_code,
          SUM(invoice_amount) AS invoice_amount,
          COUNT(*) AS invoice_count,
          MAX(invoice_date) AS latest_invoice_date
        FROM finance_invoice
        WHERE deleted_at IS NULL AND status <> 'canceled' AND contract_code IN (${inSql})
        GROUP BY contract_code
      ) invoice ON invoice.contract_code = seed.contract_code
      LEFT JOIN (
        SELECT
          contract_code,
          MAX(customer_code) AS customer_code,
          MAX(project_code) AS project_code,
          SUM(received_amount) AS received_amount,
          COUNT(*) AS receipt_count,
          MAX(received_at) AS latest_received_at
        FROM finance_receipt
        WHERE deleted_at IS NULL AND status <> 'canceled' AND contract_code IN (${inSql})
        GROUP BY contract_code
      ) receipt ON receipt.contract_code = seed.contract_code
      LEFT JOIN (
        SELECT contract_code, SUM(reconciled_amount) AS reconciled_amount
        FROM finance_reconciliation
        WHERE status = 'active' AND contract_code IN (${inSql})
        GROUP BY contract_code
      ) reconciliation ON reconciliation.contract_code = seed.contract_code
    `, [...codes, ...codes, ...codes, ...codes]);
        return { data: rows.map(normalizeSummary) };
    }
    async bankAccounts(url) {
        const where = ['ba.deleted_at IS NULL'];
        const params = [];
        const showAll = isTruthy(url.searchParams.get('showAll'));
        if (!showAll) {
            where.push('ba.status = ?');
            params.push('active');
            where.push('COALESCE(latest.balance_amount, 0) <> 0');
        }
        const keyword = String(url.searchParams.get('keyword') || '').trim();
        if (keyword) {
            where.push('(ba.code LIKE ? ESCAPE \'\\\\\' OR ba.account_name LIKE ? ESCAPE \'\\\\\' OR ba.bank_name LIKE ? ESCAPE \'\\\\\' OR ba.account_no_masked LIKE ? ESCAPE \'\\\\\' OR ba.owner_dept_code LIKE ? ESCAPE \'\\\\\')');
            params.push(...Array.from({ length: 5 }, () => likeKeyword(keyword)));
        }
        const status = String(url.searchParams.get('status') || '').trim();
        if (status) {
            where.push('ba.status = ?');
            params.push(status);
        }
        const whereSql = `WHERE ${where.join(' AND ')}`;
        const fromSql = `
      FROM finance_bank_account ba
      LEFT JOIN finance_account_balance_snapshot latest
        ON latest.id = (
          SELECT bs.id
          FROM finance_account_balance_snapshot bs
          WHERE bs.bank_account_id = ba.id
          ORDER BY bs.snapshot_date DESC, bs.id DESC
          LIMIT 1
        )
    `;
        const count = await queryRow(this.pool, `SELECT COUNT(*) AS total ${fromSql} ${whereSql}`, params);
        const summary = await queryRow(this.pool, `
      SELECT
        COUNT(*) AS account_count,
        COALESCE(SUM(CASE WHEN latest.balance_amount > 0 THEN latest.balance_amount ELSE 0 END), 0) AS cash_balance,
        COALESCE(SUM(CASE WHEN latest.balance_amount < 0 THEN latest.balance_amount ELSE 0 END), 0) AS loan_balance,
        COALESCE(SUM(CASE WHEN latest.balance_amount <> 0 THEN latest.balance_amount ELSE 0 END), 0) AS stock_fund_balance
      ${fromSql}
      ${whereSql}
    `, params);
        const rows = await queryRows(this.pool, `
      SELECT
        ba.id,
        ba.code,
        ba.account_name,
        ba.bank_name,
        ba.account_no_masked,
        ba.account_type,
        ba.currency_code,
        ba.owner_dept_code,
        ba.status,
        ba.opened_at,
        ba.created_at,
        ba.deleted_at,
        latest.balance_amount AS latest_balance_amount,
        latest.snapshot_date AS latest_balance_date
      ${fromSql}
      ${whereSql}
      ORDER BY latest.snapshot_date DESC, ba.created_at DESC, ba.id DESC
    `, params);
        return {
            data: rows,
            summary: {
                account_count: Number(summary?.account_count || 0),
                cash_balance: String(summary?.cash_balance || '0.00'),
                loan_balance: String(summary?.loan_balance || '0.00'),
                stock_fund_balance: String(summary?.stock_fund_balance || '0.00')
            },
            total: Number(count?.total || 0),
            page: 1,
            pageSize: Number(count?.total || 0)
        };
    }
}

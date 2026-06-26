-- ============================================================
-- Finance migration: update chart of accounts to 小企业会计准则
-- Source: finance/docs/小企业会计准则.pdf
-- Date: 2026-05-18
--
-- Scope:
--   1. Upsert the 66 standard subjects from 小企业会计准则附录.
--   2. Rebind default income/expense type mappings to standard subjects.
--   3. Mark legacy operating-category subjects inactive instead of deleting
--      them, so existing business rows with subject_id foreign keys remain valid.
--
-- This script is idempotent and can be rerun.
-- ============================================================

START TRANSACTION;

INSERT INTO finance_subject (code, name, subject_type, sort_no, status, remark) VALUES
('1001', '库存现金', 'asset', 10, 'active', '小企业会计准则附录：会计科目'),
('1002', '银行存款', 'asset', 20, 'active', '小企业会计准则附录：会计科目'),
('1012', '其他货币资金', 'asset', 30, 'active', '小企业会计准则附录：会计科目'),
('1101', '短期投资', 'asset', 40, 'active', '小企业会计准则附录：会计科目'),
('1121', '应收票据', 'asset', 50, 'active', '小企业会计准则附录：会计科目'),
('1122', '应收账款', 'asset', 60, 'active', '小企业会计准则附录：会计科目'),
('1123', '预付账款', 'asset', 70, 'active', '小企业会计准则附录：会计科目'),
('1131', '应收股利', 'asset', 80, 'active', '小企业会计准则附录：会计科目'),
('1132', '应收利息', 'asset', 90, 'active', '小企业会计准则附录：会计科目'),
('1221', '其他应收款', 'asset', 100, 'active', '小企业会计准则附录：会计科目'),
('1401', '材料采购', 'asset', 110, 'active', '小企业会计准则附录：会计科目'),
('1402', '在途物资', 'asset', 120, 'active', '小企业会计准则附录：会计科目'),
('1403', '原材料', 'asset', 130, 'active', '小企业会计准则附录：会计科目'),
('1404', '材料成本差异', 'asset', 140, 'active', '小企业会计准则附录：会计科目'),
('1405', '库存商品', 'asset', 150, 'active', '小企业会计准则附录：会计科目'),
('1407', '商品进销差价', 'asset', 160, 'active', '小企业会计准则附录：会计科目'),
('1408', '委托加工物资', 'asset', 170, 'active', '小企业会计准则附录：会计科目'),
('1411', '周转材料', 'asset', 180, 'active', '小企业会计准则附录：会计科目'),
('1421', '消耗性生物资产', 'asset', 190, 'active', '小企业会计准则附录：会计科目'),
('1501', '长期债券投资', 'asset', 200, 'active', '小企业会计准则附录：会计科目'),
('1511', '长期股权投资', 'asset', 210, 'active', '小企业会计准则附录：会计科目'),
('1601', '固定资产', 'asset', 220, 'active', '小企业会计准则附录：会计科目'),
('1602', '累计折旧', 'asset', 230, 'active', '小企业会计准则附录：会计科目'),
('1604', '在建工程', 'asset', 240, 'active', '小企业会计准则附录：会计科目'),
('1605', '工程物资', 'asset', 250, 'active', '小企业会计准则附录：会计科目'),
('1606', '固定资产清理', 'asset', 260, 'active', '小企业会计准则附录：会计科目'),
('1621', '生产性生物资产', 'asset', 270, 'active', '小企业会计准则附录：会计科目'),
('1622', '生产性生物资产累计折旧', 'asset', 280, 'active', '小企业会计准则附录：会计科目'),
('1701', '无形资产', 'asset', 290, 'active', '小企业会计准则附录：会计科目'),
('1702', '累计摊销', 'asset', 300, 'active', '小企业会计准则附录：会计科目'),
('1801', '长期待摊费用', 'asset', 310, 'active', '小企业会计准则附录：会计科目'),
('1901', '待处理财产损溢', 'asset', 320, 'active', '小企业会计准则附录：会计科目'),
('2001', '短期借款', 'liability', 330, 'active', '小企业会计准则附录：会计科目'),
('2201', '应付票据', 'liability', 340, 'active', '小企业会计准则附录：会计科目'),
('2202', '应付账款', 'liability', 350, 'active', '小企业会计准则附录：会计科目'),
('2203', '预收账款', 'liability', 360, 'active', '小企业会计准则附录：会计科目'),
('2211', '应付职工薪酬', 'liability', 370, 'active', '小企业会计准则附录：会计科目'),
('2221', '应交税费', 'liability', 380, 'active', '小企业会计准则附录：会计科目'),
('2231', '应付利息', 'liability', 390, 'active', '小企业会计准则附录：会计科目'),
('2232', '应付利润', 'liability', 400, 'active', '小企业会计准则附录：会计科目'),
('2241', '其他应付款', 'liability', 410, 'active', '小企业会计准则附录：会计科目'),
('2401', '递延收益', 'liability', 420, 'active', '小企业会计准则附录：会计科目'),
('2501', '长期借款', 'liability', 430, 'active', '小企业会计准则附录：会计科目'),
('2701', '长期应付款', 'liability', 440, 'active', '小企业会计准则附录：会计科目'),
('3001', '实收资本', 'equity', 450, 'active', '小企业会计准则附录：会计科目'),
('3002', '资本公积', 'equity', 460, 'active', '小企业会计准则附录：会计科目'),
('3101', '盈余公积', 'equity', 470, 'active', '小企业会计准则附录：会计科目'),
('3103', '本年利润', 'equity', 480, 'active', '小企业会计准则附录：会计科目'),
('3104', '利润分配', 'equity', 490, 'active', '小企业会计准则附录：会计科目'),
('4001', '生产成本', 'cost', 500, 'active', '小企业会计准则附录：会计科目'),
('4101', '制造费用', 'cost', 510, 'active', '小企业会计准则附录：会计科目'),
('4301', '研发支出', 'cost', 520, 'active', '小企业会计准则附录：会计科目'),
('4401', '工程施工', 'cost', 530, 'active', '小企业会计准则附录：会计科目'),
('4403', '机械作业', 'cost', 540, 'active', '小企业会计准则附录：会计科目'),
('5001', '主营业务收入', 'profit_loss', 550, 'active', '小企业会计准则附录：会计科目'),
('5051', '其他业务收入', 'profit_loss', 560, 'active', '小企业会计准则附录：会计科目'),
('5111', '投资收益', 'profit_loss', 570, 'active', '小企业会计准则附录：会计科目'),
('5301', '营业外收入', 'profit_loss', 580, 'active', '小企业会计准则附录：会计科目'),
('5401', '主营业务成本', 'profit_loss', 590, 'active', '小企业会计准则附录：会计科目'),
('5402', '其他业务成本', 'profit_loss', 600, 'active', '小企业会计准则附录：会计科目'),
('5403', '营业税金及附加', 'profit_loss', 610, 'active', '小企业会计准则附录：会计科目'),
('5601', '销售费用', 'profit_loss', 620, 'active', '小企业会计准则附录：会计科目'),
('5602', '管理费用', 'profit_loss', 630, 'active', '小企业会计准则附录：会计科目'),
('5603', '财务费用', 'profit_loss', 640, 'active', '小企业会计准则附录：会计科目'),
('5711', '营业外支出', 'profit_loss', 650, 'active', '小企业会计准则附录：会计科目'),
('5801', '所得税费用', 'profit_loss', 660, 'active', '小企业会计准则附录：会计科目')
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    subject_type = VALUES(subject_type),
    sort_no = VALUES(sort_no),
    status = VALUES(status),
    remark = VALUES(remark),
    updated_at = CURRENT_TIMESTAMP;

UPDATE finance_income_type
SET default_subject_id = (SELECT id FROM finance_subject WHERE code = '5001'),
    updated_at = CURRENT_TIMESTAMP
WHERE code IN ('full_payment', 'advance', 'first_payment', 'milestone', 'acceptance', 'retention', 'maintenance');

UPDATE finance_income_type
SET default_subject_id = (SELECT id FROM finance_subject WHERE code = '5111'),
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'interest';

UPDATE finance_income_type
SET default_subject_id = (SELECT id FROM finance_subject WHERE code = '5301'),
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'subsidy';

UPDATE finance_income_type
SET default_subject_id = (SELECT id FROM finance_subject WHERE code = '5051'),
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'other';

UPDATE finance_expense_type
SET default_subject_id = (SELECT id FROM finance_subject WHERE code = '5602'),
    updated_at = CURRENT_TIMESTAMP
WHERE code IN ('travel', 'office');

UPDATE finance_expense_type
SET default_subject_id = (SELECT id FROM finance_subject WHERE code = '5601'),
    updated_at = CURRENT_TIMESTAMP
WHERE code IN ('entertainment', 'sales_fee');

UPDATE finance_expense_type
SET default_subject_id = (SELECT id FROM finance_subject WHERE code = '5401'),
    updated_at = CURRENT_TIMESTAMP
WHERE code IN ('project_purchase', 'outsourcing', 'refund');

UPDATE finance_expense_type
SET default_subject_id = (SELECT id FROM finance_subject WHERE code = '5403'),
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'tax_fee';

UPDATE finance_expense_type
SET default_subject_id = (SELECT id FROM finance_subject WHERE code = '5603'),
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'bank_charge';

UPDATE finance_expense_type
SET default_subject_id = (SELECT id FROM finance_subject WHERE code = '5711'),
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'other';

UPDATE finance_subject
SET status = 'inactive',
    sort_no = CASE
        WHEN sort_no < 100000 THEN sort_no + 100000
        ELSE sort_no
    END,
    remark = CASE
        WHEN remark LIKE '%已由小企业会计准则标准科目替代%' THEN remark
        ELSE CONCAT(COALESCE(NULLIF(remark, ''), '历史经营分类科目'), '；已由小企业会计准则标准科目替代')
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE code IN (
    'income_contract',
    'income_non_contract',
    'expense_project',
    'expense_sales',
    'expense_admin',
    'expense_finance',
    'asset_bank'
);

COMMIT;

-- Verification queries:
-- SELECT subject_type, COUNT(*) AS total
-- FROM finance_subject
-- WHERE remark = '小企业会计准则附录：会计科目'
-- GROUP BY subject_type
-- ORDER BY FIELD(subject_type, 'asset', 'liability', 'equity', 'cost', 'profit_loss');
--
-- SELECT code, name, status
-- FROM finance_subject
-- WHERE code IN ('income_contract', 'income_non_contract', 'expense_project', 'expense_sales', 'expense_admin', 'expense_finance', 'asset_bank');

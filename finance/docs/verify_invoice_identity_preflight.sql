-- FIN-02 只读概况；在明确目标 tenant/environment 的 Finance schema 内执行。
-- 不输出原始票号或个人信息；未确认唯一键前，不据此删除数据或添加 UNIQUE。
SELECT COUNT(*) AS invoice_rows,
       SUM(invoice_no IS NULL OR TRIM(invoice_no) = '') AS missing_invoice_number_rows,
       SUM(deleted_at IS NOT NULL) AS soft_deleted_rows,
       SUM(status IN ('red_reversed', 'canceled')) AS reversed_or_canceled_rows
FROM finance_invoice;

-- 此处按归一化号码统计风险，不断言不同票种/代码的同号都是业务重复。
SELECT COUNT(*) AS duplicate_number_groups,
       COALESCE(SUM(number_rows), 0) AS affected_rows
FROM (
    SELECT COUNT(*) AS number_rows
    FROM finance_invoice
    WHERE invoice_no IS NOT NULL AND TRIM(invoice_no) <> ''
    GROUP BY TRIM(invoice_no)
    HAVING COUNT(*) > 1
) duplicate_numbers;

-- 作废、红冲和软删除一起盘点，避免只查有效票遗漏唯一占用冲突。
SELECT invoice_type, invoice_medium, status,
       COUNT(*) AS invoice_rows,
       SUM(invoice_no IS NULL OR TRIM(invoice_no) = '') AS missing_invoice_number_rows
FROM finance_invoice
GROUP BY invoice_type, invoice_medium, status;

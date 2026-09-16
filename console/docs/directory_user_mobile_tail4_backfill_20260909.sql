-- Console Directory: 回填 directory_users / directory_identities 的手机尾号
--
-- 背景：People 员工生命周期投影（applyConsoleEmploymentTx）此前只写入
-- directory_users.mobile，未写 mobile_tail4，导致 Console 员工目录「手机尾号」列为空。
-- 代码已修复（data-runtime/internal/apps/directory/console_lifecycle.go），
-- 但存量行的 snapshot_hash 不变不会重新投影，需要本脚本一次性回填。
--
-- 执行前先跑「诊断」段确认缺口分布，再执行「回填」段。回填幂等，可重复执行。

-- ============ 诊断 ============
-- 1) Console 侧缺口：有手机号但尾号为空 = 本次可直接回填；两者都空 = 需要 People 侧补数据
SELECT
  COUNT(*)                                                                AS total,
  SUM(mobile IS NOT NULL AND mobile <> '')                                AS has_mobile,
  SUM(mobile_tail4 IS NOT NULL AND mobile_tail4 <> '')                    AS has_tail4,
  SUM(mobile IS NOT NULL AND mobile <> ''
      AND (mobile_tail4 IS NULL OR mobile_tail4 = ''))                    AS fixable_by_backfill,
  SUM((mobile IS NULL OR mobile = '')
      AND (mobile_tail4 IS NULL OR mobile_tail4 = ''))                    AS missing_mobile
FROM directory_users
WHERE status <> 'deleted' AND user_type = 'employee';

-- 2) directory_identities（钉钉身份）同口径缺口
SELECT COUNT(*) AS total,
       SUM(mobile_tail4 IS NULL OR mobile_tail4 = '') AS missing_tail4
FROM directory_identities
WHERE provider_code = 'dingtalk' AND status = 'active';

-- ============ 回填 ============
UPDATE directory_users
SET mobile_tail4 = RIGHT(mobile, 4),
    updated_at   = UTC_TIMESTAMP()
WHERE mobile IS NOT NULL AND mobile <> ''
  AND (mobile_tail4 IS NULL OR mobile_tail4 = '');

UPDATE directory_identities identities
INNER JOIN directory_users users ON users.uid = identities.uid
SET identities.mobile_tail4 = RIGHT(users.mobile, 4),
    identities.updated_at   = UTC_TIMESTAMP()
WHERE users.mobile IS NOT NULL AND users.mobile <> ''
  AND (identities.mobile_tail4 IS NULL OR identities.mobile_tail4 = '')
  AND identities.status <> 'deleted';

-- ============ 验证 ============
SELECT COUNT(*) AS still_missing_tail4
FROM directory_users
WHERE status <> 'deleted' AND user_type = 'employee'
  AND mobile IS NOT NULL AND mobile <> ''
  AND (mobile_tail4 IS NULL OR mobile_tail4 = '');

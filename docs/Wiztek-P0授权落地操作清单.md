# Wiztek P0 授权落地操作清单（界面路径 + SQL 核对）

> 配套《Wiztek企业角色配置优化建议-2026-07》。按顺序执行；每步先做界面操作，再跑核对 SQL 确认。
> 执行身份：租户 owner 登录平台租户管理端。核对 SQL 连 `hzy_platform` 库，**全部只读**；仅步骤 2 含写 SQL（明确标注）。
> ⚠️ 所有改动在**步骤 6 bundle 重生成之前不会生效**，可放心分步操作、最后一次性下发。

## 通用核对语句（多步复用）

```sql
-- [A] 有效授权总览（注意：必须带过期过滤，否则会把已过期授权算进去）
SELECT s.subject_code, GROUP_CONCAT(tr.role_code ORDER BY tr.role_code SEPARATOR ', ') AS effective_roles
FROM tenant_subject_roles sr
JOIN tenant_subjects s ON s.id = sr.subject_id
JOIN tenant_roles tr ON tr.id = sr.role_id
WHERE sr.tenant_code = 'C000001' AND sr.status = 'active'
  AND (sr.starts_at IS NULL OR sr.starts_at <= NOW())
  AND (sr.expired_at IS NULL OR sr.expired_at > NOW())
GROUP BY s.subject_code ORDER BY s.subject_code;

-- [B] 某角色的应用角色映射
SELECT tr.role_code, tram.app_role_code FROM tenant_role_app_role_maps tram
JOIN tenant_roles tr ON tr.id = tram.role_id AND tr.tenant_code = tram.tenant_code
WHERE tram.tenant_code = 'C000001' ORDER BY tr.role_code, tram.app_role_code;
```

## 步骤 0：前置确认（已完成项）

- ✅ people 新 manifest 已导入生产（10 档角色、`people:admin` 含 approve，2026-07-07 核验）。
- ✅ codocs/altoc/assets/finance/workflow/aims/platform manifest 已导入（`codocs:records_manager`、`aims:pmo` 等可用）。
- ⏸ insights 暂不处理（按决定）。

## 步骤 1：物化 11 个企业角色模板

**界面**：租户管理端 → 角色管理 → 系统角色目录 → 逐个**启用**以下模板：

```
finance_accountant（财务会计）    finance_director（财务总监）
hr_specialist（人事专员）         sales_specialist（销售专员）
sales_manager（销售经理）         sales_director（销售总监）
commercial_director（商务总监）   department_manager（部门经理）
project_member（项目成员）        records_manager（档案管理员）
procurement_asset_manager（采购与资产管理员）
```

**核对**（应返回 17 行，全部模板已物化）：

```sql
SELECT role_code, role_name, is_overridden, status FROM tenant_roles
WHERE tenant_code = 'C000001' AND source = 'system'
  AND source_role_code IN (SELECT role_code FROM platform_system_roles WHERE status='active')
ORDER BY role_code;
```

## 步骤 2：模板映射调整（唯一含写操作的步骤）

目的：HR 分层、总监降权、档案管理员降级、总经理/副总补审批。**推荐改模板源**（platform_system_app_role_maps），bundle 重生成时会自动同步到所有未 override 的租户角色；不要在租户层单改（会置 overridden，之后模板更新不再自动同步）。

⚠️ 写 SQL，维护窗口执行；先备份：
```sql
-- 备份（只读，留存结果）
SELECT * FROM platform_system_app_role_maps ORDER BY system_role_code, app_role_code;
```

```sql
-- 2.1 hr_specialist：people:admin → people:specialist（专员=经办，不碰绩效确认/成本快照/职级）
UPDATE platform_system_app_role_maps m
JOIN platform_system_roles r ON r.id = m.system_role_id AND r.role_code = 'hr_specialist'
JOIN platform_app_roles ar ON ar.role_code = 'people:specialist' AND ar.status = 'active'
SET m.app_role_id = ar.id, m.app_role_code = ar.role_code
WHERE m.app_role_code = 'people:admin';

-- 2.2 project_director：aims:admin → aims:pmo（总监=组合管理+跨项目读+工时审批，应用配置归系统管理员）
UPDATE platform_system_app_role_maps m
JOIN platform_system_roles r ON r.id = m.system_role_id AND r.role_code = 'project_director'
JOIN platform_app_roles ar ON ar.role_code = 'aims:pmo' AND ar.status = 'active'
SET m.app_role_id = ar.id, m.app_role_code = ar.role_code
WHERE m.app_role_code = 'aims:admin';

-- 2.3 sales_director：altoc:admin → altoc:viewer（全量可见 + 已有 contract_approver 审批）
UPDATE platform_system_app_role_maps m
JOIN platform_system_roles r ON r.id = m.system_role_id AND r.role_code = 'sales_director'
JOIN platform_app_roles ar ON ar.role_code = 'altoc:viewer' AND ar.status = 'active'
SET m.app_role_id = ar.id, m.app_role_code = ar.role_code
WHERE m.app_role_code = 'altoc:admin';

-- 2.4 records_manager：codocs:admin → codocs:records_manager（档案治理，不含应用配置）
UPDATE platform_system_app_role_maps m
JOIN platform_system_roles r ON r.id = m.system_role_id AND r.role_code = 'records_manager'
JOIN platform_app_roles ar ON ar.role_code = 'codocs:records_manager' AND ar.status = 'active'
SET m.app_role_id = ar.id, m.app_role_code = ar.role_code
WHERE m.app_role_code = 'codocs:admin';

-- 2.5 总经理/副总补 workflow:approver + people:viewer（4 条 INSERT）
INSERT INTO platform_system_app_role_maps (system_role_id, system_role_code, app_role_id, app_role_code, sort_order, created_at)
SELECT r.id, r.role_code, ar.id, ar.role_code, 90, NOW()
FROM platform_system_roles r
JOIN platform_app_roles ar ON ar.role_code IN ('workflow:approver', 'people:viewer') AND ar.status = 'active'
WHERE r.role_code IN ('general_manager', 'deputy_general_manager')
  AND NOT EXISTS (
    SELECT 1 FROM platform_system_app_role_maps x
    WHERE x.system_role_id = r.id AND x.app_role_id = ar.id
  );
```

**核对**（每项一查，应看到新映射、看不到旧映射）：

```sql
SELECT r.role_code, m.app_role_code FROM platform_system_app_role_maps m
JOIN platform_system_roles r ON r.id = m.system_role_id
WHERE r.role_code IN ('hr_specialist','project_director','sales_director','records_manager','general_manager','deputy_general_manager')
ORDER BY r.role_code, m.app_role_code;
```

补充（可选，二选一按公司习惯）：`hr_specialist` 不授予 Console 应用角色，业务页目录读取使用受限 service capability；`commercial_director` 若设商务助理岗则删除其 `altoc:contract_manager`（DELETE 同结构，建议设助理岗时再做）。

## 步骤 3：按岗授权

**界面**：角色管理 → 目标角色行 → **授权**按钮（即截图入口）→ 选用户。

当前 6 名用户的建议动作：

| 用户 | 动作 |
| --- | --- |
| zhouguangying | 测试期保留现状。注：**模拟不要求持有角色**——"企业角色编码"输入框可填任何有效角色，快捷标签只是你持有角色的前 6 个；正式运行前收敛为 general_manager + system_admin |
| caoqian / renjianwei | 保持 system_admin（+caoqian 的副总）；确认两位确实承担系统管理职责 |
| wangzhuang | 保持 project_director（映射降权后自动收窄，无需操作） |
| xuxueying | 保持 deputy_general_manager（补审批后自动增强） |
| test | 撤销 project_director（测试号不留高权限）；改授 project_member；顺手在授权页清理两条已过期记录（system_admin、console.directory_manager） |
| 业务人员（财务/销售/HR 入驻时） | 按建议文档 §2 岗位表授予对应模板角色 |

**核对**：跑通用语句 [A]，确认与预期一致。

## 步骤 4：迁移并停用 14 个重复旧角色

清单（7 应用 admin + 6 legacy 点号 + aims:dev）：

```
aims:admin  altoc:admin  assets:admin  codocs:admin  console:admin  finance:admin  workflow:admin
aims.admin  aims.member  aims.project_manager  console.admin  console.directory_manager  console.viewer
aims:dev
```

**先查有效持有人**（谁还挂着旧角色）：

```sql
SELECT tr.role_code, GROUP_CONCAT(s.subject_code) AS holders
FROM tenant_subject_roles sr
JOIN tenant_subjects s ON s.id = sr.subject_id
JOIN tenant_roles tr ON tr.id = sr.role_id
WHERE sr.tenant_code='C000001' AND sr.status='active'
  AND (sr.expired_at IS NULL OR sr.expired_at > NOW())
  AND (tr.role_code LIKE '%.%' OR tr.role_code IN
    ('aims:admin','altoc:admin','assets:admin','codocs:admin','console:admin','finance:admin','workflow:admin','aims:dev'))
GROUP BY tr.role_code;
```

按当前数据：持有人只有 zhouguangying（测试用，见步骤 3）和 test（aims:dev/aims.member/console.viewer → 由 project_member 替代）。

**界面**：先按步骤 3 给持有人补新角色 → 授权页逐个撤销旧角色 → 角色管理 → 编辑 → **停用**（或取消可分配）这 14 个角色。

**核对**（应为空）：

```sql
SELECT tr.role_code FROM tenant_roles tr
WHERE tr.tenant_code='C000001' AND tr.status='active'
  AND (tr.role_code LIKE '%.%' OR tr.role_code IN
    ('aims:admin','altoc:admin','assets:admin','codocs:admin','console:admin','finance:admin','workflow:admin','aims:dev'));
```

## 步骤 5：重新生成并下发 bundle

**界面**：租户管理端 → 策略包 → 生成/下发（或 ops 批量接口）。

**核对**：管理概览的 Policy Bundle 版本号应更新（大于 `pv_prod_20260707154451_0068`）；console 侧任一用户请求 `GET /api/auth/permissions?appCode=people`，hr_director 持有者的 `resources.performance_cycles` 应包含 `approve`。

## 步骤 6：逐岗模拟验收（用右上角"权限模拟"，无需持有角色）

| 模拟角色 | 预期看到 | 预期看不到/被拒 |
| --- | --- | --- |
| finance_accountant | 财务台账、发票/到账录入 | 报销审批按钮、Console 管理菜单 |
| finance_director | 财务报表、报销/付款审批 | （若未授 accountant）台账制单入口 |
| hr_specialist | 员工/任职编辑 | 绩效周期确认/关闭、成本快照、职级设置 |
| hr_director | 绩效确认/关闭、成本快照确认 | Console 系统设置 |
| sales_specialist | 客户/商机/报价编辑 | 合同审批 |
| sales_director | 全部客户/合同只读 + 合同审批 | altoc 应用配置（字典等） |
| project_member | 自己项目的工作项/工时 | 项目创建、工时审批 |
| project_director | 项目组合、跨项目只读、工时审批 | aims 应用配置 |
| department_manager | 费用/资产审批任务 | 财务台账明细 |
| general_manager | 8 应用概览 + 审批任务 | 一切 admin 配置入口 |

每行 1-2 分钟：启动模拟 → 走一遍对应应用首页/关键页 → 退出。发现越权或缺权，回步骤 2/3 调整后重新下发再验。

---

执行完毕后，把本清单和建议文档一起归档；P1（数据范围、冲突规则、4 个新模板、aims:qa）另行排期。

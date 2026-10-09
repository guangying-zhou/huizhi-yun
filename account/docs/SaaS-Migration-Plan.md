# 汇智云 SaaS 化改造方案

> 版本: v1.0 | 日期: 2026-03-25

## 一、改造目标

将汇智云从单租户部署模式改造为多租户 SaaS 平台，支持多家公司在同一平台上独立使用，同时为每家公司提供业务领域和区域的灵活配置能力。

## 二、核心架构决策

### 2.1 数据库隔离策略

采用 **共享 Account 库 + 业务库按企业分库** 的混合模式：

```
hzy_account              ← 共享库（身份认证、权限、公司、领域、区域）
hzy_c000001              ← 企业1 业务库（codocs / aims / workflow 等模块数据）
hzy_c000002              ← 企业2 业务库
...
```

| 维度 | Account 库 | 业务库 |
|------|-----------|--------|
| 隔离方式 | 逻辑隔离（company_code 字段） | 物理隔离（一企业一库） |
| 库名 | `hzy_account`（固定） | `hzy_` + company_code 小写（如 `hzy_c000001`） |
| 跨库查询 | 不需要 | 通过 API 调用 account 获取用户/权限 |
| 数据迁移 | 按 company_code 筛选导出 | 整库导出 |

**选择此方案的理由**：
- Account 共享库：用户认证、SSO、权限管理天然需要全局视角
- 业务库分库：数据量大、彼此隔离要求高，物理隔离最干净
- 业务库无需 company_code 字段，天然隔离，零改造成本

### 2.2 租户标识

- **编码格式**：`C` + 6位数字（前补零），如 `C000001`
- **字段名**：统一使用 `company_code VARCHAR(7)`
- **关联方式**：所有表通过 `company_code` 逻辑关联，不建外键（跨库兼容）
- **平台级数据**：`company_code = NULL` 表示系统级/平台级，所有公司共享

### 2.3 用户体系

双轨并行，统一在 `system_users` 管理：

```
LDAP 用户 ──────→ system_users (uid 有值, platform_user_id = NULL)
                         ↕ 统一权限/角色/部门
平台注册用户 ──→ platform_users ──→ system_users (platform_user_id 有值)
```

| 用户来源 | 认证方式 | 身份标识 | 适用场景 |
|---------|---------|---------|---------|
| LDAP | CAS SSO | uid | 企业内部私有化部署 |
| 平台注册 | 用户名密码/手机/邮箱 | platform_user_id | SaaS 开放注册 |

## 三、数据库变更清单

### 3.1 新建表（6 + 1 张）

| 表名 | 用途 | 数据归属 |
|------|------|---------|
| `companies` | 公司（租户）主表 | 平台级 |
| `platform_users` | 平台注册用户 | 平台级 |
| `business_domains` | 业务领域字典 | 系统预置 |
| `company_business_domains` | 公司已选/自建领域 | 公司级 |
| `company_regions` | 公司自定义区域 | 公司级 |
| `company_region_divisions` | 区域与行政区划映射 | 公司级 |
| `region_templates` | 区域模板（供初始化复制） | 系统预置 |

> **行政区划数据**：不建表，由前端 npm 包 `lcn` 提供（离线内嵌，无需联网）。数据库仅存储 6 位国标行政区划编码，展示名称由前端查询 `lcn` 获取。

### 3.2 改造表（8 张加 company_code）

| 表名 | 新增字段 | NULL 含义 |
|------|---------|----------|
| `system_users` | `company_code` + `platform_user_id` | — |
| `departments` | `company_code` | — |
| `roles` | `company_code` | 系统内置角色 |
| `applications` | `company_code` | 平台级应用 |
| `git_projects` | `company_code` | — |
| `api_keys` | `company_code` | — |
| `ai_providers` | `company_code` | 平台默认配置 |
| `ai_quotas` | `company_code` | — |

### 3.3 未改造表（本次不动）

| 表名 | 原因 |
|------|------|
| `user_departments` | 通过 uid → system_users → company_code 间接隔离 |
| `user_roles` | 同上 |
| `user_status_cache` | LDAP 缓存，随 system_users 隔离 |
| `git_project_members` | 通过 project_code → git_projects → company_code 间接隔离 |
| `role_permissions` | 通过 role_id → roles → company_code 间接隔离 |
| `resources` | 通过 app_id → applications → company_code 间接隔离 |
| `app_access_rules` | 同上 |
| `login_logs` / `api_logs` / `operation_logs` | 日志表，后续可按需加 |
| `user_sessions` / `oauth_tokens` | 会话表，通过 uid 间接隔离 |
| `user_heartbeats` | 通过 uid 间接隔离 |
| `system_configs` | 后续按需支持公司级配置覆盖 |
| `ai_usage_logs` | 日志表，后续按需加 |

## 四、业务领域设计

### 4.1 两级结构

```
大类 (category)          子领域 (parent_code → 大类)
├── 2G 政务领域          ├── 自然资源、住建、农业农村、行政审批...（系统预置 16 项）
├── 2B 企业领域          ├── 农林牧渔、采矿、制造...（GB/T 4754-2017 一级门类 20 项）
└── 2C 个人领域          └── 教育培训、医疗健康、电子商务...（系统预置 8 项）
```

### 4.2 使用流程

```
business_domains (系统字典)          company_business_domains (公司数据)
┌─────────────────────┐            ┌──────────────────────────────┐
│ GOV_NR 自然资源      │──勾选──→  │ C000001, GOV_NR, source=preset│
│ GOV_HC 住建          │──勾选──→  │ C000001, GOV_HC, alias=住建城建│
│ BIZ_I  信息技术      │──勾选──→  │ C000001, BIZ_I, source=preset │
│ ...                  │           │ C000001, MY_01, source=custom │←─自建
└─────────────────────┘            └──────────────────────────────┘
```

- **从字典选**：前端展示字典列表，勾选后插入 `company_business_domains`，`source='preset'`
- **自建**：用户填写编码/名称/大类，`source='custom'`，直接存入公司表
- **别名**：勾选的领域可设 `alias_name`，系统展示时优先取别名
- **排序**：通过 `sort_order` 控制列表顺序
- **其他模块引用**：项目、合同等选择领域时，只从 `company_business_domains` 中选

### 4.3 自建领域的 domain_code 规则

- 系统预置：按分类前缀（`GOV_`/`BIZ_`/`CON_`）
- 公司自建：建议前端生成 `CUS_` 前缀 + 自增编号（如 `CUS_001`），或允许用户自定义
- 唯一约束：`(company_code, domain_code)` 联合唯一，不同公司可有相同编码

## 五、区域设计

### 5.1 两层结构

行政区划数据由前端 npm 包 `lcn` 提供（离线内嵌，约 120KB），数据库只存 6 位国标编码。

```
lcn (前端npm包,离线)           company_regions (公司区域)    company_region_divisions (映射)
┌──────────────────┐         ┌───────────────────┐        ┌─────────────────────────┐
│ 110000 北京市     │         │ NORTH_CHINA 华北   │        │ 华北 ← 110000 (含下级)  │
│ 120000 天津市     │         │ NORTH    北方大区  │        │ 华北 ← 120000 (含下级)  │
│ 130000 河北省     │         │ CUSTOM_1 长三角    │        │ 北方大区 ← 华北全部     │
│ 130100  石家庄市  │         └───────────────────┘        │ 北方大区 ← 210100 沈阳  │
│ 130200  唐山市    │                                      └─────────────────────────┘
│ ...（~3200条）    │
└──────────────────┘
```

### 5.2 区域初始化流程

新公司注册后，系统提供两个选项：

1. **采用标准方案**：从 `region_templates`（模板 `STANDARD_7`）复制到公司的 `company_regions` + `company_region_divisions`
2. **自行定义**：从空白开始，手动创建区域并关联行政区划

### 5.3 前端交互设计建议

**区域编辑页面**：

```
┌─ 北方大区 ────────────────────────────────────┐
│                                                │
│  已包含的区划：                                 │
│  ☑ 北京市 (含全部下级)                          │
│  ☑ 天津市 (含全部下级)                          │
│  ☑ 河北省 (含全部下级)                          │
│  ☑ 山西省 (含全部下级)                          │
│  ☑ 内蒙古自治区 (含全部下级)                    │
│  ☑ 沈阳市 (仅本级及下级)     ← 从东北单独加入   │
│  ☑ 大连市 (仅本级及下级)     ← 从东北单独加入   │
│                                                │
│  [+ 添加区划]                                   │
└────────────────────────────────────────────────┘
```

- 添加区划时弹出行政区划树（省→市→区县），可多选
- 每项可切换"含全部下级"/"仅本级"
- 前端实现排除法：如"河北省全选但去掉张家口"，前端自动转为河北省下除张家口外的各市分别添加

### 5.4 查询区域包含的最终区划

后端返回映射规则，前端利用 `lcn` 展开完整列表：

```sql
-- 后端：获取该区域的映射规则
SELECT division_code, include_children
FROM company_region_divisions
WHERE company_code = ? AND region_code = ?;
```

```typescript
// 前端：利用 lcn 展开子区划
import { getChildren } from 'lcn'

// 对 include_children=1 的记录，用 lcn 递归获取下级区划
// 合并去重，得到完整区划列表
```

## 六、连接路由设计

### 6.1 Account 库（共享）

```typescript
// server/utils/db.ts —— 现有连接池不变
const accountPool = createPool({
  database: 'hzy_account'
})
```

### 6.2 业务库（按企业动态路由）

```typescript
// server/utils/tenantDb.ts —— 新增
const tenantPools = new Map<string, Pool>()

function getTenantPool(companyCode: string): Pool {
  const dbName = `hzy_${companyCode.toLowerCase()}`
  if (!tenantPools.has(companyCode)) {
    tenantPools.set(companyCode, createPool({
      ...baseConfig,
      database: dbName
    }))
  }
  return tenantPools.get(companyCode)!
}
```

### 6.3 请求上下文传递

```
用户请求 → 认证中间件 → 解析 company_code → 注入上下文
                                    ↓
                    Account 查询用 accountPool
                    业务查询用 getTenantPool(company_code)
```

## 七、实施路线图

### 第一阶段：基础设施（本次）

- [x] 设计方案确认
- [x] 执行数据库迁移脚本 `saas_migration_v1.sql`
- [x] 前端安装 `lcn` 包（行政区划数据，离线内嵌）
- [x] 开发公司管理 CRUD API
- [x] 开发业务领域管理 API（字典查询 + 公司领域 CRUD）
- [x] 开发区域管理 API（区域 CRUD + 行政区划关联 + 模板初始化）
- [x] 开发平台用户注册/登录 API
- [ ] 开放跨模块查询 API（供 codocs/aims/workflow 等模块调用）
  - [ ] `GET /api/v1/companies/:companyCode` — 查询公司基本信息
  - [ ] `GET /api/v1/companies/:companyCode/business-domains` — 查询公司已选业务领域列表
  - [ ] `GET /api/v1/companies/:companyCode/regions` — 查询公司区域列表
  - [ ] `GET /api/v1/companies/:companyCode/regions/:regionCode/divisions` — 查询区域下的行政区划编码
- [x] 前端：公司信息设置页
- [x] 前端：业务领域配置页（字典勾选 + 自建 + 别名 + 排序）
- [x] 前端：区域配置页（区域管理 + lcn 行政区划树选择）

### 第二阶段：多租户隔离

- [ ] 现有 API 全部加 company_code 过滤
- [ ] 认证中间件注入 company_code 上下文
- [ ] 业务库分库路由（tenantDb.ts）
- [ ] codocs / aims / workflow 模块适配分库
- [ ] 新公司注册自动初始化流程（创建业务库 + 复制区域模板）

### 第三阶段：SaaS 运营

- [ ] 公司（租户）生命周期管理（注册→审核→激活→冻结→注销）
- [ ] 计费与套餐体系
- [ ] 租户数据备份与恢复
- [ ] 租户管理后台（平台运营视角）
- [ ] 数据迁移工具（单租户 → 多租户）

## 八、数据迁移策略

### 现有数据处理

迁移脚本已包含回填逻辑：
1. 创建默认公司 `C000001`
2. 所有现有用户、部门、项目等回填 `company_code = 'C000001'`
3. 系统内置角色保持 `company_code = NULL`
4. 平台级应用、AI 提供商保持 `company_code = NULL`

### 新公司初始化 Checklist

1. 在 `companies` 表插入新公司记录
2. 创建业务库 `hzy_cXXXXXX`，执行各模块建表脚本
3. （可选）从 `region_templates` 复制标准大区到 `company_regions` + `company_region_divisions`
4. 创建公司管理员账号（`platform_users` + `system_users` + 管理员角色）

## 九、文件清单

| 文件 | 说明 |
|------|------|
| `account/docs/saas_migration_v1.sql` | 迁移脚本（ALTER + CREATE + 预置数据） |
| `account/docs/SaaS-Migration-Plan.md` | 本方案文档 |
| `account/docs/account_schema.sql` | 更新后的完整 DDL（v3.0） |

> 行政区划数据不再需要数据库导入，由前端 npm 包 `lcn` 提供。

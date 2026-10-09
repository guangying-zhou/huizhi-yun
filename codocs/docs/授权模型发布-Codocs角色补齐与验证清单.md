# 授权模型发布 — Codocs 角色补齐与验证清单

> 配套《Huizhi-yun角色授权模型改进实施方案》本轮发布使用。
> 适用对象：已上线 codocs 的生产/共享测试租户。
> 生成日期：2026-07-02。执行完毕后本清单可归档或删除。

## 1. 权限生效机制（为什么需要本清单）

经代码核实的三个事实（platform 仓）：

1. **manifest 导入是破坏性重写**：导入新 codocs release 时，`appManifestRoles.ts` 对每个应用角色执行 `DELETE FROM platform_app_role_permissions` 后按新 manifest 重新 INSERT。
2. **bundle 动态展开应用角色**：`policyBundle.ts` 生成 bundle 时实时 JOIN `tenant_role_app_role_maps × platform_app_roles × platform_app_role_permissions`。
3. **因此**：`导入新 manifest + 任意一次 bundle 重生成` = 角色变化对**所有映射了 codocs 应用角色的租户立即生效**——增益（admin 补 `documents:delete`/`projects:export`）与收窄（editor 失去 `documents:export`/`company:edit`）同时发生，**不需要**租户逐个"重新接受角色"。
   仅通过 `tenant_role_permissions`（`app_code='codocs'` 直连权限）授权的租户角色**不随 manifest 变化**，需单独补齐（见 §4.3）。

本次 codocs 新增服务端守卫与线上角色数据的缺口：

| 功能 | 新守卫要求 | 旧 manifest 下持有者 | 新 manifest 导入后 |
| --- | --- | --- | --- |
| `DELETE /api/documents/:uuid`（删除文档） | `documents:delete` | 无人 | `codocs:admin` 自动获得 |
| git 项目仓库文档预览（repos.vue → download-content） | `projects:export` | 无人 | `codocs:admin` / `codocs:records_manager` |
| 文档下载 / download-content | `documents:export` | editor / admin | editor **失去**；admin / records_manager 持有 |
| 组织资产编辑 | `company:edit` | editor | editor **失去**；space_admin(`company:admin`) / admin |

## 2. 发布顺序（硬约束，先于本清单执行）

1. data-runtime（Go，向后兼容）
2. console + notification-runtime + 业务应用（codocs、workflow 等同批，均含新 foundation）
3. 验证：console 正常解析现有 v1 bundle；codocs 登录、权限快照正常
4. **最后** platform
5. ⚠️ console 升级完成前**禁止**任何 bundle 重生成（改角色/订阅、手动刷新都会触发）：老 console 只读 v1 字段且不校验 schemaVersion，遇 v2 bundle 会**静默解析出空权限（全租户失权）**

## 3. 发布前核对（只读 SQL，hzy_platform 库）

### 3.1 哪些租户映射了 codocs 应用角色（影响面总览）

```sql
SELECT tram.tenant_code, r.role_code, r.role_name, tram.app_role_code
FROM tenant_role_app_role_maps tram
JOIN tenant_roles r ON r.id = tram.role_id AND r.tenant_code = tram.tenant_code
WHERE tram.app_role_code LIKE 'codocs:%' AND r.status = 'active'
ORDER BY tram.tenant_code, r.role_code;
```

### 3.2 editor 收窄影响到的活跃主体（发布沟通名单）

```sql
SELECT sr.tenant_code, s.subject_type, s.subject_code, r.role_code AS enterprise_role
FROM tenant_subject_roles sr
JOIN tenant_subjects s ON s.id = sr.subject_id
JOIN tenant_roles r ON r.id = sr.role_id
JOIN tenant_role_app_role_maps tram
  ON tram.role_id = r.id AND tram.tenant_code = r.tenant_code
WHERE tram.app_role_code = 'codocs:editor'
  AND sr.status = 'active'
  AND (sr.starts_at IS NULL OR sr.starts_at <= NOW())
  AND (sr.expired_at IS NULL OR sr.expired_at > NOW())
ORDER BY sr.tenant_code, s.subject_code;
```

这批人在 manifest 导入 + bundle 重生成后将失去"文档下载 / 导出"。其中确需下载能力的人，其企业角色要补映射 `codocs:records_manager`（§4.2）。

### 3.3 直连权限租户（manifest 重写不影响，需单独比对）

```sql
SELECT p.tenant_code, r.role_code, p.resource_code, p.action
FROM tenant_role_permissions p
JOIN tenant_roles r ON r.id = p.role_id
WHERE p.app_code = 'codocs'
ORDER BY p.tenant_code, r.role_code, p.resource_code, p.action;
```

结果非空的租户：对照 §1 表格逐条决定是否补 `documents:delete` / `projects:export`（§4.3）。

### 3.4 当前 platform 侧 codocs 应用角色权限快照（导入前后各跑一次留档）

```sql
SELECT ar.role_code, arp.resource_code, arp.action
FROM platform_app_roles ar
JOIN platform_app_role_permissions arp ON arp.app_role_id = ar.id
WHERE ar.app_code = 'codocs' AND ar.status = 'active'
ORDER BY ar.role_code, arp.resource_code, arp.action;
```

## 4. 发布后补齐动作（按序）

### 4.1 导入新 codocs release 并验证

1. 按常规流程导入 GitLab release/tag（App Registry）。
2. 重跑 §3.4：确认 `codocs:records_manager`、`codocs:space_admin` 出现；`codocs:admin` 集合含 `documents:delete`、`projects:export`；`codocs:editor` 已不含 `documents:export`、`company:edit`。

### 4.2 给需要下载/导出能力的企业角色补映射 records_manager

**优先走租户管理端**（角色管理 → 应用角色），或 API：

```
PUT /api/platform/tenant-admin/roles/{roleId}/app-roles?tenantCode=<tenantCode>
body: { "appRoles": [ ...现有映射, "codocs:records_manager" ] }
```

（`appRoles` 数组元素接受字符串或 `{ "appRoleCode": "..." }`；提交的是**全量替换**，务必带上该角色现有映射。）

该 API 校验 `platform_app_roles` 并自动 `refreshTenantRolePolicySnapshot`（policy_revision 递增）。**不要**直接 INSERT `tenant_role_app_role_maps`——绕过快照刷新会导致 bundle 判新失效。

### 4.3 直连权限租户补齐（仅 §3.3 有结果时）

同样优先走租户管理端逐角色编辑。确需 SQL 兜底时（低频、留档审计）：

```sql
-- 以补 documents:delete 为例；resource_code/action 按需替换
INSERT INTO tenant_role_permissions
  (tenant_code, role_id, app_code, resource_code, action, source_manifest_action_id, created_at)
SELECT r.tenant_code, r.id, 'codocs', 'documents', 'delete', mra.id, NOW()
FROM tenant_roles r
JOIN platform_applications pa ON pa.app_code = 'codocs'
JOIN platform_app_manifest_resource_actions mra
  ON mra.app_code = 'codocs' AND mra.manifest_id = pa.latest_manifest_id
 AND mra.resource_code = 'documents' AND mra.action = 'delete' AND mra.status = 'active'
WHERE r.tenant_code = :tenant_code AND r.role_code = :role_code AND r.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM tenant_role_permissions x
    WHERE x.role_id = r.id AND x.app_code = 'codocs'
      AND x.resource_code = 'documents' AND x.action = 'delete'
  );
```

SQL 直写后必须对该角色触发一次快照刷新（在管理端随便保存一次该角色，或调用 4.2 的 API 原样提交现有映射）。

### 4.4 触发 bundle 重生成并验证

1. 逐租户 `POST /api/platform/tenant-admin/bundles`（或 ops 批量接口）。
2. 验证新 bundle：`schemaVersion = 'policy-bundle.v2'`、含 `roleAssignments` / `rolePermissionGrants` 等 v2 字段；console 侧权限快照 `bundleVersion` 已更新。
3. 确认此时 console 已是新版本（双读 v2）。

### 4.5 用户沟通

- editor（§3.2 名单）：告知"下载/导出"能力拆分至档案管理员角色，提供申请路径。
- 管理员：删除文档、git 仓库预览恢复可用。

## 5. 回归验证清单（codocs 生产冒烟）

- 管理员：删除文档、图片清理、YJS 清理、资讯删除、资讯同步
- 编辑者：新建/编辑/分享文档、个人/部门文件柜上传与转正文、发布申请提交 + 审批全链路（走 workflow → data-runtime）
- records_manager：文档下载、部门/公司资产导出 DOCX、git 仓库文档预览
- 查看者：文档列表/预览、头像显示、**历史文档内嵌图片显示**（配合 OSS 路径兼容扫描：`scripts/scan-oss-path-compat.mjs`）
- 跨应用：Aims 内嵌 codocs 编辑器、Aims 侧 codocs 内容代理（需携带 projectId）、Altoc `ops-knowledge/link`

## 6. 回滚要点

- **platform 回滚**：重新生成的 bundle 回到 v1；新 console 双读 v1，无害。
- **codocs 守卫不随 platform 回滚消失**：`documents:delete` / `projects:export` 403 只能靠回滚 codocs 应用本身，或先按 §4.3 临时补直连权限。
- **editor 收窄回退**：重新导入旧 manifest（会再次重写 `platform_app_role_permissions`）+ bundle 重生成；或临时给相关企业角色补直连 `documents:export`。

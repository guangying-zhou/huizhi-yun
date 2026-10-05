# Enterprise 项目页签读取与编辑发现

适用于 Host 用户委托 U 通道；没有新增 Runtime operation、capability、grant 或角色。独立 Aims 通道及所有既有写入职责门槛不变。

## 签名输入与权威事实

现有 `aims.project-view` 和各嵌套读取使用 projects:view permit；可携带 `managementAuthorization`：固定 `resource=projects/action=edit`、Foundation 编译的 scope、bundleVersion/bundleHash/policyRevision、≤15 秒 expiresAt。该字段在原 U 命令签名内，actor/tenant/deployment/project 由外围用户委托与项目 permit 绑定；不能从浏览器 query/body 提供事实。

Foundation 唯一 evaluator 按合并 grants/actionPolicy 编译 edit 范围（包含同资源 admin 蕴含）；view 不提升为管理。Runtime 对当前项目/部门/树/关系事实求值，不使用 company 公开读取例外计算管理覆盖。当前成员=active member 或 leader，当前经理=leader 或 active manager 成员；任一项目经理查询权威项目/member 行，uid 使用 BINARY 精确比较。

项目详情的 `projectTabAccess` 为 `{member, manager, management, anyProjectManager}`，只用于发现；实际 API 每请求重新求值。编辑入口使用 `canEditProject`（scoped edit/admin OR 当前项目经理），授权发现依赖失败只隐藏编辑入口，不影响概览读取。其余受限入口在管理投影/依赖不可用时失败关闭。

## 页签合同

所有页签先满足目标项目可见性和现有人员资源许可。

| 页签 | 读取 |
|---|---|
| 概览/里程碑/成员/成果/版本 | 项目可见的非成员可只读；写入职责不变 |
| 文档 | 原项目范围 + 独立 Codocs 文档 ACL，不改分享授权 |
| 看板/项目目标/需求/风险/度量 | 当前项目成员或覆盖当前项目的 scoped edit/admin |
| 工时 | 成员仅本人；当前项目经理或覆盖性管理可全部；其它项目经理不获得全部权限 |
| 周报 | 当前成员、任一项目经理或覆盖性管理；任一经理例外仅读，目标项目本身仍须可见 |
| 设置入口 | 当前项目经理或覆盖性管理；内部模块/访问控制等各写动作仍保留原合同 |

工时本人条件在列表 SQL COUNT/分页/汇总前加入，详情复核 entry.uid，客户端 uid 不能扩大集合。周报读许可不进入 draft/submit 写上下文。需求所有固定读取操作（规格/内容/版本/评审等）共用先于领域调用的页签门槛；签名的只读上下文只绑定已验证父项目，不传到写入口。

里程碑页使用的带 milestoneId 的项目工作项列表保留公开只读语义（仍绑定 owning project 和项目可见性）；不带里程碑约束的目标/看板列表执行成员/覆盖性管理门槛。Host 风险、度量目前为无业务 API 的占位页，按项目详情的 Runtime 事实隐藏并阻止直接页面访问，不新增通用读取能力。

## 错误与发现

- `403 project_tab_forbidden`：无页签读取关系/覆盖性管理。
- `403 project_timesheet_owner_required`：普通成员读取他人工时详情。
- `403 enterprise_project_permit_invalid`：伪造、跨对象/actor/tenant/deployment、过期或不合规签名 permit。
- `503 project_tab_authorization_unavailable`：管理范围/部门树事实缺失或不可用，不降级允许。

Host 侧栏与 ProjectNavbar 只消费服务端事实，受限直接页面使用 CommonEmptyState；同项目周期复核仍保留当前项目，失败后清除。发现缓存不取代 Runtime 每请求检查。

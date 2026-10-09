# Collab 的 Tenant Runtime 身份绑定

Collab 属于 `TENANT_RUNTIME_BINDING_APP_CODES`，不属于 `TENANT_RUNTIME_APPS`。它只有服务身份部署绑定，没有业务数据库或 schema adapter；登记初始化和心跳同步统一写入 `active / not_applicable`，并清除该绑定遗留的 schema 错误。Console 继续使用 `schema_ready / not_applicable`，Enterprise 使用 `active / not_applicable`，业务 adapter 的就绪检查不变。

正式登记的 Collab deployment 必须为 active，且 tenant、environment 与已认证 Runtime 实例精确一致。心跳只从正式部署表派生绑定，不接受请求指定 tenant/environment/deployment；同一应用存在多个 active 部署时沿用现有最大 deployment ID 规则。绑定回读同样过滤 active、tenant 和 environment。停用部署不回传。

已登记实例无需重新 enrollment 或轮换凭据。Platform 部署此修复后，下一次使用原 control token 的正常心跳会幂等补齐 Collab binding。回读应包含精确 Collab deployment code；Collab 即使没有 schema 报告，或请求携带 disabled/failed schema 信息，也不得进入 schema adapter 检查。Runtime 自身的数据库、密钥和 endpoint 健康检查仍独立生效。

此代码修复不新增 capability、grant、schema 或部署登记，不自动启用 Collab，也不签发策略。生产发布和实际环境验证由已授权的发布窗口执行。

回归使用生产 enrollment/helper 和 heartbeat handler，替换事务执行器为隔离内存夹具，覆盖登记后心跳、tenant/environment 隔离、停用部署、重复心跳、异常 Runtime、凭据不轮换和其他应用的就绪行为；没有连接实际数据库。

# ADR-017 阶段 1 身份与授权事实收口

更新：2026-09-27。保留临时审查记录中的结论，不包含私有 token、密钥、明文备份或 `.git` 下易丢回执原件。

F3-1～F3-5 将 issuer、当前凭据、audience/target、登记部署及 active auth client 的 aud/azp 校验收束到共享认证；F4-1 在 JTI/密钥副作用前确认共享 trust 事实。服务请求仍须精确 capability、current credential/grant、tenant/deployment 绑定，错 issuer/aud/azp/部署和共享事实冲突失败关闭。阶段 1 不迁移业务权限算法，不改变 Platform 策略治理。

2026-09-26 从已核验加密备份出发，按逐行 CAS 只迁移 93 条支持的 grant（Console 90、Codocs 2、Enterprise 1）的 audience/semanticScope；其余 JSON 字段、状态和其它行保持。三条无 audience 的排除项继续拒绝；兼容表清空而非删除。23/23 组合在部署后完成真实签发探测，跨 audience 403；途中 HTTP 0 超时未计作通过，单独补齐成功组合。源码 `cd8758f3`，本机 Runtime `0.3.248-test.adr017-audience-facts.1`，回执提交 `838ae10b`；全量 Go、race 和隔离 MySQL 通过。后续本机 Runtime 已升版，0.3.248 是该阶段证据版本而非当前运行版本。生产、其他租户及云端未由此获得通过结论。

未来修改共享认证仍应执行完整 trust、精确 scope、撤销、错 audience/source、部署冲突及 JTI 副作用顺序矩阵；不可把空兼容表重新用作宽 grant 回退。

# People 有界任务与整链验证

适用基线：APF-17a/b/c、18B1/B2（ab0e861b）及17d。本文不授权启用任务、执行grant或操作环境。LDAP/邮箱外部停用仍处于17c-ext合同裁定阶段，不计入已完成链路。

## 1. 唯一执行者与边界

统一机器入口为Gateway验签wake → Enterprise `/enterprise/api/internal/apf/scheduler-inspect`，body仅`domain=people`。Foundation `requireAPFWake`验证默认关闭开关、受信部署和scheduler generation；族级owner护栏和Runtime核对旧owner已关闭，Runtime再验证`people:scheduler:execute`及实时授权。用户的employees写入/replay不是机器wake，不能携用户令牌替代scheduler。

| 队列 | 单轮工作边界 | 确认与恢复 |
| --- | --- | --- |
| Directory lifecycle | prepare一页，Runtime最多100个候选；claim最多1件；15秒准备/25秒认领的开始检查 | 原operation/key/hash和fencing；目标receipt校验后ACK；租约恢复，不换意图 |
| 任职审批pending/bind | 每轮最多3件冻结命令 | 冻结actor和已审事务事实；原键创建Workflow，确认真实instance后bind；不制造浏览器批准 |
| handover-due、asset-recovery-due | 每族一次scan，最多40个待发布、20个关闭候选；共享20秒开始检查 | 精确responsible、资格核验、in_app；原eventKey/objectVersion发布与关闭 |
| People dead-letter | 最多3个发布、3个关闭；20秒开始检查 | 原operation generation，目标收件人回执、再ACK；不重新执行业务命令 |

时间预算是“停止启动下一项”的边界，不是取消正在进行的远端请求。需结合每跳timeout与Gateway CPU/壁钟预算测量；不能宣称严格25秒内返回。不同队列并行，Directory或Workflow故障不阻止其它已启动族执行；wake最终仍报告依赖503，不能把失败当成功。

不得新增第二个timer。生产cron频率、scheduler registry及环境开关由既有APF-18执行单审批；启用前核验双audience scheduler seed/verify制品和实际授权，先关闭旧owner后启用新owner。默认关闭及旧开关缺省不视为已退役。

## 2. 事实与回执的执行顺序

1. 正式人员写入/HR投影在caller-Tx锁内形成员工与任职事实并冻结Directory operation；中途失败一起回滚。未来生效任职只在到期prepare后投影。
2. 离职生效冻结Console禁用与Platform撤权，不等待交接或Assets归还。离职case及任务由正式安排动作分配明确责任人、期限，不能自动猜测。
3. Worker认领原命令，用Enterprise当前身份调用Console固定合同；不得转发入站token或伪造People来源。
4. 只有目标receipt的operation、schema、hash、key、bizType/bizCode全部匹配才ACK。Console确认与其后续Platform状态独立；Platform pending不是Directory失败。
5. 目标成功但源ACK失败：不调用fail。下一次租约恢复重投原键，由目标回执去重。重复ACK不能增加attempt；陈旧fencing不能完成新租约。
6. 到期通知只在责任人与资格有效时发布。任务完成、责任人变化或期限调整关闭原generation；发布效果未知时仅probe原键，未发现不等于成功或可安全新建。
7. terminal失败仅由全局integration_operations:view/replay人员操作恢复固定family；pending/processing/partial_unknown不得强制重排。先probe，保留原key/hash，不直接改SQL或强制成功。

## 3. 整链证据索引

以下均为隔离测试，不代表hzy0或生产已经验收。

| 断言 | 测试 |
| --- | --- |
| HR来源映射、冲突与不写供应商 | TestAPFPeopleHRSourceMySQL |
| 原意图开通、真实钉钉限定、阶段恢复 | TestAPFPeopleProvisioningC2MySQL；enterprise/test/people-c2.test.mjs |
| 离职case/责任安排、Assets未归还仍冻结安全撤权、最后完成 | TestAPFPeopleOffboardingMySQL |
| caller-Tx故障整笔回滚、并发CAS | TestAPFPeopleOffboardingRollbackAndConcurrentCASMySQL |
| 单件认领、两路fail仅一次、陈旧fencing拒绝、并发ACK重放 | TestAPFPeopleDirectoryDeliveryC2MySQL |
| 人工原键恢复、撤权、审计失败回滚 | TestAPFPeopleDirectoryRecoveryMySQL |
| 创建Workflow响应丢失后原键bind | TestAPF18PeopleAssignmentRecoveryMySQL |
| 两族任务通知、责任变更与原generation关闭 | TestAPFDueNotificationsMySQL（people）；enterprise/test/apf-due-notifications.test.mjs |
| 公平扫描、冻结事务回滚 | TestAPFDueFairCursorAndAtomicFreezeMySQL |
| 死信发布/关闭、恢复后的旧generation | TestAPFDeadLetterNotificationsMySQL；enterprise/test/apf-dead-letter-notifications.test.mjs |
| Worker预算、真实receipt校验、ACK丢失不fail | enterprise/test/people-bounded-chain.test.mjs |

执行隔离MySQL：`node data-runtime/scripts/test-apf-mysql.mjs`，使用临时目录/独立socket及`-race`。不能把该脚本指向真实库。TS：`pnpm --dir enterprise test`；其他模块回归按本次报告记录。

## 4. 环境启用与收尾门禁（仍需批准）

- 核对Runtime/Enterprise/Console版本配套、受信目录、租户/部署、统一库generation及必要安装子集；现有参数不得猜测。
- 核验`people:scheduler:execute`的data-runtime、tenant-runtime候选；通知发布、purpose读取及Console生命周期精确grant按各自seed/verify核验，不用U能力或宽scope代替。
- 记录旧owner关闭证据、在途原命令数量/key/hash，启用新owner后不能同时开启旧owner。
- 在批准的标记样本上观察一次策略同步与后台wake，回读权威员工/任职、operation/attempt、Console/Platform独立状态、Assets任务、通知/closure回执；记录延迟与重复数。
- manual候选开通保持失败关闭；LDAP/邮箱显示未支持/待裁定，不用内部撤权替代外部receipt。
- 回滚先关闭新owner，保留在途命令及回执，不删除历史、不换key；旧owner恢复必须先确认它能处理当前冻结协议，不能自动启动两套执行者。

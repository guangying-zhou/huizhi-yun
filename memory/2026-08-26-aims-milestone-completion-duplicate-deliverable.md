# DEBUG REPORT: AIMS 里程碑完成申请 409

- **Symptom:** 里程碑 134 在页面完整性检查通过后，`POST /api/v1/milestones/134/completion-requests` 返回 409。
- **Root cause:** 生产数据中有两个同名必交成果，一个已审核通过，一个仍为 `submitted / awaiting_review`。里程碑详情投影按名称合并时使用“任一实例通过即完成”的 OR 语义，而完成申请服务端正确检查每个必交实例，导致前端放行、服务端拒绝。
- **Fix:** 同名成果仍合并展示，但必交实例的完成与文档质量状态改为全部满足才通过；里程碑详情和项目里程碑列表共用同一合并逻辑。
- **Evidence:** 生产里程碑的工作项均为 `completed`，无完成申请锁；必交成果 214 为 `awaiting_review`且无评审记录。新回归测试在修复前失败，修复后通过；`go test ./...` 全量通过。
- **Regression test:** `data-runtime/internal/apps/aims/milestone_detail_test.go` 中 `TestMilestoneDeliverableStatesKeepsDuplicateRequiredNameBlocked`。
- **Related:** 该问题是详情投影与服务端治理规则漂移，不是 Workflow 集成、里程碑状态或残留锁。
- **Status:** DONE

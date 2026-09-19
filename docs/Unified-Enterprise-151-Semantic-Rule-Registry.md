# 152 表候选迁移语义登记清单

本清单逐一枚举当前候选代码闭包（Aims115、Assets37）。来源是既有150表源计划，加上尚未应用的project_activity_logs与work_item_completion_requests canonical/additive候选。文件名保留151以兼容既有文档链接；当前登记总数为152。没有读取业务库，也不是151/152表环境迁移回执；旧150表已激活回执及历史151候选隔离记录仍按当时范围保留。

每行列出全部可识别引用/JSON/快照/revision字段候选与所属语义类别。`待登记`不是无引用证明：应用SQL中的业务引用、JSON schema/version与外部引用仍需领域逐项补充。FK重写/孤儿检查与逐表hash是全表机械检查，hash不替代业务语义。未知且有数据的JSON字段由迁移器默认blocking；空字段仅证明本次没有待复制载荷，后续写入仍需规则。

已执行规则见unified semantic_audit/integrity_audit/receipt_target_audit/version_create_json_contract/version_mutation_json_contract；JSON登记开放aims.integration_operation.command_json（仅三种产品规划命令，其他family blocking）、aims.project_activity_logs.changes（仅member事件）及product_command_receipts.result_json/product_activity_logs.changes的version create/edit/transition配对快照（仅当前旧动作/字段形状；其他动作blocking）。所有未登记的snapshot、audit、receipt/outbox载荷及水位合同继续待处理，INT-202未完成。

| 表 | 引用/JSON/快照/revision字段候选 | 类别与规则状态 |
| --- | --- | --- |
| `aims.aims_contribution_snapshot_versions` | `cycle_code`, `project_code`, `snapshot_hash` | snapshot；逻辑/业务语义待登记 |
| `aims.aims_notification_checkpoint` | `source_id`, `dept_code`, `notification_id` | FK机械已映射, watermark；逻辑/业务语义待登记 |
| `aims.aims_project_members` | `project_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.aims_project_products` | `project_id`, `product_code`, `version_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.aims_project_repos` | `project_id`, `repo_project_code` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.aims_projects` | `project_code`, `internal_code`, `portfolio_id`, `domain_code`, `dept_code`, `opp_id`, `contract_id`, `customer_code`, `contract_code`, `service_line_code`, `workflow_instance_id`, `template_set_id`, `template_version_id` | FK机械已映射, JSON, audit；逻辑/业务语义待登记 |
| `aims.approval_records` | `project_owner_id`, `milestone_owner_id`, `work_item_owner_id`, `entity_code`, `snapshot_json`, `snapshot_sha256`, `reviewer_role_code`, `reviewer_role_revision`, `workflow_instance_id`, `project_id`, `project_code` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.company_weekly_summaries` | `period_id`, `current_version_id`, `draft_content_json` | FK机械已映射, JSON；逻辑/业务语义待登记 |
| `aims.company_weekly_summary_items` | `summary_version_id`, `obligation_id`, `report_version_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.company_weekly_summary_recipient_selections` | `summary_id`, `subject_code`, `subject_name_snapshot` | FK机械已映射, snapshot；逻辑/业务语义待登记 |
| `aims.company_weekly_summary_recipient_snapshots` | `summary_version_id`, `selection_id`, `display_name_snapshot`, `department_code_snapshot` | FK机械已映射, snapshot；逻辑/业务语义待登记 |
| `aims.company_weekly_summary_versions` | `summary_id`, `correction_of_version_id`, `structured_snapshot_json`, `structured_sha256`, `markdown_sha256`, `codocs_document_version_id` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.deliverable_quality_reviews` | `submission_id`, `checklist_result_json`, `result_sha256`, `role_holder_revision` | FK机械已映射, JSON；逻辑/业务语义待登记 |
| `aims.deliverable_submissions` | `deliverable_id`, `document_version_id`, `content_sha256`, `evidence_snapshot_json`, `checklist_version_id`, `review_grant_id` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.deliverable_waivers` | `deliverable_id`, `role_holder_revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.deliverables` | `project_owner_id`, `milestone_owner_id`, `target_id`, `matter_id`, `current_submission_id`, `repo_project_code`, `repo_commit_id`, `project_id`, `project_code` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.gitlab_commits` | `project_id`, `work_item_id`, `repo_project_code` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.gitlab_issue_links` | `project_id`, `work_item_id`, `repo_project_code` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.integration_operation` | `operation_id`, `tenant_code`, `deployment_code`, `operation_code`, `source_biz_code`, `target_receipt_id`, `target_biz_code`, `command_json`, `command_sha256`, `original_request_id`, `correlation_id`, `service_client_id`, `last_error_code`, `response_summary_sha256`, `failure_notification_id` | JSON, receipt, outbox；父链/规划schema与JSON（部分；其他family待登记） |
| `aims.integration_operation_attempt` | `attempt_id`, `operation_id`, `operation_code`, `request_id`, `correlation_id`, `error_code`, `target_biz_code`, `response_summary_sha256` | FK机械已映射, outbox；父链、编号/fence/状态序列（已实现；历史重放语义仍待逐family登记） |
| `aims.integration_operation_dead_letter_actionable` | `operation_id`, `tenant_code`, `deployment_code`, `operation_code`, `source_biz_code`, `last_error_code`, `notification_id`, `recipient_uids` | FK机械已映射, JSON, outbox；父链/version/attempt边界（部分） |
| `aims.milestone_cycle_snapshots` | `project_id`, `source_milestone_id`, `next_milestone_id`, `sla_snapshot`, `source_biz_code`, `request_id`, `service_client_id` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.milestones` | `project_id`, `completion_lock_request_id`, `payment_term_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.notification_rules` | `project_id` | FK机械已映射, JSON；逻辑/业务语义待登记 |
| `aims.product_activity_logs` | `product_code`, `object_id`, `revision`, `changes`, `request_id` | JSON, audit；version生命周期、plan五动作、scope四动作及延期来源audit与receipt同actor/key/object/revision配对（部分；未登记family仍blocking） |
| `aims.product_catalog_control` | 无字段名候选；仍需源码引用审计 | audit；逻辑/业务语义待登记 |
| `aims.product_catalog_page_receipts` | `request_hash`, `result_json` | FK机械已映射, JSON, audit, receipt；逻辑/业务语义待登记 |
| `aims.product_catalog_projection` | `product_code` | FK机械已映射, audit；逻辑/业务语义待登记 |
| `aims.product_catalog_refreshes` | `biz_id`, `source_watermark`, `revision` | audit, watermark；epochUUID:revision合同形状（部分；不可排序） |
| `aims.product_command_receipts` | `product_code`, `execution_id`, `request_hash`, `result_json` | JSON, receipt；已登记version/plan/scope结果形状、整数revision/主档引用与历史workspace上界；plan/scope另按领域typed payload重算request_hash（部分；未登记family仍blocking） |
| `aims.product_component_sources` | `source_product_code`, `product_code`, `component_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_components` | `biz_id`, `product_code`, `parent_id`, `revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_cross_dependencies` | `biz_id`, `product_code`, `planning_item_id`, `predecessor_product_code`, `predecessor_id`, `revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_dependency_graph_lock` | `revision` | 逻辑/业务语义待登记 |
| `aims.product_document_creation_requests` | `biz_id`, `product_code`, `operation_id`, `relation_biz_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_documents` | `biz_id`, `product_code`, `revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_features` | `biz_id`, `product_code`, `component_id`, `lifecycle_evidence`, `revision` | FK机械已映射, JSON；逻辑/业务语义待登记 |
| `aims.product_feedback_bindings` | `source_biz_id`, `product_code`, `request_id`, `source_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_line_workspaces` | `line_code`, `product_code`, `source_watermark` | FK机械已映射, watermark；逻辑/业务语义待登记 |
| `aims.product_members` | `product_code`, `revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_objective_cycles` | `biz_id`, `product_code`, `objective_id`, `cycle_id`, `objective_revision`, `cycle_revision`, `objective_snapshot`, `cycle_snapshot` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.product_objective_items` | `objective_id`, `planning_item_id`, `product_code` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_objective_observations` | `biz_id`, `objective_id`, `product_code`, `objective_revision`, `metric_snapshot`, `evidence`, `correction_of_id` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.product_objectives` | `biz_id`, `product_code`, `revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_outcome_observations` | `cycle_id`, `metric_snapshot`, `evidence`, `correction_of_id` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.product_planning_comments` | `planning_item_id`, `cycle_id`, `revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_planning_cycle_items` | `cycle_id`, `planning_item_id`, `product_code`, `current_assessment_id`, `decision_snapshot` | FK机械已映射；capacity/pending/consumed-withdrawal JSON冻结引用、版本、配对receipt/audit与hash已登记；其他decision动作仍待登记 |
| `aims.product_planning_cycles` | `biz_id`, `product_code`, `model_snapshot`, `queue_revision`, `revision`, `closed_snapshot` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.product_planning_dependencies` | `product_code`, `planning_item_id`, `predecessor_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_planning_item_requests` | `product_code`, `planning_item_id`, `request_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_planning_items` | `biz_id`, `product_code`, `feature_id`, `derived_from_id`, `merged_into_id`, `deadline_evidence`, `scope_revision`, `evidence_revision`, `revision` | FK机械已映射, JSON；逻辑/业务语义待登记 |
| `aims.product_priority_assessments` | `cycle_id`, `planning_item_id`, `scope_revision`, `evidence_revision`, `model_snapshot`, `evidence_snapshot`, `reach_observation_id` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.product_priority_model_versions` | `biz_id`, `product_code` | FK机械已映射, JSON；逻辑/业务语义待登记 |
| `aims.product_release_events` | `release_record_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_release_records` | `biz_id`, `version_id`, `scope_revision`, `scope_snapshot`, `acceptance_snapshot`, `content_hash`, `supersedes_record_id` | FK机械已映射, JSON, snapshot；version=1冻结验收/范围/执行与writer content_hash；匹配冻结证据支持scope/execution后续移除（部分） |
| `aims.product_request_delivery_links` | `product_code`, `planning_item_id`, `request_id`, `project_id`, `requirement_id`, `source_revision`, `scope_snapshot`, `planned_version_id`, `planned_version_feature_id` | FK机械已映射, JSON, snapshot；已消费source_revision上界（部分；scope_snapshot待登记） |
| `aims.product_request_features` | `product_code`, `request_id`, `product_feature_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_request_sources` | `request_id`, `source_biz_id`, `revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_requests` | `biz_id`, `product_code`, `component_id`, `merged_into_id`, `revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_rice_reach_observations` | `biz_id`, `product_code`, `planning_item_id`, `scope_revision`, `evidence_revision`, `snapshot` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.product_roadmap_commitments` | `biz_id`, `product_code`, `planning_item_id`, `cycle_id`, `item_revision`, `scope_revision`, `evidence_revision`, `cycle_revision`, `queue_revision`, `item_snapshot`, `decision_snapshot`, `model_snapshot` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.product_roadmap_cross_dependency_snapshots` | `commitment_id`, `dependency_biz_id`, `dependency_revision`, `predecessor_product_code`, `predecessor_biz_id`, `predecessor_revision`, `snapshot` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.product_roadmap_saved_views` | `biz_id`, `product_code`, `cycle_id`, `revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_version_acceptances` | `version_id`, `scope_revision` | FK机械已映射, JSON；version=1/manual checklist、exceptions与范围/执行引用（部分） |
| `aims.product_version_features` | `version_id`, `product_feature_id`, `planning_item_id`, `deferred_from_feature_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_version_logs` | `version_id` | FK机械已映射, audit；逻辑/业务语义待登记 |
| `aims.product_version_plan_confirmations` | `version_id`, `plan_revision`, `scope_revision`, `snapshot` | FK机械已映射, JSON, snapshot；version=1范围/request/revision/容量冻结与confirm receipt/audit；失效后scope/planning移除须后续成功delete冻结证明（部分） |
| `aims.product_version_plan_scopes` | `version_feature_id`, `version_id`, `product_code`, `request_id`, `planning_item_id`, `revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_version_plans` | `version_id`, `product_code`, `revision`, `scope_revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_versions` | `product_code`, `version_code`, `milestone_id`, `owner_project_id`, `revision`, `scope_revision`, `current_release_record_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.product_workspaces` | `product_code`, `biz_id`, `revision` | 产品主档逻辑引用（部分） |
| `aims.project_activity_logs` | `project_id`, `object_code`, `changes`, `request_id` | FK机械已映射, JSON, audit；member审计/删除证明（候选；未应用） |
| `aims.project_cost_summary` | `project_code`, `detail_json` | JSON, audit；逻辑/业务语义待登记 |
| `aims.project_counters` | `project_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.project_documents` | `portfolio_id`, `project_id`, `project_code`, `milestone_id`, `work_item_id`, `parent_id`, `repo_project_code`, `repo_commit_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.project_environments` | `project_id`, `environment_code`, `delivery_asset_code`, `delivery_version_snapshot`, `source_contract_line_code`, `source_obligation_code` | FK机械已映射, snapshot；逻辑/业务语义待登记 |
| `aims.project_lifecycle_events` | `project_id`, `request_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.project_management_fact_snapshots` | `revision`, `fact_code`, `project_id`, `project_code`, `value_json`, `source_refs_json`, `source_sha256`, `correction_of_id` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.project_manager_delegations` | `project_id`, `role_holder_revision`, `revoked_role_holder_revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.project_portfolios` | `domain_code`, `dept_code` | 逻辑/业务语义待登记 |
| `aims.project_template_sets` | 无字段名候选；仍需源码引用审计 | 逻辑/业务语义待登记 |
| `aims.project_template_versions` | `template_set_id`, `definition_json` | FK机械已映射, JSON；逻辑/业务语义待登记 |
| `aims.project_weekly_report_correction_requests` | `report_id`, `correction_of_version_id`, `role_holder_revision`, `submitted_version_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.project_weekly_report_entries` | `report_id`, `project_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.project_weekly_report_reviews` | `report_version_id`, `role_holder_revision` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.project_weekly_report_versions` | `report_id`, `correction_of_version_id`, `manager_content_json`, `fact_snapshot_json`, `fact_snapshot_sha256` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.project_weekly_report_work_items` | `report_id`, `project_id`, `work_item_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.project_weekly_reports` | `project_id`, `obligation_id`, `current_submitted_version_id`, `current_reviewed_version_id`, `current_frozen_version_id`, `pending_correction_of_version_id`, `pending_correction_request_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.qa_checklist_versions` | `checklist_code`, `items_json`, `items_sha256` | JSON；逻辑/业务语义待登记 |
| `aims.requirement_contents` | `content_original_id`, `project_id`, `parent_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.requirement_item_contents` | `requirement_id`, `content_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.requirement_items` | `parent_requirement_id`, `project_id`, `req_code`, `milestone_id`, `work_item_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.requirement_review_batches` | `project_id`, `requirement_ids_json`, `workflow_instance_id` | FK机械已映射, JSON；逻辑/业务语义待登记 |
| `aims.requirement_versions` | `requirement_id`, `snapshot_json`, `batch_id`, `approval_workflow_id` | FK机械已映射, JSON, snapshot；逻辑/业务语义待登记 |
| `aims.service_command_receipt` | `receipt_id`, `operation_id`, `operation_code`, `tenant_code`, `source_deployment_code`, `deployment_code`, `command_sha256`, `first_request_id`, `last_request_id`, `correlation_id`, `service_client_id`, `target_biz_code`, `response_summary_sha256`, `last_error_code` | receipt；稳定身份/hash/目标合同（部分；未登记目标blocking） |
| `aims.system_parameters` | 无字段名候选；仍需源码引用审计 | 逻辑/业务语义待登记 |
| `aims.time_entries` | `project_id`, `work_item_id`, `weekly_report_id`, `reviewer_uid_snapshot`, `locked_report_version_id`, `approved_summary_version_id`, `corrects_entry_id` | FK机械已映射, snapshot；逻辑/业务语义待登记 |
| `aims.time_entry_review_events` | `time_entry_id`, `report_version_id`, `summary_version_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.user_favorite_projects` | `project_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.weekly_report_corrective_action_links` | `review_id`, `work_item_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.weekly_report_obligations` | `period_id`, `project_id`, `responsible_uid_snapshot`, `project_status_snapshot` | FK机械已映射, snapshot；逻辑/业务语义待登记 |
| `aims.weekly_reporting_periods` | `settings_snapshot_json` | JSON, snapshot；逻辑/业务语义待登记 |
| `aims.weekly_reporting_pilot_projects` | `project_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.weekly_reporting_settings` | `reminder_offsets_json`, `rag_config_json` | JSON；逻辑/业务语义待登记 |
| `aims.work_item_attachments` | `work_item_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.work_item_changelog` | `work_item_id` | FK机械已映射, audit；逻辑/业务语义待登记 |
| `aims.work_item_comments` | `work_item_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.work_item_completion_requests` | `project_id`, `work_item_id`, `snapshot_json`, `snapshot_sha256`, `review_version`, `operation_key`, `active_work_item_id`, `workflow_instance_id`, `workflow_instance_no`, `target_receipt_id` | 候选未应用；逻辑表→aims_work_item_completion_requests；复合FK(project_id,work_item_id)→aims_work_items(project_id,id)，RESTRICT；STORED活跃生成列/唯一及operation唯一已隔离复制验证；冻结snapshot/receipt/outbox hash与请求audit已登记；Workflow外部身份不重写；终态审计/replay历史已登记；later child删除冻结证据待补 |
| `aims.work_item_relations` | `source_id`, `target_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.work_item_service_ext` | `work_item_id`, `project_id`, `source_ticket_code`, `customer_code`, `environment_code`, `sla_status_snapshot` | FK机械已映射, snapshot；逻辑/业务语义待登记 |
| `aims.work_item_source_anchors` | `work_item_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.work_item_status_catalog` | 无字段名候选；仍需源码引用审计 | audit；逻辑/业务语义待登记 |
| `aims.work_items` | `project_id`, `milestone_id`, `version_id`, `feature_id`, `requirement_id`, `parent_id`, `routine_scope`, `beneficiary_dept_code`, `carryover_origin_milestone_id`, `decomposition_source_id`, `workflow_instance_id` | FK机械已映射；逻辑/业务语义待登记 |
| `aims.workflow_status_catalog` | 无字段名候选；仍需源码引用审计 | audit；逻辑/业务语义待登记 |
| `aims.workflow_transitions` | `project_id` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.asset_alerts` | `asset_id`, `environment_id`, `delivery_view_id`, `project_code` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.asset_assignments` | `asset_id`, `workflow_instance_id` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.asset_category_groups` | `category_scope`, `short_code` | 逻辑/业务语义待登记 |
| `assets.asset_category_items` | `group_id`, `short_code` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.asset_delivery_environments` | `delivery_view_id`, `environment_id` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.asset_delivery_products` | `delivery_view_id`, `product_asset_id` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.asset_delivery_views` | `delivery_code`, `customer_code`, `contract_code`, `project_code` | 逻辑/业务语义待登记 |
| `assets.asset_documents` | `object_id`, `document_id` | JSON；逻辑/业务语义待登记 |
| `assets.asset_environment_assets` | `environment_id`, `asset_id` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.asset_environments` | `environment_code`, `project_code`, `customer_code`, `contract_code`, `dept_code` | audit；逻辑/业务语义待登记 |
| `assets.asset_events` | `object_id` | JSON；逻辑/业务语义待登记 |
| `assets.asset_items` | `public_id`, `asset_code`, `dept_code`, `project_code`, `customer_code`, `contract_code`, `environment_id` | JSON；逻辑/业务语义待登记 |
| `assets.asset_monthly_costs` | `asset_id`, `project_code`, `customer_code`, `contract_code`, `environment_id` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.asset_offboarding_recovery_cases` | `case_code`, `source_payload_sha256` | 逻辑/业务语义待登记 |
| `assets.asset_physical_details` | `asset_id`, `model`, `qr_code` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.asset_receipts` | `purchase_order_id` | FK机械已映射, receipt；逻辑/业务语义待登记 |
| `assets.asset_resource_details` | `asset_id` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.assets_notification_checkpoint` | `source_id`, `source_code`, `recipient_candidates_json`, `notification_id` | JSON, watermark；逻辑/业务语义待登记 |
| `assets.assets_product_catalog_state` | `revision` | audit, watermark；逻辑/业务语义待登记 |
| `assets.customer_delivery_asset_environment_rel` | `delivery_asset_id`, `environment_id`, `source_project_code` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.customer_delivery_assets` | `delivery_asset_code`, `customer_code`, `contract_code`, `contract_line_code`, `obligation_code`, `project_code`, `delivery_view_code`, `asset_item_code`, `product_code`, `catalog_item_code`, `environment_code`, `license_model`, `responsible_dept_code`, `source_biz_code`, `source_plan_code`, `altoc_status_sync_revision` | audit；逻辑/业务语义待登记 |
| `assets.digital_asset_products` | `digital_asset_id`, `product_asset_id` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.digital_assets` | `digital_code`, `access_scope`, `project_code`, `environment_id` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.integration_operation` | `operation_id`, `tenant_code`, `deployment_code`, `operation_code`, `source_biz_code`, `target_receipt_id`, `target_biz_code`, `command_json`, `command_sha256`, `original_request_id`, `correlation_id`, `service_client_id`, `last_error_code`, `response_summary_sha256`, `failure_notification_id` | JSON, receipt, outbox；父链/规划schema与JSON（部分；其他family待登记） |
| `assets.integration_operation_attempt` | `attempt_id`, `operation_id`, `operation_code`, `request_id`, `correlation_id`, `error_code`, `target_biz_code`, `response_summary_sha256` | FK机械已映射, outbox；父链、编号/fence/状态序列（已实现；历史重放语义仍待逐family登记） |
| `assets.integration_operation_dead_letter_actionable` | `operation_id`, `tenant_code`, `deployment_code`, `operation_code`, `source_biz_code`, `last_error_code`, `notification_id`, `recipient_uids` | FK机械已映射, JSON, outbox；父链/version/attempt边界（部分） |
| `assets.ip_asset_products` | `ip_asset_id`, `product_asset_id` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.ip_assets` | `ip_code` | 逻辑/业务语义待登记 |
| `assets.product_asset_bases` | `product_asset_id`, `technology_base_id` | FK机械已映射, audit；逻辑/业务语义待登记 |
| `assets.product_asset_resources` | `product_asset_id`, `asset_id` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.product_assets` | `product_code`, `project_code` | JSON；产品主档归一键冲突（部分） |
| `assets.purchase_order_items` | `purchase_order_id` | FK机械已映射；逻辑/业务语义待登记 |
| `assets.purchase_orders` | `applicant_dept_code`, `project_code`, `customer_code`, `contract_code`, `environment_id`, `supplier_id`, `workflow_instance_id` | FK机械已映射, JSON；逻辑/业务语义待登记 |
| `assets.service_command_receipt` | `receipt_id`, `operation_id`, `operation_code`, `tenant_code`, `source_deployment_code`, `deployment_code`, `command_sha256`, `first_request_id`, `last_request_id`, `correlation_id`, `service_client_id`, `target_biz_code`, `response_summary_sha256`, `last_error_code` | receipt；稳定身份/hash/目标合同（部分；未登记目标blocking） |
| `assets.suppliers` | `supplier_code`, `credit_code` | 逻辑/业务语义待登记 |
| `assets.system_parameters` | 无字段名候选；仍需源码引用审计 | 逻辑/业务语义待登记 |
| `assets.technology_bases` | `base_code`, `project_code` | audit；逻辑/业务语义待登记 |

总数校验：152个唯一domain.table（Aims115、Assets37）；此清单穷尽本候选批的表名及静态字段候选，未宣称穷尽全部业务引用路径。剩余缺口必须逐表登记或显式证明不适用后才能勾选INT-202。

## 完成请求新增152候选合同（仅隔离演练）

Schema依据：[Aims canonical](../aims/docs/aims_schema.sql)和[additive v5.39](../aims/docs/migration_v5.39_work_item_completion_requests.sql)；环境候选声明见[completion additive mapping](../deploy/test-env/enterprise-work-item-completion-additive.json)。旧环境迁移/激活回执不含新增表，不能因本登记自动启用或应用DDL。迁移器按source实际表动态生成唯一table mapping并重写复合FK；生成列不进入INSERT列，保留DDL表达式及unique索引。

真实公开source：[enterprise_work_item_completion.go](../data-runtime/internal/apps/aims/enterprise_work_item_completion.go)、[enterprise_work_item_write.go](../data-runtime/internal/apps/aims/enterprise_work_item_write.go)、[work_item_completion_callback.go](../data-runtime/internal/apps/aims/work_item_completion_callback.go)。冻结snapshot是writer的数据库map（完整item字段及有序children的id/status/version），没有另造schemaVersion或DTO字段顺序；JSON数字/nullable字段按现有writer格式重算SHA。迁移[completion_request_json_contract.go](../data-runtime/internal/migrations/unified/completion_request_json_contract.go)拒绝未知字段、丢失字段、错误目标/子项/project/parent、hash或孩子状态，验证owner receipt的work-item-complete.v1原始命令hash（canonical项目/工作项整数URL身份＋冻结item expectedVersion）、同actor/request的完成请求audit，以及唯一workflow-submit.v1实际payload/idempotency key/schema/hash/metadata。无法还原的非canonical旧URL命令指纹须脱敏人工解释，不改用当前mutable version免除hash。后续正常子项改名不破坏已验证历史；审批consumer仍在真实批准时检查live冻结版本。

`workflow_instance_id/no`与`target_receipt_id`属于Workflow/provider，只检查配对形状，不作为本地Aims FK、改号或猜测外部存在性。运行中请求必须有实例身份。终态回调审计和人工replay合同后续覆盖见下；later子项物理移除仍缺可识别成功删除冻结证明，继续blocking，不能据本批勾INT-202或宣称真实外部审批已验收。

[completion_request_json_mysql_test.go](../data-runtime/internal/migrations/unified/completion_request_json_mysql_test.go)复用随机临时MySQL/canonical fixture，实际调用公开Adapter.RequestEnterpriseWorkItemCompletion生成snapshot/outbox/owner receipt/audit，验证合法数据及损坏snapshot/hash/owner hash/command/actor/来源请求负例。影子schema使用真实rewriteDDL与copyTable复制新增表；确认generated active=work item、重复queued/running被unique拒绝、终态释放活跃唯一、跨project复合FK与目标DELETE RESTRICT有效；合成外部Workflow实例987654321/no/receipt原样保留，未调用任何外部系统。

review_version由冻结item将status改为in_review准确重建SHA，不以当前已变化item重新推测。机械copy/digest沿用`hzy-enterprise-migrate`的ParseTime=false原始字节句柄，与领域ParseTime=true句柄分开；本测试发现并修正fixture句柄误用，没有改迁移CLI/业务source。最终脱敏回执（2026-09-15）：迁移包`go test ./internal/migrations/unified -count=1` PASS（0.308s）；仓库根运行`node data-runtime/scripts/test-enterprise-migration-conflicts-mysql.mjs`实际随机隔离MySQL `TestProductMasterConflictReportMySQL` PASS（2.20s，package 2.468s），包含真实公开writer、owner/snapshot/review/outbox hash负例及真实copyTable机械复制。152唯一domain.table（115 Aims/37 Assets）、本地链接及diff校验通过。临时用户/schema/影子schema删除，harness停止清理；未读取业务env、访问业务库/生产、调用provider、应用目标环境或部署。

## 完成请求终态与人工重放历史（隔离验证）

[completion_history_contract.go](../data-runtime/internal/migrations/unified/completion_history_contract.go)依真实[callback writer](../data-runtime/internal/apps/aims/work_item_completion_callback.go)登记六字段completion_result变化，绑定request/project/item、外部workflow instance、审计request_id及行终态。批准须operator属于approvers、operator不是initiator且有真实非自审批名单；nonSelf每人不得为initiator且必须属于approvers。拒绝允许现有consumer的空nonSelf；取消只允许initiator且审批名单为null。正好一个有效终态审计，且同actor/item的work_item_changelog中必须保存完全相同completion_workflow JSON，缺依赖/审计、重复证明或unknown字段均blocking。

人工replay依[public replay source](../data-runtime/internal/apps/aims/enterprise_work_item_completion_replay.go)登记requestId/operationId/reason/operationVersion四字段。绑定稳定operation/key/request、当前operation version上界与按审计id递增的历史replay version；不能在终态后重放。expectedOperationVersion由冻结result version−1还原，原reason/项目/工作项canonical身份重建completion-replay.v1 owner receipt hash，必须匹配同actor/key成功receipt和原work_item_changelog。不能用当前operation版本替代旧expectedOperationVersion，也不重写原冻结workflow-submit command或snapshot。

真实隔离fixture实际调用公开ReplayEnterpriseWorkItemCompletion（包括同key重试）及VerifiedWorkItemCompletionCallbackFromTrustedRuntime→ApplyWorkItemCompletionCallback，生成批准、拒绝、取消三种终态和原审计；批准重复callback不新增audit。批准前running及批准后terminal均再次使用真实copyTable影子复制，保留冻结snapshot/review/hash和外部Workflow身份；其余表语义未据此宣称全闭包。错误外部instance/非自审批名单/to/未知字段、未来replay revision、删除原终态审计/缺changelog均拒绝；正常后来子项改名通过。

**later child deletion仍缺源码合同**：旧[workspace DELETE](../data-runtime/internal/apps/aims/workspace.go)将/v1/aims/work-items/:id交给通用Adapter.HandleRuntime；[distribution删除](../data-runtime/internal/apps/aims/work_item_distribution.go)与[project删除](../data-runtime/internal/apps/aims/project_deletion.go)直接删除行，未保存可绑定completion frozen child id/version/project/parent的专用成功receipt/tombstone。批准audit仅证明批准时consumer验证过冻结孩子，不能推断后来缺失是合法删除。本批只在隔离数据中模拟移除孩子并确认blocking，没有制造删除审计或用当前version替代证据。要放行该历史，须先由业务拥有方设计追加式删除冻结合同或提供真实可验证的历史证据；INT-202保持未完成。

最终脱敏隔离回执（2026-09-15）：`data-runtime`中`go test ./internal/migrations/unified -count=1` PASS（0.319s）；仓库根目录`node data-runtime/scripts/test-enterprise-migration-conflicts-mysql.mjs`实际随机专用MySQL `TestProductMasterConflictReportMySQL` PASS（2.42s，package 2.754s），包括公开replay/三种verified callback终态、同key/callback重试、真实running/approved copyTable、历史证据负例及未证明孩子移除拒绝。152唯一登记行与本地源码链接/diff检查通过。临时数据库用户、fixture schema、两次影子schema和MySQL实例全部清理；未读业务env、访问生产/业务库、调用外部provider、应用目标环境或部署。此证据不代表新增152表环境激活或真实外部审批验收。

## 版本编辑与进入开发合同（隔离验证）

源码依据：`productcenter/version_detail.go` 写入 `ProductVersionDetail` 与 `{before,after,reason}` 审计；`version_transition.go` 只允许 planning→developing，写入五字段result及 `{result,reason,from_status}`；`version_reads.go` 定义详情形状，`command.go` 持久化/重放原result JSON。历史载荷没有schemaVersion，动作与明确字段集合是现有合同判别，不补写schema标记。

迁移 `version_mutation_json_contract.go` 验证 succeeded receipt/request_hash形状、整数id/revision/workspace_revision、version/product存在与当前revision上界、edit scope revision与planning mode、transition固定developing状态，拒绝未知字段。audit须同actor/key/object/revision；edit after与receipt去除workspace_revision后的原快照一致、before对象相同且revision+1；transition result逐JSON相同且from_status=planning、reason非空。当前mutable version_code/name/status不与旧快照强制相等，防止合法历史create/edit在后续改名后被误阻断。历史create仍须保留非空版本编码，但不要求与当前编码相等。

随机隔离MySQL命令 `node data-runtime/scripts/test-enterprise-migration-conflicts-mysql.mjs` 通过：合法edit/transition及配对audit可通过；后来修改的当前version_code不阻断旧create；未知schema字段、missing version引用、错actor/结果不一致audit被拒绝。实例已清理，未读业务库/环境配置、未部署。

具体剩余：其他产品接入/组件/功能/需求/规划动作result仍待逐项登记；版本acceptance/publish、plan确认快照及plan/scope写命令新增合同见下。Assets产品create/edit属于owned service receipt且原表不保存result_json，不能把此Aims结果合同套到该域。archive/reopen/delete及非空owner/release edit新增合同见下。INT-202不勾选。

删除后的合法edit历史链已加入：只有planning edit结果可使用同一已验证成功delete冻结before，历史revision/scope不得超过before，workspace_revision必须早于delete结果，配对edit审计id须早于delete审计且原after一致。不能用另一个伪造高revision事件替代该冻结证明。随机MySQL合法planning edit→delete通过；revision/scope超过冻结值、审计顺序倒置、删除操作者伪造均拒绝。transition只能planning→developing，而delete仅允许未发布planning；version_reopen只released→developing，源码没有developing→planning路径，所以transition后删除不是当前合法历史，必须拒绝并待人工解释，不能用删除审计免除状态链。scope/plan写命令仍为下一批合同，不据此勾选INT-202。

## 验收、发布和计划确认冻结 JSON（隔离验证）

写入/消费依据：`data-runtime/internal/apps/aims/productcenter/version_acceptance.go`、`version_publish.go`、`version_execution.go`、`lightweight_plan_write.go`、`lightweight_plan.go` 和命令重放 `command.go`。验收 checklist 显式 version=1/review_mode=manual，包含 reviewed_version、scope_snapshot、execution_snapshot 和三个人工 checks；exceptions 为含责任人与影响的数组。发布 scope_snapshot version=1，acceptance_snapshot 冻结对应验收，而非迁移时重新抓取当前数据。执行快照 hash 依原 typed struct 字段顺序生成；发布 content_hash 依 writer 的 UseNumber/map 递归规范化 JSON 生成。不能用 MySQL 展示 JSON 的字符串 hash 代替。

可执行登记：`release_snapshot_json_contract.go` 和 `execution_snapshot_json_contract.go` 校验这些明确字段/版本、同产品 scope/feature/planning 引用、同版本验收、actor、冻结 checklist/exceptions、执行目标/缺陷引用及 totals/hash；`accept_publish_receipt_json_contract.go` 登记 accept/publish 两个 succeeded result 和配对 audit 的真实不同结构，检查稳定 key/actor、目标、revision/workspace 上界与原 result。`plan_confirmation_json_contract.go` 登记 `product_version_plan_confirmations.snapshot` version=1：同版本 plan/scope/version revision 不得超过当前值，冻结 request revision 不得超过其源，request/planning 必须同产品，accepted 决策、日期、明确小数字符串、人天汇总与剩余容量须一致。有效确认要求 scope 存在；失效后的 scope/planning 缺失现在必须有匹配的后续 delete 冻结证明，见下一节。

历史本地回执（671f0387）：`go test ./internal/migrations/unified -count=1` PASS；`node data-runtime/scripts/test-enterprise-migration-conflicts-mysql.mjs` 在随机临时独立实例实际运行 `TestProductMasterConflictReportMySQL` PASS（0.17s，package 0.426s）。脚本自动停止并清理实例，未读取业务环境配置、未连接业务库、未部署。完整载荷正例和损坏负例在 `release_snapshot_json_mysql_test.go`、`plan_confirmation_json_mysql_test.go`：合法验收/发布/计划快照通过；错误发布 hash、未知 snapshot version、scope 引用跨版本、publish audit 错 actor、request revision 回退、missing planning item、容量汇总不一致和有效确认丢失 scope 被拒绝。当时仅凭失效标记接受 scope 缺失的分支已被下一批冻结删除证据规则取代，不作为当前完成证据。

上述登记覆盖一批合法业务载荷，不构成151表语义穷尽，也不改变旧150表已激活回执与151候选代码闭包的区别，INT-202继续未完成。剩余具体合同见下一节。

## Plan/scope命令与后续移除历史

源码合同为 [lightweight_plan_write.go](../data-runtime/internal/apps/aims/productcenter/lightweight_plan_write.go)、[lightweight_plan.go](../data-runtime/internal/apps/aims/productcenter/lightweight_plan.go)、[version_scope.go](../data-runtime/internal/apps/aims/productcenter/version_scope.go)、[version_scope_edit.go](../data-runtime/internal/apps/aims/productcenter/version_scope_edit.go)、[version_scope_reopen.go](../data-runtime/internal/apps/aims/productcenter/version_scope_reopen.go)、[version_scope_delivery.go](../data-runtime/internal/apps/aims/productcenter/version_scope_delivery.go)、[planning_delivery_gate.go](../data-runtime/internal/apps/aims/productcenter/planning_delivery_gate.go)、[planning_selection.go](../data-runtime/internal/apps/aims/productcenter/planning_selection.go) 和 [command.go](../data-runtime/internal/apps/aims/productcenter/command.go)。登记的准确action为 `product_versions:plan-edit`、`plan-item-create`、`plan-item-edit`、`plan-item-delete`、`plan-confirm`、`scope-create`、`scope-edit`、`scope-reopen`、`scope-deliver`；不存在以“add”别名代替源码action的宽匹配。

[plan_command_json_contract.go](../data-runtime/internal/migrations/unified/plan_command_json_contract.go) 与 [scope_command_json_contract.go](../data-runtime/internal/migrations/unified/scope_command_json_contract.go) 按动作校验result/audit不同字段结构、稳定key/actor/object、版本/计划/范围/workspace revision上界和输入→结果的增量。confirm不增加revision；scope-create audit的after为result，scope-edit audit的after为input；deliver/reopen使用不同before状态、evidence与冻结scope revision字段。scope创建/编辑另验证decision basis：capacity version=1与明确effort/null、合法类别/例外、同产品item/cycle及准确assessment scope/evidence/model引用；延期来源须有同actor/key的scope-defer配对事件。[typed_payload_json_contract.go](../data-runtime/internal/migrations/unified/typed_payload_json_contract.go) 复用公开领域payload类型按writer字段顺序与小数/omitempty规则重算request_hash，并校验原audit保留实际writer字段；不是仅比较64字符形状。delete/deliver/reopen原audit没有input，按其完整result和reason/evidence还原真实输入再验证hash。计划未确认时允许空scope_summary/acceptance_criteria及负的int32 sort_order，避免引入writer没有的业务限制。

历史存在性规则由 [snapshot_history_json_contract.go](../data-runtime/internal/migrations/unified/snapshot_history_json_contract.go) 与上述delete合同执行：验收是append-only，成功accept receipt和配对audit须绑定原acceptance/version/scope/reviewed revision+1及actor，执行快照仍验证typed hash与目标版本/冻结scope成员。work item后续物理移除可沿该冻结验收证明通过。scope或确认中的planning item后续移除则须更晚的同scope/product/version成功delete receipt/audit、原planning/request身份、真实输入hash及当前revision上界；create/edit历史另要求删除审计晚于原审计及workspace revision更大。仅失效标记、裸缺失、错误actor/身份、未来revision均不构成证明。活体ID/biz_id仍存在但版本/产品/project归属不一致时拒绝，不沿历史证据放行。

正负例在 [plan_command_json_mysql_test.go](../data-runtime/internal/migrations/unified/plan_command_json_mysql_test.go)、[scope_command_json_mysql_test.go](../data-runtime/internal/migrations/unified/scope_command_json_mysql_test.go)、[snapshot_history_json_mysql_test.go](../data-runtime/internal/migrations/unified/snapshot_history_json_mysql_test.go)。使用真实公开payload类型生成完整audit与request hash；合法五类plan及四类scope载荷、confirm→delete后scope/planning移除、验收执行项移除和配对scope删除证明通过。未知schema字段、丢失writer字段、损坏hash、未知capacity版本、错assessment/actor/request、未证明移除、活体错归属和未来delete revision被拒绝。最终隔离运行命令与结果见下方本批回执。

剩余：decision消费确认/撤回本批合同见下；scope-visibility/legacy-criteria与长期feature删除历史证明；缺少新delete冻结字段的旧历史需要专门证据规则或脱敏人工处理；其他产品接入/组件/功能/需求/规划JSON families与其余表语义。没有把这些未知变体无条件allowlist，仍fail closed；不据此勾选INT-202。

## 消费确认、保留消耗与撤回冻结合同

真实writer/consumer依据：[planning_consumption.go](../data-runtime/internal/apps/aims/productcenter/planning_consumption.go)、[planning_consumption_confirm.go](../data-runtime/internal/apps/aims/productcenter/planning_consumption_confirm.go)、[planning_withdrawal.go](../data-runtime/internal/apps/aims/productcenter/planning_withdrawal.go)、[capacity_comparison.go](../data-runtime/internal/apps/aims/productcenter/capacity_comparison.go)。唯一JSON字段registry登记`product_planning_cycle_items.decision_snapshot`并要求依赖表/关键列存在，未知decision动作仍阻断。

[consumption_json_contract.go](../data-runtime/internal/migrations/unified/consumption_json_contract.go)验证真实typed confirmation/result/withdrawal impact和audit形状，version=1、canonical UUID、显式spent、类别、时间、scope/item及workspace/cycle/queue历史revision上界。capacity-only历史载荷按现有consumer接受，完整selection envelope则必须有真实assessment/item/cycle/scope/evidence/model引用。pending不能递归嵌套；对应成功confirmation receipt与同actor/key/product/cycle/revision审计必须唯一匹配，输入由冻结结果重建并验证原始SHA256。替换pending不要求旧确认与当前快照相同；后续正常scope/item修改只使pending过时，不损坏可迁移历史。

已开工撤回必须消费冻结pending及原decision，retained值与confirmation ID由同一成功确认推导；withdrawal输入使用冻结ItemRevision重算hash，原impact与审计必须相同。确认/最新capacity报告均检查总量、类别、未知估算、剩余量及目标移除和实际spent保留的增减关系；其他事项的estimate changes继续保留，不要求整个周期只有一个事项。额外错对象审计、未知字段/schema、损坏引用/revision/hash不能通过。

精确缺口：**proposed撤回**的现有writer未在receipt result/audit/impact持久化ExpectedItemRevision，后续item revision可变，因此不能精确还原该分支旧输入hash。本规则仅验证其实际persisted hash格式、配对冻结impact和引用，不声称完整fingerprint证明；不能用当前revision替代旧值永久拒绝合法历史。capacity-only与已开工消费撤回已用真实writer验证，proposed撤回完整历史演练、其他decision动作仍待后续批次。该消费批回执当时，新`work_item_completion_requests`尚未纳入151表registry；后续152候选新增合同见上，历史隔离回执不能当作新表环境激活回执。INT-202保持未完成。

[consumption_json_mysql_test.go](../data-runtime/internal/migrations/unified/consumption_json_mysql_test.go)在随机隔离MySQL中仅提取canonical CREATE TABLE到专用随机schema，实际调用公开CreatePlanningCycle/AddPlanningCycleCandidate/ConfirmPlanningConsumption/WithdrawPlanningCandidate领域服务。覆盖确认替换、过时pending、保留消耗及后续revision合法历史，scope/revision/UUID/schema/hash/retained金额/actor/审计reason和额外错对象审计负例。复用已有临时实例harness；没有连接业务库、读取业务env、应用环境或部署。

本批最终脱敏回执（2026-09-15，本地）：在`data-runtime`运行`go test ./internal/migrations/unified -count=1` PASS（0.273s）；仓库根目录运行`node data-runtime/scripts/test-enterprise-migration-conflicts-mysql.mjs`，实际随机临时MySQL的`TestProductMasterConflictReportMySQL` PASS（2.44s，package 2.722s）。临时schema在连接关闭前删除，harness停止并清理实例；151唯一登记行、本地源码链接与`git diff --check`通过。此回执仅证明本批隔离数据及真实领域writer路径，不代表151/152业务语义全闭包或任何真实环境迁移完成。

本批隔离回执（2026-09-15，本地）：`go test ./internal/migrations/unified -count=1` PASS（0.559s）；`node data-runtime/scripts/test-enterprise-migration-conflicts-mysql.mjs` 实际随机临时MySQL运行 `TestProductMasterConflictReportMySQL` PASS（0.70s，package 0.977s），包括上述全部新正负例、合法延期及延期来源错版本/缺配对审计拒绝、发布JSON依赖列不完整时的unregistered gate阻断。临时实例由harness停止并清理；151唯一表名及本文件本地链接校验、`git diff --check`通过。未读取业务env、连接业务/生产库、执行真实迁移或部署，不是环境激活/真实provider验收回执。

## Owner/release 引用与版本生命周期

源码依据：version_archive.go输出含scope/release引用的archived result与from_status=released审计；version_reopen.go输出不含product_code的developing result，并在同事务写withdrawn release event；version_delete.go只删除未发布planning版本，保存deleted result与before快照作为历史证明。迁移version_lifecycle_json_contract逐动作登记这些真实差异，不把reopen结果缺product_code误作损坏。

edit非空owner必须引用aims_projects整数ID；非空current_release_record必须引用同version的release record，缺依赖表继续拒绝。archive/reopen须真实version/product、历史revision/workspace上界、准确状态与release引用；reopen另须同actor的withdrawn event。delete允许版本目标消失，但必须有同actor/key/product/object的成功delete receipt/audit，before为planning、未发布、revision+1且原result一致；audit匹配reason/object/revision。旧create载荷引用已删除版本可沿该删除证明通过，无有效证明仍拒绝。未知字段和破坏引用不能靠登记字段放行。

同一随机隔离MySQL脚本新增合法owner/release edit、archive/reopen/delete与配对audit通过；missing owner、missing release和delete错actor审计均被拒绝。迁移package全量通过，临时实例清理。没有读取业务库或应用DDL，151代码候选不等于已激活150表环境证据。后续edit/transition引用后来已删除目标及跨历史时间关系仍需完整删除链扩展；不据这些部分合同勾选INT-202。

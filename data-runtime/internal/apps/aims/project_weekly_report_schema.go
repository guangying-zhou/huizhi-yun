package aims

import (
	"context"
	"fmt"
)

func (a *Adapter) ensureProjectWeeklyReportSummarySchema(ctx context.Context) error {
	hasWeeklyReportID, err := a.tableColumnExists(ctx, "time_entries", "weekly_report_id")
	if err != nil {
		return err
	}
	if !hasWeeklyReportID {
		if _, err := a.DB().ExecContext(ctx, `
			ALTER TABLE time_entries
			  ADD COLUMN weekly_report_id BIGINT UNSIGNED NULL COMMENT '历史周报生成记录关联；兼容字段，新逻辑不再写入' AFTER work_item_id,
			  ADD KEY idx_weekly_report (weekly_report_id)
		`); err != nil {
			return err
		}
	}

	for _, column := range projectWeeklyReportSummaryColumnDefinitions() {
		exists, err := a.tableColumnExists(ctx, "project_weekly_reports", column.name)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if _, err := a.DB().ExecContext(ctx, fmt.Sprintf("ALTER TABLE `project_weekly_reports` ADD COLUMN %s", column.definition)); err != nil {
			return err
		}
	}

	_, err = a.DB().ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS project_weekly_report_work_items (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			report_id BIGINT UNSIGNED NOT NULL COMMENT '项目周报ID',
			project_id BIGINT UNSIGNED NOT NULL COMMENT '项目ID(冗余便于查询)',
			plan_type VARCHAR(32) NOT NULL DEFAULT 'this_week' COMMENT '工作/计划类型：this_week=本周工作,next_week=下周计划',
			source_type VARCHAR(32) NOT NULL DEFAULT 'manual' COMMENT '来源：manual=手工,calendar=项目日历,task=项目任务',
			work_item_id BIGINT UNSIGNED DEFAULT NULL COMMENT '关联工作项ID，自动生成时使用',
			module_name VARCHAR(200) DEFAULT NULL COMMENT '模块名称',
			sort_order INT NOT NULL DEFAULT 0 COMMENT '排序号',
			task_summary TEXT NOT NULL COMMENT '任务简述',
			owner_uid VARCHAR(64) DEFAULT NULL COMMENT '责任人UID',
			owner_name VARCHAR(100) DEFAULT NULL COMMENT '责任人展示名快照',
			completion_percent DECIMAL(5,2) DEFAULT NULL COMMENT '完成度百分比',
			incomplete_reason TEXT DEFAULT NULL COMMENT '未完成情况说明',
			workload_days DECIMAL(6,2) DEFAULT NULL COMMENT '工作量（人日）',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_report_sort (report_id, sort_order, id),
			KEY idx_project_plan (project_id, plan_type),
			KEY idx_owner_uid (owner_uid),
			KEY idx_work_item_id (work_item_id),
			CONSTRAINT fk_weekly_work_item_report FOREIGN KEY (report_id) REFERENCES project_weekly_reports (id) ON DELETE CASCADE,
			CONSTRAINT fk_weekly_work_item_project FOREIGN KEY (project_id) REFERENCES aims_projects (id) ON DELETE CASCADE,
			CONSTRAINT fk_weekly_work_item_work_item FOREIGN KEY (work_item_id) REFERENCES work_items (id) ON DELETE SET NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目周报工作项明细'
	`)
	return err
}

type weeklyReportSummaryColumnDefinition struct {
	name       string
	definition string
}

func projectWeeklyReportSummaryColumnDefinitions() []weeklyReportSummaryColumnDefinition {
	return []weeklyReportSummaryColumnDefinition{
		{name: "department_name", definition: "`department_name` VARCHAR(100) DEFAULT NULL COMMENT '周报汇总口径：隶属部门/小组名称快照' AFTER `overall_progress`"},
		{name: "project_type_name", definition: "`project_type_name` VARCHAR(100) DEFAULT NULL COMMENT '周报汇总口径：项目类型快照' AFTER `department_name`"},
		{name: "project_manager_name", definition: "`project_manager_name` VARCHAR(100) DEFAULT NULL COMMENT '周报汇总口径：项目经理展示名快照' AFTER `project_type_name`"},
		{name: "initiation_status", definition: "`initiation_status` VARCHAR(100) DEFAULT NULL COMMENT '周报汇总口径：立项情况' AFTER `project_manager_name`"},
		{name: "current_stage", definition: "`current_stage` VARCHAR(100) DEFAULT NULL COMMENT '周报汇总口径：当前阶段' AFTER `initiation_status`"},
		{name: "progress_status", definition: "`progress_status` VARCHAR(100) DEFAULT NULL COMMENT '周报汇总口径：进度情况' AFTER `current_stage`"},
		{name: "completion_percent", definition: "`completion_percent` DECIMAL(5,2) DEFAULT NULL COMMENT '周报汇总口径：总体完成进度百分比' AFTER `progress_status`"},
		{name: "contract_status", definition: "`contract_status` VARCHAR(200) DEFAULT NULL COMMENT '周报汇总口径：合同状态' AFTER `completion_percent`"},
		{name: "contract_amount", definition: "`contract_amount` DECIMAL(14,2) DEFAULT NULL COMMENT '周报汇总口径：合同额' AFTER `contract_status`"},
		{name: "payment_status", definition: "`payment_status` VARCHAR(200) DEFAULT NULL COMMENT '周报汇总口径：回款情况' AFTER `contract_amount`"},
		{name: "cumulative_labor_cost", definition: "`cumulative_labor_cost` DECIMAL(14,2) DEFAULT NULL COMMENT '周报汇总口径：累计人力成本' AFTER `payment_status`"},
		{name: "major_risks", definition: "`major_risks` TEXT DEFAULT NULL COMMENT '周报汇总口径：重大问题和风险' AFTER `cumulative_labor_cost`"},
		{name: "coordination_needs", definition: "`coordination_needs` TEXT DEFAULT NULL COMMENT '周报汇总口径：待协调资源' AFTER `major_risks`"},
		{name: "remarks", definition: "`remarks` TEXT DEFAULT NULL COMMENT '周报汇总口径：备注' AFTER `coordination_needs`"},
	}
}

func (a *Adapter) tableColumnExists(ctx context.Context, tableName string, columnName string) (bool, error) {
	var count int
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME = ?
		  AND COLUMN_NAME = ?
	`, tableName, columnName).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

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
		return fmt.Errorf("Aims schema is missing time_entries.weekly_report_id; apply migration_v4.3_project_weekly_reports.sql")
	}

	for _, column := range projectWeeklyReportSummaryColumnDefinitions() {
		exists, err := a.tableColumnExists(ctx, "project_weekly_reports", column.name)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		return fmt.Errorf("Aims schema is missing project_weekly_reports.%s; apply migration_v4.4_project_weekly_report_summary.sql", column.name)
	}

	exists, err := a.tableExists(ctx, "project_weekly_report_work_items")
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("Aims schema is missing project_weekly_report_work_items; apply migration_v4.4_project_weekly_report_summary.sql")
	}
	return nil
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

func (a *Adapter) tableExists(ctx context.Context, tableName string) (bool, error) {
	var count int
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME = ?
	`, tableName).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

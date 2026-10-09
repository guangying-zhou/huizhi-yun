package people

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// 遗留 dt-* 主体的受控归并（People 侧）。
//
// dt-* 是钉钉同步在无法命中既有身份时合成的临时 UID，它已经作为
// employee_uid 进入 People 的任职、成本、绩效、离职和文档引用。归并把这些
// 事实整体迁到 canonical UID，并修复被 UID 污染的工号。

// peopleMergeEmployeeUIDTables 列出以 employee_uid 引用员工的表。
// 新增引用员工的表时必须同步登记，否则归并会留下悬挂引用。
var peopleMergeEmployeeUIDTables = []string{
	"people_assignments",
	"people_cost_snapshots",
	"people_contribution_snapshots",
	"people_directory_lifecycle_versions",
	"people_documents",
	"people_offboarding_cases",
}

// peopleMergeActorColumns 列出以其他列名承载 UID 的**活引用**。
// 只按 *_uid 约定收集会漏掉它们。
//
// 刻意不含 integration_operation 及各表的 created_by / updated_by /
// original_actor_uid：那些记录的是「当时是谁做的」，改写等于篡改审计事实，
// 归并后仍应指向旧 UID。
var peopleMergeActorColumns = []struct{ table, column string }{
	{"people_employees", "manager_uid"},
	{"people_assignments", "manager_uid"},
	{"people_onboarding_cases", "manager_uid"},
	{"people_offboarding_tasks", "responsible_uid"},
	{"people_offboarding_notification_checkpoint", "notified_recipient_uid"},
	{"people_offboarding_notification_checkpoint", "previous_recipient_uid"},
}

// PreviewSubjectMerge 统计将被改写的 People 引用，供管理员在执行前核对。
func (a *Adapter) PreviewSubjectMerge(ctx context.Context, legacyUID, canonicalUID string) (map[string]any, error) {
	legacy := strings.TrimSpace(legacyUID)
	canonical := strings.TrimSpace(canonicalUID)
	if err := validatePeopleMergePair(legacy, canonical); err != nil {
		return nil, err
	}

	references := make([]map[string]any, 0, len(peopleMergeEmployeeUIDTables)+len(peopleMergeActorColumns)+1)
	count, err := a.countMergeReferences(ctx, "people_employees", "employee_uid", legacy)
	if err != nil {
		return nil, err
	}
	references = append(references, map[string]any{"table": "people_employees", "column": "employee_uid", "rows": count})
	for _, table := range peopleMergeEmployeeUIDTables {
		count, err = a.countMergeReferences(ctx, table, "employee_uid", legacy)
		if err != nil {
			return nil, err
		}
		references = append(references, map[string]any{"table": table, "column": "employee_uid", "rows": count})
	}
	for _, ref := range peopleMergeActorColumns {
		count, err = a.countMergeReferences(ctx, ref.table, ref.column, legacy)
		if err != nil {
			return nil, err
		}
		references = append(references, map[string]any{"table": ref.table, "column": ref.column, "rows": count})
	}

	var legacyEmployeeNo, canonicalEmployeeNo sql.NullString
	_ = a.DB().QueryRowContext(ctx, `SELECT employee_no FROM people_employees WHERE employee_uid=?`, legacy).Scan(&legacyEmployeeNo)
	canonicalExists := false
	if err := a.DB().QueryRowContext(ctx, `SELECT employee_no FROM people_employees WHERE employee_uid=?`, canonical).
		Scan(&canonicalEmployeeNo); err == nil {
		canonicalExists = true
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	return map[string]any{
		"legacyUid": legacy, "canonicalUid": canonical,
		"references":              references,
		"legacyEmployeeNo":        legacyEmployeeNo.String,
		"canonicalEmployeeExists": canonicalExists,
		// 工号等于 UID 说明钉钉当时没有下发工号，退化成了合成值，必须一并修复。
		"employeeNoPolluted": strings.EqualFold(strings.TrimSpace(legacyEmployeeNo.String), legacy),
	}, nil
}

// MergeSubjectReferences 在单事务内把 People 侧的全部引用迁到 canonical UID。
//
// 只在 canonical 尚无员工行时自动执行：两个都已存在意味着同一个人有两份
// 独立的任职与成本事实，合并口径不是这里能自动判定的，必须人工处理。
func (a *Adapter) MergeSubjectReferences(
	ctx context.Context,
	legacyUID string,
	canonicalUID string,
	employeeNo string,
	actor string,
) (map[string]any, error) {
	legacy := strings.TrimSpace(legacyUID)
	canonical := strings.TrimSpace(canonicalUID)
	if err := validatePeopleMergePair(legacy, canonical); err != nil {
		return nil, err
	}
	if strings.TrimSpace(actor) == "" {
		return nil, httperror.New(http.StatusForbidden, "people_merge_actor_required", "A verified actor is required")
	}

	conn, err := a.DB().Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var legacyEmployeeNo string
	err = tx.QueryRowContext(ctx, `SELECT employee_no FROM people_employees
		WHERE employee_uid=? FOR UPDATE`, legacy).Scan(&legacyEmployeeNo)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "people_merge_legacy_missing",
			"The legacy dt-* employee was not found")
	}
	if err != nil {
		return nil, err
	}
	var canonicalExists int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM people_employees
		WHERE employee_uid=?`, canonical).Scan(&canonicalExists); err != nil {
		return nil, err
	}
	if canonicalExists > 0 {
		return nil, httperror.New(http.StatusConflict, "people_merge_canonical_employee_exists",
			"The canonical UID already has an employee record; resolve the duplicate manually before merging")
	}

	// 工号被 UID 污染时必须一并修复，否则 uk_people_employee_no 会长期保留
	// 一个 dt-* 值。调用方未提供真实工号时保持原值不动，不擅自编造。
	nextEmployeeNo := strings.TrimSpace(employeeNo)
	if nextEmployeeNo == "" {
		nextEmployeeNo = legacyEmployeeNo
	}

	// people_employees.employee_uid 被多张子表外键引用，直接改父行会报
	// 1451 Cannot delete or update a parent row。事务内临时关闭外键检查，
	// 但必须在提交前恢复；提交后的 sql.Tx 已不可执行，不能依赖 defer 恢复。
	var previousFKChecks int
	if err = tx.QueryRowContext(ctx, `SELECT @@SESSION.foreign_key_checks`).Scan(&previousFKChecks); err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `SET SESSION foreign_key_checks = 0`); err != nil {
		return nil, err
	}
	fkChecksRestored := false
	defer func() {
		// 事务回滚时同一连接可能被复用，必须恢复，否则会话会带着关闭的
		// 外键检查继续服务后续请求。恢复使用独立的短时 context；请求取消
		// 正是最需要补偿的路径，不能继续复用已经 cancelled 的 ctx。先显式
		// 回滚，再通过仍被独占的 sql.Conn 恢复，最后才允许连接回池。
		if !fkChecksRestored {
			_ = tx.Rollback()
			_ = restorePeopleForeignKeyChecks(conn, previousFKChecks)
		}
	}()

	if _, err = tx.ExecContext(ctx, `UPDATE people_employees
		SET employee_uid=?, employee_no=?, login_name=?, updated_by=?, updated_at=NOW()
		WHERE employee_uid=?`, canonical, nextEmployeeNo, canonical, strings.TrimSpace(actor), legacy); err != nil {
		return nil, err
	}

	migrated := make([]map[string]any, 0, len(peopleMergeEmployeeUIDTables)+len(peopleMergeActorColumns))
	for _, table := range peopleMergeEmployeeUIDTables {
		affected, execErr := execMergeUpdate(ctx, tx, table, "employee_uid", canonical, legacy)
		if execErr != nil {
			return nil, execErr
		}
		migrated = append(migrated, map[string]any{"table": table, "column": "employee_uid", "rows": affected})
	}
	for _, ref := range peopleMergeActorColumns {
		affected, execErr := execMergeUpdate(ctx, tx, ref.table, ref.column, canonical, legacy)
		if execErr != nil {
			return nil, execErr
		}
		migrated = append(migrated, map[string]any{"table": ref.table, "column": ref.column, "rows": affected})
	}

	// 提交前确认每一张员工子表都没有孤儿引用：关闭外键检查期间数据库不会替我们把关。
	for _, table := range peopleMergeEmployeeUIDTables {
		var orphans int
		query := "SELECT COUNT(*) FROM `" + table + "` child LEFT JOIN people_employees employee " +
			"ON employee.employee_uid=child.employee_uid WHERE child.employee_uid IS NOT NULL AND employee.employee_uid IS NULL"
		if err = tx.QueryRowContext(ctx, query).Scan(&orphans); err != nil {
			return nil, err
		}
		if orphans > 0 {
			return nil, httperror.New(http.StatusConflict, "people_merge_orphan_references",
				"Merging would leave employee references without an employee; aborted")
		}
	}
	if err = restorePeopleForeignKeyChecks(tx, previousFKChecks); err != nil {
		return nil, err
	}
	fkChecksRestored = true
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"legacyUid": legacy, "canonicalUid": canonical,
		"employeeNo": nextEmployeeNo, "migrated": migrated,
	}, nil
}

type peopleMergeSessionExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func restorePeopleForeignKeyChecks(executor peopleMergeSessionExecutor, value int) error {
	restoreCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := executor.ExecContext(restoreCtx, `SET SESSION foreign_key_checks = ?`, value)
	return err
}

// execMergeUpdate 用白名单里的表名与列名拼接 UPDATE。表名和列名不能参数化，
// 因此二者只允许来自本文件的固定清单，绝不接受调用方输入。
func execMergeUpdate(ctx context.Context, tx *sql.Tx, table, column, canonical, legacy string) (int64, error) {
	result, err := tx.ExecContext(ctx,
		"UPDATE `"+table+"` SET `"+column+"`=? WHERE `"+column+"`=?", canonical, legacy)
	if err != nil {
		return 0, err
	}
	affected, _ := result.RowsAffected()
	return affected, nil
}

func (a *Adapter) countMergeReferences(ctx context.Context, table, column, uid string) (int64, error) {
	var count int64
	err := a.DB().QueryRowContext(ctx,
		"SELECT COUNT(*) FROM `"+table+"` WHERE `"+column+"`=?", uid).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

func validatePeopleMergePair(legacy, canonical string) error {
	if legacy == "" || canonical == "" {
		return httperror.New(http.StatusBadRequest, "people_merge_uid_required",
			"Both the legacy and canonical UID are required")
	}
	if legacy == canonical {
		return httperror.New(http.StatusBadRequest, "people_merge_same_uid",
			"The legacy and canonical UID must differ")
	}
	if !strings.HasPrefix(strings.ToLower(legacy), "dt-") {
		return httperror.New(http.StatusBadRequest, "people_merge_legacy_not_synthetic",
			"Only a synthetic dt-* subject can be merged away")
	}
	if strings.HasPrefix(strings.ToLower(canonical), "dt-") {
		return httperror.New(http.StatusBadRequest, "people_merge_canonical_synthetic",
			"A synthetic dt-* identifier cannot be the merge target")
	}
	return nil
}

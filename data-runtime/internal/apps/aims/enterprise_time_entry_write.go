package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"strconv"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type enterpriseTimeEntryTxKey struct{}
type timeEntrySQL interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (a *Adapter) timeEntryDB(ctx context.Context) timeEntrySQL {
	if tx, ok := ctx.Value(enterpriseTimeEntryTxKey{}).(*sql.Tx); ok {
		return tx
	}
	return a.DB()
}

// The authenticated server installs scope; independent Aims keeps its original lane.
// The signed timesheet submit grant is additional to the existing member/owner rules.
func enterpriseTimeEntryWrite[T any](a *Adapter, ctx context.Context, projectID, entryID string, query url.Values, write func(context.Context) (T, error), receipt ...timeEntryReceiptConfig[T]) (T, error) {
	id, enabled := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !enabled {
		return write(ctx)
	}
	var zero T
	if id.ActorUID != query.Get("current_user") || id.CommandScope == nil {
		return zero, httperror.New(403, "enterprise_project_command_scope_invalid", "Project write authorization is invalid")
	}
	if _, err := parseID(projectID, "project_id"); err != nil {
		return zero, err
	}
	tx, repo, err := a.beginTimeEntryWrite(ctx, id)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()
	if err = requireEnterpriseProjectCommandScopeTx(ctx, tx, id, projectID, "", "time-entry"); err != nil {
		return zero, err
	}
	ctx = context.WithValue(ctx, enterpriseTimeEntryTxKey{}, tx)
	if err = a.requireProjectTimesheetAccess(ctx, projectID, id.ActorUID, query); err != nil {
		return zero, err
	}
	if entryID != "" {
		if _, err = parseID(entryID, "time_entry_id"); err != nil {
			return zero, err
		}
		var actualProject, owner string
		err = tx.QueryRowContext(ctx, "SELECT project_id,uid FROM time_entries WHERE id=? FOR UPDATE", entryID).Scan(&actualProject, &owner)
		if err == sql.ErrNoRows || (err == nil && actualProject != projectID) {
			return zero, httperror.New(404, "record_not_found", "time entry not found")
		}
		if err != nil {
			return zero, err
		}
		if owner != id.ActorUID {
			return zero, httperror.New(403, "forbidden_time_entry_owner", "Only the owner can change this time entry")
		}
	}
	var result T
	if len(receipt) > 0 && repo != nil {
		result, err = executeTimeEntryReceipt(ctx, tx, repo, receipt[0], write)
	} else {
		result, err = write(ctx)
	}
	if err != nil {
		return zero, err
	}
	if err = tx.Commit(); err != nil {
		return zero, err
	}
	return result, nil
}

// Work-item time entries share the project timesheet grant, but their owning
// project must come from the locked work item rather than a browser field.
func enterpriseWorkItemTimeEntryWrite[T any](a *Adapter, ctx context.Context, workItemID, entryID string, query url.Values, write func(context.Context) (T, error), receipt ...timeEntryReceiptConfig[T]) (T, error) {
	id, enabled := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !enabled {
		return write(ctx)
	}
	var zero T
	if id.ActorUID != query.Get("current_user") || id.CommandScope == nil {
		return zero, httperror.New(403, "enterprise_project_command_scope_invalid", "Project write authorization is invalid")
	}
	_, owningProjectID, err := a.commitTargetWorkItemProject(ctx, workItemID)
	if err != nil {
		return zero, err
	}
	projectID := strconv.FormatInt(owningProjectID, 10)
	tx, repo, err := a.beginTimeEntryWrite(ctx, id)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()
	if err := requireEnterpriseProjectCommandScopeTx(ctx, tx, id, projectID, workItemID, "time-entry"); err != nil {
		return zero, err
	}
	if entryID != "" {
		if _, err := parseID(entryID, "time_entry_id"); err != nil {
			return zero, err
		}
		var entryProjectID, entryWorkItemID, owner string
		err := tx.QueryRowContext(ctx, "SELECT project_id,work_item_id,uid FROM time_entries WHERE id=? FOR UPDATE", entryID).Scan(&entryProjectID, &entryWorkItemID, &owner)
		if err == sql.ErrNoRows || (err == nil && (entryProjectID != projectID || entryWorkItemID != workItemID)) {
			return zero, httperror.New(404, "record_not_found", "time entry not found")
		}
		if err != nil {
			return zero, err
		}
		if owner != id.ActorUID {
			return zero, httperror.New(403, "forbidden_time_entry_owner", "Only the owner can change this time entry")
		}
	}
	if err := requireEnterpriseDeliverableProjectScopeTx(ctx, tx, id.ActorUID, owningProjectID, false); err != nil {
		return zero, err
	}
	ctx = context.WithValue(ctx, enterpriseTimeEntryTxKey{}, tx)
	var result T
	if len(receipt) > 0 && repo != nil {
		result, err = executeTimeEntryReceipt(ctx, tx, repo, receipt[0], write)
	} else {
		result, err = write(ctx)
	}
	if err != nil {
		return zero, err
	}
	if err := tx.Commit(); err != nil {
		return zero, err
	}
	return result, nil
}
func (a *Adapter) createProjectTimeEntry(ctx context.Context, projectID string, query url.Values, body map[string]any) (timeEntryItem, error) {
	return enterpriseTimeEntryWrite(a, ctx, projectID, "", query, func(ctx context.Context) (timeEntryItem, error) {
		return a.createProjectTimeEntryBody(ctx, projectID, query, body)
	}, timeEntryReceiptConfig[timeEntryItem]{Action: "project-create", Capability: "aims:project-time-entries:edit", Command: map[string]any{"projectId": projectID, "payload": body}, BizCode: timeEntryIDCode, Replay: func(ctx context.Context, code string) (timeEntryItem, error) { return timeEntryReplay(a, ctx, code) }, Decorate: decorateTimeEntry})
}
func (a *Adapter) updateProjectTimeEntry(ctx context.Context, projectID, entryID string, query url.Values, body map[string]any) (timeEntryItem, error) {
	return enterpriseTimeEntryWrite(a, ctx, projectID, entryID, query, func(ctx context.Context) (timeEntryItem, error) {
		return a.updateProjectTimeEntryBody(ctx, projectID, entryID, query, body)
	}, timeEntryReceiptConfig[timeEntryItem]{Action: "project-update", Capability: "aims:project-time-entries:edit", Command: map[string]any{"projectId": projectID, "entryId": entryID, "payload": body}, BizCode: timeEntryIDCode, Replay: func(ctx context.Context, code string) (timeEntryItem, error) { return timeEntryReplay(a, ctx, code) }, Decorate: decorateTimeEntry})
}
func (a *Adapter) deleteProjectTimeEntry(ctx context.Context, projectID, entryID string, query url.Values) (map[string]any, error) {
	result, err := enterpriseTimeEntryWrite(a, ctx, projectID, entryID, query, func(ctx context.Context) (map[string]any, error) {
		return a.deleteProjectTimeEntryBody(ctx, projectID, entryID, query)
	}, timeEntryReceiptConfig[map[string]any]{Action: "project-delete", Capability: "aims:project-time-entries:edit", Command: map[string]any{"projectId": projectID, "entryId": entryID}, BizCode: func(map[string]any) string { return projectID }, Replay: func(context.Context, string) (map[string]any, error) {
		return map[string]any{"id": entryID, "deleted": true}, nil
	}, Decorate: decorateTimeEntryDelete})
	var missing httperror.Error
	if errors.As(err, &missing) && missing.Status == 404 && validDeliverableReceiptIdentity(ctx) {
		return a.replayDeletedProjectTimeEntry(ctx, projectID, entryID, query)
	}
	return result, err
}

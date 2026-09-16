package people

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type directoryLifecyclePrepareCursor struct {
	EmployeeID int64 `json:"employeeId"`
}

type directoryLifecycleDueEmployee struct {
	ID  int64
	UID string
}

func (a *Adapter) prepareDueDirectoryLifecycle(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := requirePeopleIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, _, err := trustedPeopleIntegrationWorker(body)
	if err != nil {
		return nil, err
	}
	asOfText := strings.TrimSpace(cleanBodyString(body, "asOf"))
	asOf, err := time.Parse(time.RFC3339, asOfText)
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "directory_lifecycle_as_of_invalid", "asOf must be an explicit RFC3339 timestamp")
	}
	limit, err := strconv.Atoi(strings.TrimSpace(fmt.Sprint(body["limit"])))
	if err != nil || limit < 1 || limit > 100 {
		return nil, httperror.New(http.StatusBadRequest, "directory_lifecycle_limit_invalid", "limit must be between 1 and 100")
	}
	cursor, err := decodeDirectoryLifecyclePrepareCursor(strings.TrimSpace(cleanBodyString(body, "cursor")))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "directory_lifecycle_cursor_invalid", "cursor is invalid")
	}
	employees, err := a.queryDueDirectoryLifecycleEmployees(ctx, asOf, cursor.EmployeeID, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(employees) > limit
	if hasMore {
		employees = employees[:limit]
	}
	created, reused := 0, 0
	for _, employee := range employees {
		tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
		if err != nil {
			return nil, err
		}
		metadata, freezeErr := a.freezeDirectoryLifecycleOperationAtTx(ctx, tx, employee.UID, trusted, "", trusted.ServiceClientID, asOf)
		if freezeErr != nil {
			_ = tx.Rollback()
			return nil, freezeErr
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		lifecycle, _ := metadata["directoryLifecycle"].(map[string]any)
		if idempotent, _ := lifecycle["idempotent"].(bool); idempotent {
			reused++
		} else {
			created++
		}
	}
	result := map[string]any{
		"asOf": asOf.UTC().Format(time.RFC3339), "scanned": len(employees),
		"created": created, "reused": reused,
	}
	if hasMore && len(employees) > 0 {
		nextCursor, err := encodeDirectoryLifecyclePrepareCursor(directoryLifecyclePrepareCursor{EmployeeID: employees[len(employees)-1].ID})
		if err != nil {
			return nil, err
		}
		result["nextCursor"] = nextCursor
	}
	return result, nil
}

func (a *Adapter) queryDueDirectoryLifecycleEmployees(ctx context.Context, asOf time.Time, afterEmployeeID int64, limit int) ([]directoryLifecycleDueEmployee, error) {
	rows, err := a.DB().QueryContext(ctx, `SELECT e.id,e.employee_uid FROM people_employees e WHERE e.archived_at IS NULL AND e.id>? AND EXISTS (SELECT 1 FROM people_assignments a WHERE a.employee_uid=e.employee_uid AND a.approval_status IN ('none','approved') AND a.effective_from<=?) ORDER BY e.id LIMIT ?`, afterEmployeeID, asOf.UTC().Format("2006-01-02"), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	employees := make([]directoryLifecycleDueEmployee, 0)
	for rows.Next() {
		var employee directoryLifecycleDueEmployee
		if err := rows.Scan(&employee.ID, &employee.UID); err != nil {
			return nil, err
		}
		employees = append(employees, employee)
	}
	return employees, rows.Err()
}

func encodeDirectoryLifecyclePrepareCursor(cursor directoryLifecyclePrepareCursor) (string, error) {
	encoded, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

func decodeDirectoryLifecyclePrepareCursor(value string) (directoryLifecyclePrepareCursor, error) {
	if value == "" {
		return directoryLifecyclePrepareCursor{}, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return directoryLifecyclePrepareCursor{}, err
	}
	var cursor directoryLifecyclePrepareCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.EmployeeID <= 0 {
		return directoryLifecyclePrepareCursor{}, fmt.Errorf("invalid directory lifecycle cursor")
	}
	return cursor, nil
}

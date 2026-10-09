package aims

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/projectcost"
)

// ProjectCostInputs is an owning read port. Tables come only from a generation-
// fenced Registry resolved domain, never from a browser or generic SQL request.
type ProjectCostInputs struct{ Table func(string) (string, error) }

func (a ProjectCostInputs) ReadProjectTimeInputs(ctx context.Context, tx *sql.Tx, p projectcost.Period) (projectcost.TimeInputs, error) {
	out := projectcost.TimeInputs{Entries: []projectcost.TimeEntry{}}
	projects, e := a.Table("aims_projects")
	if e != nil {
		return out, e
	}
	entries, e := a.Table("time_entries")
	if e != nil {
		return out, e
	}
	if e = tx.QueryRowContext(ctx, "SELECT id FROM "+projects+" WHERE BINARY project_code=BINARY ? FOR UPDATE", p.ProjectCode).Scan(&out.ProjectID); e != nil {
		return out, e
	}
	// REPEATABLE READ next-key locks protect empty ranges and all review states.
	rows, e := tx.QueryContext(ctx, "SELECT id,uid,CAST(entry_date AS CHAR),CAST(hours AS CHAR),review_status,CAST(row_version AS CHAR) FROM "+entries+" FORCE INDEX(idx_project_date) WHERE project_id=? AND entry_date>=? AND entry_date<=? ORDER BY entry_date,id FOR UPDATE", out.ProjectID, p.Start.Format("2006-01-02"), p.End.Format("2006-01-02"))
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var v projectcost.TimeEntry
		if e = rows.Scan(&v.ID, &v.EmployeeUID, &v.Date, &v.Hours, &v.ReviewStatus, &v.Version); e != nil {
			return out, e
		}
		out.Entries = append(out.Entries, v)
	}
	if e = rows.Err(); e != nil {
		return out, e
	}
	out.SHA256 = projectcost.Hash(struct {
		Project string
		Month   string
		Entries []projectcost.TimeEntry
	}{p.ProjectCode, p.Month, out.Entries})
	return out, nil
}

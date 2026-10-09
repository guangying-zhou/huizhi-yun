package console

import (
	"context"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/projectcost"
	"time"
)

// Calendar facts are read outside the business transaction and scanned as
// decimal strings, bypassing the historical float64 HTTP display projection.
func (a *Adapter) ReadCNMonth(ctx context.Context, month string) (projectcost.CalendarInput, error) {
	if _, e := projectcost.NewPeriod("calendar", month); e != nil {
		return projectcost.CalendarInput{}, e
	}
	out := projectcost.CalendarInput{Code: "CN", Month: month, RetrievedAt: time.Now().UTC()}
	var revision uint64
	e := a.db.QueryRowContext(ctx, "SELECT CAST(standard_work_hours AS CHAR),CAST(standard_hours_per_day AS CHAR),workday_count,revision FROM work_calendar_months WHERE calendar_code='CN' AND "+yearMonthIdentifier+"=?", month).Scan(&out.StandardHours, &out.HoursPerDay, &out.WorkdayCount, &revision)
	if e != nil {
		return projectcost.CalendarInput{}, e
	}
	out.SourceVersion = fmt.Sprint(revision)
	out.SHA256 = projectcost.Hash(struct {
		Code, Month, Hours, PerDay, Version string
		Days                                int
	}{out.Code, out.Month, out.StandardHours, out.HoursPerDay, out.SourceVersion, out.WorkdayCount})
	return out, nil
}

// Package projectcost defines narrow owning read contracts. It contains no
// transport authentication, SQL table routing, user-supplied trust flags or writes.
package projectcost

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"time"
)

const FormulaVersion = "std_labor_calendar_hours_v1"

type Period struct {
	ProjectCode, Month string
	Start, End         time.Time
}

func NewPeriod(project, month string) (Period, error) {
	start, err := time.Parse("2006-01", month)
	if err != nil || len(month) != 7 || !regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`).MatchString(project) {
		return Period{}, fmt.Errorf("invalid project cost period")
	}
	return Period{project, month, start, start.AddDate(0, 1, 0).AddDate(0, 0, -1)}, nil
}

// Decimal inputs remain strings: no float conversion at the owning boundary.
type TimeEntry struct {
	ID                                              int64
	EmployeeUID, Date, Hours, ReviewStatus, Version string
}
type TimeInputs struct {
	ProjectID int64
	Entries   []TimeEntry
	SHA256    string
}
type PersonInput struct {
	EmployeeUID, EmployeeVersion, AssignmentCode, AssignmentVersion                 string
	DepartmentCode, PositionCode, RankCode, EmploymentType, CostCenterCode          string
	RateCode, RateVersion, RateCurrency, RankSalary, PerformanceMin, PerformanceMax string
	PeopleSnapshotCode                                                              string // optional; absence never causes a People write
	MissingReason                                                                   string
}
type ParameterInput struct{ Code, Version, Currency, EffectiveDate, BaseSalary, WelfareRate, ManagementRate, ResourceCost string }
type CalendarInput struct {
	Code, Month, StandardHours, HoursPerDay, SHA256, SourceVersion string
	WorkdayCount                                                   int
	RetrievedAt                                                    time.Time
}

// Owning adapters must lock input scopes in the documented global order, on
// this exact caller transaction. They may neither open a transaction nor call
// the network. Authority is resolved by the orchestrator, never by trusted bools.
// Aims includes ALL review states; Finance determines not_ready from them.
type AimsInputs interface {
	ReadProjectTimeInputs(context.Context, *sql.Tx, Period) (TimeInputs, error)
}

// UIDs are the frozen Aims set in sorted order; asOf is the period end.
type PeopleInputs interface {
	ReadStandardCostInputs(context.Context, *sql.Tx, []string, time.Time) ([]PersonInput, error)
}
type FinanceInputs interface {
	ReadCostParameterInput(context.Context, *sql.Tx, time.Time) (ParameterInput, error)
}

// Calendar is read before any business transaction and frozen into the batch.
type CalendarReader interface {
	ReadCNMonth(context.Context, string) (CalendarInput, error)
}

// PublicSummary is deliberately distinct from sensitive owning inputs. Host
// responses must use this closed shape; rank/salary and frozen inputs stay server-side.
type PublicSummary struct {
	ProjectCode     string   `json:"projectCode"`
	PeriodMonth     string   `json:"periodMonth"`
	Currency        string   `json:"currency"`
	LaborCostAmount *string  `json:"laborCostAmount"`
	Readiness       string   `json:"readiness"`
	MissingInputs   []string `json:"missingInputs"`
	BatchCode       string   `json:"batchCode"`
}

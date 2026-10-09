package people

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strings"
)

func OnboardingColumns() []string {
	return []string{"id", "onboarding_code", "provider_code", "has_reservation", "candidate_name", "planned_onboard_date", "employee_no", "dept_code", "position_code", "rank_code", "employment_type", "canonical_uid", "corporate_email", "manager_uid", "status", "object_version"}
}
func FactsOnboardingWriteTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), op string, i EnterpriseFactsInput, who FactsContext) (map[string]any, error) {
	cases, e := table("people_onboarding_cases")
	if e != nil {
		return nil, e
	}
	fields := map[string]any{}
	for k, v := range i.Payload {
		if k != "expectedVersion" {
			fields[k] = v
		}
	}
	id := i.ID
	version := int64(1)
	if id == "" {
		uid := uuid.NewString()
		fields["onboarding_code"] = "ONB-" + strings.ReplaceAll(uid, "-", "")
		fields["provider_code"] = "manual"
		fields["provider_subject"] = uid
		fields["status"] = "awaiting_profile"
		fields["created_by"] = who.Actor
		fields["updated_by"] = who.Actor
		fields["employee_no"], e = factsNumberTx(ctx, tx, table)
		if e != nil {
			return nil, e
		}
		if fields["employment_type"] == nil || fields["employment_type"] == "" {
			fields["employment_type"] = "full_time"
		}
		if id, e = factsInsertTx(ctx, tx, cases, fields); e != nil {
			return nil, e
		}
	} else {
		row, e := FactsRowTx(ctx, tx, cases, "id=?", id)
		if e != nil {
			return nil, e
		}
		if !onboardingEditableStatuses[fmt.Sprint(row["status"])] {
			return nil, httperror.New(409, "onboarding_status_not_editable", "Onboarding case frozen")
		}
		// c1 never sets reserving/provisioning/activated/completed. Account identifiers
		// are only proposed HR facts here, not verified reservations.
		if fmt.Sprint(row["object_version"]) != fmt.Sprint(FactsVersion(i.Payload)) {
			return nil, httperror.New(409, "people_version_conflict", "Version changed")
		}
		keys := []string{}
		for k := range fields {
			keys = append(keys, k)
		}
		sortStrings(keys)
		sets := []string{}
		args := []any{}
		for _, k := range keys {
			sets = append(sets, k+"=NULLIF(?,'')")
			args = append(args, fields[k])
		}
		sets = append(sets, "status='awaiting_profile'", "object_version=object_version+1", "updated_by=?")
		args = append(args, who.Actor, id, FactsVersion(i.Payload))
		if _, e = tx.ExecContext(ctx, "UPDATE "+cases+" SET "+strings.Join(sets, ",")+" WHERE id=? AND object_version=?", args...); e != nil {
			return nil, e
		}
		version = FactsVersion(i.Payload) + 1
	}
	return map[string]any{"id": id, "row_version": version, "status": "awaiting_profile"}, nil
}

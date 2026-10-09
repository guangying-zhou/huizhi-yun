package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var singleServiceYearLabel = regexp.MustCompile(`^\d{4}$`)

type serviceYearInput struct {
	LineCode    any
	PeriodSeq   any
	PeriodStart any
	PeriodEnd   any
	PeriodLabel any
}

func normalizeServiceYearInput(category string, body map[string]any, requireForMaintenance bool) (serviceYearInput, error) {
	lineCode := firstBodyText(body, "serviceLineCode", "service_line_code")
	periodStart := firstBodyText(body, "servicePeriodStart", "service_period_start")
	periodEnd := firstBodyText(body, "servicePeriodEnd", "service_period_end")
	periodLabel := firstBodyText(body, "servicePeriodLabel", "service_period_label")
	periodSeq, periodSeqPresent, err := optionalBodyID(body, "servicePeriodSeq", "service_period_seq")
	if err != nil {
		return serviceYearInput{}, httperror.New(http.StatusBadRequest, "invalid_service_period_seq", "servicePeriodSeq must be a positive integer")
	}
	hasAny := lineCode != "" || periodStart != "" || periodEnd != "" || periodLabel != "" || periodSeqPresent
	if category != "maintenance" {
		if hasAny {
			return serviceYearInput{}, httperror.New(http.StatusBadRequest, "service_year_category_required", "service year fields are only supported for maintenance projects")
		}
		return serviceYearInput{}, nil
	}
	if !hasAny && !requireForMaintenance {
		return serviceYearInput{}, nil
	}
	if lineCode == "" || periodSeq <= 0 || periodStart == "" || periodEnd == "" || periodLabel == "" {
		return serviceYearInput{}, httperror.New(http.StatusBadRequest, "service_year_fields_required", "maintenance projects require serviceLineCode, servicePeriodSeq, servicePeriodStart, servicePeriodEnd and servicePeriodLabel")
	}
	if err := validateServiceYearValues(periodStart, periodEnd, periodLabel); err != nil {
		return serviceYearInput{}, err
	}
	return serviceYearInput{
		LineCode: nullableText(lineCode), PeriodSeq: periodSeq,
		PeriodStart: nullableText(periodStart), PeriodEnd: nullableText(periodEnd), PeriodLabel: nullableText(periodLabel),
	}, nil
}

func validateServiceYearValues(periodStart string, periodEnd string, periodLabel string) error {
	start, err := time.Parse("2006-01-02", strings.TrimSpace(periodStart))
	if err != nil {
		return httperror.New(http.StatusBadRequest, "invalid_service_period_start", "servicePeriodStart must use YYYY-MM-DD")
	}
	end, err := time.Parse("2006-01-02", strings.TrimSpace(periodEnd))
	if err != nil {
		return httperror.New(http.StatusBadRequest, "invalid_service_period_end", "servicePeriodEnd must use YYYY-MM-DD")
	}
	if end.Before(start) {
		return httperror.New(http.StatusBadRequest, "invalid_service_period_range", "servicePeriodEnd cannot be earlier than servicePeriodStart")
	}
	naturalYear := start.Month() == time.January && start.Day() == 1 && end.Month() == time.December && end.Day() == 31 && start.Year() == end.Year()
	if !naturalYear && singleServiceYearLabel.MatchString(strings.TrimSpace(periodLabel)) {
		return httperror.New(http.StatusBadRequest, "ambiguous_service_period_label", "non-calendar service periods cannot use a single year as the display label")
	}
	return nil
}

func validateServiceYearProjectTx(ctx context.Context, tx *sql.Tx, projectID string) error {
	var category string
	var lineCode, periodStart, periodEnd, periodLabel sql.NullString
	var periodSeq sql.NullInt64
	err := tx.QueryRowContext(ctx, `
		SELECT category, service_line_code, service_period_seq,
		       DATE_FORMAT(service_period_start, '%Y-%m-%d'),
		       DATE_FORMAT(service_period_end, '%Y-%m-%d'), service_period_label
		FROM aims_projects WHERE id = ? FOR UPDATE
	`, projectID).Scan(&category, &lineCode, &periodSeq, &periodStart, &periodEnd, &periodLabel)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	if err != nil {
		return err
	}
	hasAny := lineCode.Valid || periodSeq.Valid || periodStart.Valid || periodEnd.Valid || periodLabel.Valid
	if category != "maintenance" {
		if hasAny {
			return httperror.New(http.StatusBadRequest, "service_year_category_required", "service year fields are only supported for maintenance projects")
		}
		return nil
	}
	if !hasAny {
		return nil // 兼容迁移前既有维保项目；一旦开始填写必须完整。
	}
	if !lineCode.Valid || !periodSeq.Valid || periodSeq.Int64 <= 0 || !periodStart.Valid || !periodEnd.Valid || !periodLabel.Valid {
		return httperror.New(http.StatusBadRequest, "service_year_fields_required", "service year fields must be provided together")
	}
	if err := validateServiceYearValues(periodStart.String, periodEnd.String, periodLabel.String); err != nil {
		return err
	}
	var duplicate int64
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM aims_projects
		WHERE service_line_code = ? AND service_period_seq = ? AND id <> ? AND lifecycle_status <> 'archived'
	`, lineCode.String, periodSeq.Int64, projectID).Scan(&duplicate); err != nil {
		return err
	}
	if duplicate > 0 {
		return httperror.New(http.StatusConflict, "service_period_seq_exists", fmt.Sprintf("service period %d already exists in this service line", periodSeq.Int64))
	}
	return nil
}

package aims

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	opportunityProjectOperation  = "altoc.opportunity.aims-project.v1"
	opportunityProjectCapability = "aims:project:create-from-opportunity"
)

func (a *Adapter) createProjectFromOpportunityCommand(ctx context.Context, body map[string]any) (map[string]any, error) {
	if _, ok := body[integrationoperation.ServiceCommandEnvelopeKey]; !ok {
		return nil, httperror.New(http.StatusBadRequest, "service_command_required", "serviceCommand envelope is required")
	}
	return a.executeAimsServiceReceipt(ctx, body, opportunityProjectOperation, opportunityProjectCapability, func(ctx context.Context, tx *sql.Tx, command map[string]any) (map[string]any, string, string, error) {
		result, err := a.createProjectFromOpportunityTx(ctx, tx, command)
		if err != nil {
			return nil, "", "", err
		}
		project, _ := result["project"].(map[string]any)
		projectCode := strings.TrimSpace(fmt.Sprint(project["project_code"]))
		if projectCode == "" || projectCode == "<nil>" {
			return nil, "", "", httperror.New(http.StatusUnprocessableEntity, "project_code_missing", "created project did not return project_code")
		}
		return result, "project", projectCode, nil
	})
}

func (a *Adapter) createProjectFromOpportunityTx(ctx context.Context, tx *sql.Tx, body map[string]any) (map[string]any, error) {
	oppID, err := bodyInt64(body, "oppId", "opp_id", "opportunityId", "opportunity_id")
	if err != nil || oppID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_opportunity_id", "oppId must be a positive integer")
	}
	category := strings.TrimSpace(firstBodyText(body, "category"))
	if category != "presales" && category != "sales" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_opportunity_project_category", "category must be presales or sales")
	}
	name := strings.TrimSpace(firstNonEmptyText(firstBodyText(body, "projectName", "project_name"), firstBodyText(body, "name")))
	leaderUID := strings.TrimSpace(firstBodyText(body, "leaderUid", "leader_uid", "ownerUserId", "owner_user_id"))
	customerCode := strings.TrimSpace(firstBodyText(body, "customerCode", "customer_code"))
	customerName := strings.TrimSpace(firstBodyText(body, "customerName", "customer_name"))
	startDate := strings.TrimSpace(firstBodyText(body, "startDate", "start_date", "estimatedStart", "estimated_start"))
	endDate := strings.TrimSpace(firstBodyText(body, "endDate", "end_date", "estimatedEnd", "estimated_end"))
	if name == "" || leaderUID == "" || customerCode == "" || customerName == "" || !validOpportunityProjectPeriod(startDate, endDate) {
		return nil, httperror.New(http.StatusBadRequest, "incomplete_opportunity_project", "projectName, leaderUid, customerCode, customerName and a valid estimated period are required")
	}

	existing, err := opportunityProjectTx(ctx, tx, oppID, category, true)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return map[string]any{"project": existing, "created": false, "idempotent": true}, nil
	}

	requestedTemplateVersionID, err := int64BodyValueOrZero(body, "templateVersionId", "template_version_id")
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_template_version_id", "templateVersionId must be a positive integer")
	}
	templateVersion, err := resolveProjectTemplateVersionTx(ctx, tx, category, requestedTemplateVersionID)
	if err != nil {
		return nil, err
	}

	baseCode := fmt.Sprintf("OPP%d%s", oppID, map[string]string{"presales": "PS", "sales": "SA"}[category])
	projectCode, err := a.reserveProjectCode(ctx, tx, firstNonEmptyText(firstBodyText(body, "projectCode", "project_code"), baseCode), true)
	if err != nil {
		return nil, err
	}
	createdBy := firstNonEmptyText(firstBodyText(body, "createdBy", "created_by"), firstBodyText(body, "operator_uid", "current_user"), "system")
	lifecycleStatus := allowedProjectLifecycle(firstBodyText(body, "lifecycleStatus", "lifecycle_status"), "active")
	project, err := createServiceProjectTx(ctx, tx, serviceProjectCreation{
		ProjectCode: projectCode, Name: name, ShortName: firstNonEmptyText(firstBodyText(body, "shortName", "short_name"), truncateAimsText(name, 50)),
		Description: firstBodyText(body, "description", "remark"), Category: category,
		Methodology: firstNonEmptyText(firstBodyText(body, "methodology"), "PIVR"), LifecycleStatus: lifecycleStatus,
		PortfolioID: nullableOptionalID(body, "portfolioId", "portfolio_id"), DomainCode: firstBodyText(body, "domainCode", "domain_code"),
		DeptCode: firstBodyText(body, "deptCode", "dept_code", "ownerDeptCode", "owner_dept_code"), LeaderUID: leaderUID,
		SecurityLevel:        firstNonEmptyText(firstBodyText(body, "securityLevel", "security_level"), "company"),
		ConfidentialityLevel: firstNonEmptyText(firstBodyText(body, "confidentialityLevel", "confidentiality_level"), "L1"),
		StartDate:            startDate, EndDate: endDate, OppID: oppID,
		CustomerCode: customerCode, CustomerName: customerName,
		ModuleConfig: bodyJSONText(body, "moduleConfig", "module_config"), BoardConfig: bodyJSONText(body, "boardConfig", "board_config"),
		WorkflowConfig: bodyJSONText(body, "workflowConfig", "workflow_config"), NotificationConfig: bodyJSONText(body, "notificationConfig", "notification_config"),
		TemplateSetID: templateVersion.TemplateSetID, TemplateVersionID: templateVersion.TemplateVersionID,
		TemplateDefinition: &templateVersion.Definition, CreatedBy: createdBy, Source: "altoc.opportunity.project.create",
	})
	if err != nil {
		var mysqlError *mysql.MySQLError
		if errors.As(err, &mysqlError) && mysqlError.Number == 1062 {
			existing, lookupErr := opportunityProjectTx(ctx, tx, oppID, category, false)
			if lookupErr == nil && existing != nil {
				return map[string]any{"project": existing, "created": false, "idempotent": true}, nil
			}
		}
		return nil, err
	}
	return map[string]any{"project": project, "created": true, "idempotent": false}, nil
}

func opportunityProjectTx(ctx context.Context, tx *sql.Tx, oppID int64, category string, lock bool) (map[string]any, error) {
	query := `SELECT * FROM aims_projects WHERE opp_id = ? AND category = ? ORDER BY id ASC LIMIT 1`
	if lock {
		query += " FOR UPDATE"
	}
	return aimsQueryOneMap(ctx, tx, query, oppID, category)
}

func validOpportunityProjectPeriod(startDate string, endDate string) bool {
	start, startErr := time.Parse("2006-01-02", startDate)
	end, endErr := time.Parse("2006-01-02", endDate)
	return startErr == nil && endErr == nil && !end.Before(start)
}

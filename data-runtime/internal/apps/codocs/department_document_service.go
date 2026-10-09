package codocs

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	aimsDepartmentDocumentsListCapability = "codocs:department-documents:list"
	aimsDepartmentDocumentsListOperation  = "aims.codocs.department-documents.list.v1"
	aimsDepartmentDocumentsListSchema     = "aims.codocs.department-documents.list.v1"
)

func departmentDocumentsServiceCommand(body map[string]any, query url.Values) (string, string, int, error) {
	serviceCommand, ok := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	if !ok {
		return "", "", 0, httperror.New(http.StatusForbidden, "department_documents_service_command_required", "signed department document service command is required")
	}
	command, ok := serviceCommand["command"].(map[string]any)
	if !ok {
		return "", "", 0, httperror.New(http.StatusForbidden, "department_documents_service_command_invalid", "department document service command payload is invalid")
	}
	actorUID := strings.TrimSpace(firstTextValue(command, "actorUid"))
	deptCode := strings.TrimSpace(firstTextValue(command, "deptCode"))
	pageSize64 := int64Value(command["pageSize"])
	invalid :=
		strings.TrimSpace(firstTextValue(serviceCommand, "targetApp")) != "codocs" ||
			strings.TrimSpace(firstTextValue(serviceCommand, "operationCode")) != aimsDepartmentDocumentsListOperation ||
			strings.TrimSpace(firstTextValue(serviceCommand, "requiredCapability")) != aimsDepartmentDocumentsListCapability ||
			strings.TrimSpace(firstTextValue(serviceCommand, "commandSchemaVersion")) != aimsDepartmentDocumentsListSchema ||
			strings.TrimSpace(firstTextValue(command, "action")) != "list" ||
			actorUID == "" || deptCode == "" || pageSize64 < 1 || pageSize64 > 200 ||
			strings.TrimSpace(query.Get("current_user")) != actorUID ||
			query.Get("hzy_runtime_actor_delegated") != "1" ||
			strings.TrimSpace(query.Get("hzy_runtime_actor_purpose")) != "service-command" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandSourceAppKey)) != "aims" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandTargetAppKey)) != "codocs" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandSourceClientKey)) != "aims.runtime" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandTenantKey)) == "" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandSourceDeploymentKey)) == "" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandTargetDeploymentKey)) == ""
	if invalid {
		return "", "", 0, httperror.New(http.StatusForbidden, "department_documents_service_command_invalid", "department document service command binding is invalid")
	}
	return actorUID, deptCode, int(pageSize64), nil
}

func (a *Adapter) departmentDocumentsServiceList(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	actorUID, deptCode, pageSize, err := departmentDocumentsServiceCommand(body, query)
	if err != nil {
		return nil, err
	}

	// Rebuild every selector from the signed command. The target BFF has
	// independently verified actor membership in this exact department.
	scopedQuery := url.Values{
		"current_user":                      {actorUID},
		"hzy_runtime_actor_delegated":       {"1"},
		"hzy_runtime_actor_purpose":         {"service-command"},
		codocsTrustedDepartmentReadQueryKey: {deptCode},
		"page":                              {"1"},
		"limit":                             {strconv.Itoa(pageSize)},
	}
	scopedQuery.Set("type", "department")
	scopedQuery.Set("folder_type", "department")
	scopedQuery.Set("dept_code", deptCode)

	documents, err := a.documentsList(ctx, scopedQuery)
	if err != nil {
		return nil, err
	}
	folders, err := a.foldersList(ctx, scopedQuery)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"deptCode": deptCode,
		"items":    documents["items"],
		"folders":  folders["items"],
	}, nil
}

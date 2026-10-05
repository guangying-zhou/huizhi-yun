package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"regexp"
)

var enterpriseProjectModuleKeys = []string{"milestones", "workflows", "requirements", "releases", "environments", "service_desk", "decomposition"}

func validateEnterpriseProjectModules(input map[string]any) error {
	if len(input) != 3 {
		return httperror.New(400, "project_modules_input_invalid", "Version, original configuration and module configuration required")
	}
	version, ok := input["expectedVersion"].(string)
	if !ok || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(version) {
		return httperror.New(400, "project_version_required", "Project content version required")
	}
	for key := range input {
		if key != "expectedVersion" && key != "expectedModuleConfig" && key != "moduleConfig" {
			return httperror.New(400, "project_modules_input_invalid", "Unsupported field")
		}
	}
	config, ok := input["moduleConfig"].(map[string]any)
	if !ok || len(config) != len(enterpriseProjectModuleKeys) {
		return httperror.New(400, "project_modules_invalid", "All module boolean keys required")
	}
	for _, key := range enterpriseProjectModuleKeys {
		if _, ok := config[key].(bool); !ok {
			return httperror.New(400, "project_modules_invalid", "Module keys must be boolean")
		}
	}
	_, err := canonicalProjectModules(input["expectedModuleConfig"])
	return err
}

// Compare JSON values, not MySQL's formatting of the stored JSON string.
func canonicalProjectModules(value any) (string, error) {
	if text, ok := value.(string); ok {
		if err := json.Unmarshal([]byte(text), &value); err != nil {
			return "", httperror.New(400, "project_modules_invalid", "Invalid original configuration")
		}
	}
	if value != nil {
		if _, ok := value.(map[string]any); !ok {
			return "", httperror.New(400, "project_modules_invalid", "Original configuration must be an object or null")
		}
	}
	raw, err := json.Marshal(value)
	return string(raw), err
}

func (a *Adapter) UpdateEnterpriseProjectModules(ctx context.Context, identity EnterpriseProjectUpdateIdentity, projectID string, input map[string]any) (map[string]any, error) {
	if err := validateEnterpriseProjectModules(input); err != nil {
		return nil, err
	}
	if scoped, ok := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity); ok {
		identity.CommandScope = scoped.CommandScope
	}
	if identity.CommandScope == nil {
		return nil, httperror.New(403, "project_modules_scope_required", "Scoped edit authorization required")
	}
	base := EnterpriseProjectCreateIdentity{Tenant: identity.Tenant, SourceDeployment: identity.SourceDeployment, TargetDeployment: identity.TargetDeployment, ActorUID: identity.ActorUID, ServiceClientID: identity.ServiceClientID, IdempotencyKey: identity.IdempotencyKey, RequestID: identity.RequestID}
	ri, err := enterpriseProjectCreateReceiptInput(base, map[string]any{"projectId": projectID, "changes": input})
	if err != nil {
		return nil, err
	}
	ri.OperationCode = "enterprise.aims.project-modules.update.v1"
	ri.RequiredCapability = "aims:enterprise-host:execute"
	ri.CommandSchemaVersion = "project-modules.v1"
	tx, repo, err := a.beginEnterpriseWrite(ctx, base)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = requireEnterpriseProjectCommandScopeTx(ctx, tx, identity, projectID, "", "edit"); err != nil {
		return nil, err
	}
	var leader string
	if err = tx.QueryRowContext(ctx, "SELECT COALESCE(leader_uid,'') FROM aims_projects WHERE id=? FOR UPDATE", projectID).Scan(&leader); err != nil {
		return nil, err
	}
	if err = requireEnterpriseSettingsManagerTx(ctx, tx, projectID, identity.ActorUID, leader); err != nil {
		return nil, err
	}

	executed, err := repo.ExecuteInTransaction(ctx, tx, ri, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		return saveProjectModulesTx(ctx, tx, identity, projectID, input)
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": executed.ReceiptID, "idempotent": executed.Existing, "result": executed.Value}, nil
}

func saveProjectModulesTx(ctx context.Context, tx *sql.Tx, identity EnterpriseProjectUpdateIdentity, projectID string, input map[string]any) (integrationoperation.ReceiptBusinessResult, error) {
	_, version, err := enterpriseProjectSnapshot(ctx, tx, projectID, true)
	if err != nil {
		return integrationoperation.ReceiptBusinessResult{}, err
	}
	if version != input["expectedVersion"] {
		return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "project_version_conflict", "Project information changed")
	}
	var stored sql.NullString
	if err = tx.QueryRowContext(ctx, "SELECT CAST(module_config AS CHAR) FROM aims_projects WHERE id=? FOR UPDATE", projectID).Scan(&stored); err != nil {
		return integrationoperation.ReceiptBusinessResult{}, err
	}
	var original any
	if stored.Valid {
		original = stored.String
	}
	actual, err := canonicalProjectModules(original)
	if err != nil {
		return integrationoperation.ReceiptBusinessResult{}, err
	}
	expected, _ := canonicalProjectModules(input["expectedModuleConfig"])
	if actual != expected {
		return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "project_modules_version_conflict", "Project modules changed")
	}
	raw, _ := json.Marshal(input["moduleConfig"])
	if _, err = tx.ExecContext(ctx, "UPDATE aims_projects SET module_config=CAST(? AS JSON) WHERE id=?", string(raw), projectID); err != nil {
		return integrationoperation.ReceiptBusinessResult{}, err
	}
	changes, _ := json.Marshal(map[string]any{"before": original, "after": input["moduleConfig"]})
	if _, err = tx.ExecContext(ctx, "INSERT INTO project_activity_logs(project_id,object_type,object_code,action,actor_uid,changes,request_id) VALUES(?,'project',?,'modules-edit',?,?,?)", projectID, projectID, identity.ActorUID, changes, identity.IdempotencyKey); err != nil {
		return integrationoperation.ReceiptBusinessResult{}, err
	}
	return integrationoperation.ReceiptBusinessResult{TargetBizType: "project", TargetBizCode: projectID, HTTPStatus: http.StatusOK, Value: map[string]any{"moduleConfig": input["moduleConfig"], "editVersion": version}}, nil
}

func requireEnterpriseSettingsManagerTx(ctx context.Context, tx *sql.Tx, projectID, actor, leader string) error {
	var managers int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_members WHERE project_id=? AND uid=? AND role='manager' AND status='active'", projectID, actor).Scan(&managers); err != nil {
		return err
	}
	if leader != actor && managers == 0 {
		return httperror.New(403, "project_manager_required", "Project management access required")
	}
	return nil
}

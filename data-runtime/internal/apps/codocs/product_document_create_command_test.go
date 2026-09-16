package codocs

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"regexp"
	"testing"
)

func TestProductDocumentCreateCommandBoundary(t *testing.T) {
	for _, failure := range []string{"", "read-scope", "actor", "template", "same-target", "title", "extra", "operation", "hash", "operation-id", "schema"} {
		t.Run(failure, func(t *testing.T) {
			const target = "00000000-0000-4000-8000-000000000001"
			body := projectDocumentServiceBody(target, "ignored")
			envelope := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
			envelope["operationCode"] = aimsProductDocumentCreateOperation
			envelope["requiredCapability"] = aimsProductDocumentCreateCapability
			envelope["commandSchemaVersion"] = aimsProductDocumentCreateSchema
			command := map[string]any{"actorUid": "reader-uid", "productCode": "P", "documentUuid": target, "templateUuid": "00000000-0000-4000-8000-000000000002", "title": "需求说明", "action": "create"}
			envelope["command"] = command
			freezeProductCreateTestEnvelope(envelope)
			query := productDocumentServiceQuery()
			query.Set("current_user_scopes", aimsProductDocumentCreateCapability)
			switch failure {
			case "read-scope":
				query.Set("current_user_scopes", aimsProductDocumentReadCapability)
			case "actor":
				command["actorUid"] = "other"
			case "template":
				command["templateUuid"] = "invalid"
			case "same-target":
				command["templateUuid"] = target
			case "title":
				command["title"] = "bad\nname"
			case "extra":
				command["ownerUid"] = "admin"
			case "hash":
				envelope["commandSha256"] = "bad"
			case "operation-id":
				envelope["operationId"] = "not-a-uuid"
			case "schema":
				envelope["commandSchemaVersion"] = aimsProductDocumentCreateOperation
			case "operation":
				envelope["operationCode"] = aimsProductDocumentReadOperation
			}
			parsed, err := parseProductDocumentCreateCommand(body, query)
			if failure != "" {
				if err == nil {
					t.Fatal("invalid command accepted")
				}
				return
			}
			if err != nil || parsed.DocumentUUID != target || parsed.ActorUID != "reader-uid" || parsed.ProductCode != "P" || parsed.Title != "需求说明" {
				t.Fatalf("command %+v %v", parsed, err)
			}
		})
	}
}

func TestProductCreationTemplateRequiresCurrentDocumentACL(t *testing.T) {
	const target = "00000000-0000-4000-8000-000000000001"
	const template = "00000000-0000-4000-8000-000000000002"
	for _, scenario := range []string{"owner", "denied", "inactive", "missing-content"} {
		t.Run(scenario, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			a := &Adapter{db: db}
			body := projectDocumentServiceBody(target, "ignored")
			envelope := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
			envelope["operationCode"] = aimsProductDocumentCreateOperation
			envelope["requiredCapability"] = aimsProductDocumentCreateCapability
			envelope["commandSchemaVersion"] = aimsProductDocumentCreateSchema
			envelope["command"] = map[string]any{"actorUid": "reader-uid", "productCode": "P", "documentUuid": target, "templateUuid": template, "title": "需求说明", "action": "create"}
			freezeProductCreateTestEnvelope(envelope)
			query := productDocumentServiceQuery()
			query.Set("current_user_scopes", aimsProductDocumentCreateCapability)
			query.Set("trusted_department_read_dept_code", "RD")
			owner, path, status := "reader-uid", "templates/spec.md", 1
			if scenario == "denied" {
				owner = "other"
			}
			if scenario == "inactive" {
				status = 2
			}
			if scenario == "missing-content" {
				path = ""
			}
			mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).WithArgs(template).WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "owner_uid", "doc_type", "dept_code", "readonly_flag", "status", "oss_path"}).AddRow(19, template, owner, "department", "RD", 0, status, path))
			if scenario == "denied" {
				mock.ExpectQuery(`(?s)SELECT permission.*FROM document_shares.*document_id = \? AND shared_to_uid = \?`).WithArgs(int64(19), "reader-uid").WillReturnRows(sqlmock.NewRows([]string{"permission"}))
				mock.ExpectQuery(`(?s)SELECT TABLE_NAME.*FROM information_schema\.TABLES`).WithArgs("document_relations").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
				mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM document_relations.*can_read = 1`).WithArgs(int64(19), "reader-uid").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
			}
			command, grant, err := a.readProductCreationTemplate(context.Background(), body, query)
			if scenario == "owner" {
				if err != nil || command.DocumentUUID != target || grant["uuid"] != template || len(grant) != 3 {
					t.Fatalf("template %+v %+v %v", command, grant, err)
				}
			} else if err == nil || grant != nil {
				t.Fatalf("invalid template allowed: %+v %v", grant, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func freezeProductCreateTestEnvelope(envelope map[string]any) {
	payload, _ := json.Marshal(envelope["command"])
	envelope["commandSha256"] = fmt.Sprintf("%x", sha256.Sum256(payload))
	envelope["operationId"] = "00000000-0000-4000-8000-000000000003"
	envelope["idempotencyKey"] = "product-create-test"
}

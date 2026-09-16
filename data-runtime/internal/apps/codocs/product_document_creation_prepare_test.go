package codocs

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"testing"
)

func TestProductCreationPreparationPreservesFrozenSnapshot(t *testing.T) {
	for _, conflict := range []bool{false, true} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		a := &Adapter{db: db}
		body := projectDocumentServiceBody("00000000-0000-4000-8000-000000000001", "ignored")
		envelope := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
		envelope["operationCode"] = aimsProductDocumentCreateOperation
		envelope["requiredCapability"] = aimsProductDocumentCreateCapability
		envelope["commandSchemaVersion"] = aimsProductDocumentCreateSchema
		envelope["command"] = map[string]any{"actorUid": "reader-uid", "productCode": "P", "documentUuid": "00000000-0000-4000-8000-000000000001", "templateUuid": "00000000-0000-4000-8000-000000000002", "title": "Spec", "action": "create"}
		freezeProductCreateTestEnvelope(envelope)
		query := productDocumentServiceQuery()
		query.Set("current_user_scopes", aimsProductDocumentCreateCapability)
		identity := sha256.Sum256([]byte("TENANT-1|AIMS-DEPLOYMENT|CODOCS-DEPLOYMENT|aims|codocs|aims.codocs.product-document.create.v1|product-create-test"))
		commandHash := envelope["commandSha256"].(string)
		if conflict {
			commandHash = "different"
		}
		mock.ExpectBegin()
		mock.ExpectExec(`INSERT INTO product_document_creation.*ON DUPLICATE KEY UPDATE operation_id=operation_id`).WillReturnResult(sqlmock.NewResult(0, 0))
		mock.ExpectQuery(`SELECT identity_sha256.*FOR UPDATE`).WithArgs(envelope["operationId"]).WillReturnRows(sqlmock.NewRows([]string{"identity", "command", "actor", "product", "target", "template", "title", "content", "hash", "state", "path"}).AddRow(identity[:], commandHash, "reader-uid", "P", "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "Spec", "original", fmt.Sprintf("%x", sha256.Sum256([]byte("original"))), "prepared", nil))
		if conflict {
			mock.ExpectRollback()
		} else {
			mock.ExpectCommit()
		}
		result, err := a.prepareProductDocumentCreation(context.Background(), body, query, "template changed since first request")
		if conflict {
			if err == nil {
				t.Fatal("conflict accepted")
			}
		} else if err != nil || result.Content != "original" {
			t.Fatalf("snapshot %+v %v", result, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}

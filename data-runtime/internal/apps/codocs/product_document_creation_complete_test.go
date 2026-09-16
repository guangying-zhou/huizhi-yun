package codocs

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"testing"
)

func TestProductCreationCompletionWritesDocumentOwnerAndState(t *testing.T) {
	for _, badHash := range []bool{false, true} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		a := &Adapter{db: db}
		input := integrationoperation.ReceiptCommandInput{OperationID: "operation", CommandSHA256: "command", SourceDeploymentCode: "S", TargetDeploymentCode: "T", TargetApp: "codocs", OperationCode: aimsProductDocumentCreateOperation, IdempotencyKey: "key", TrustedContext: integrationoperation.TrustedContext{TenantCode: "TENANT", SourceApp: "aims"}}
		command := productDocumentCreateCommand{ActorUID: "reader", ProductCode: "P", DocumentUUID: "target", TemplateUUID: "template", Title: "Spec"}
		identity := sha256.Sum256([]byte("TENANT|S|T|aims|codocs|aims.codocs.product-document.create.v1|key"))
		hash := fmt.Sprintf("%x", sha256.Sum256([]byte("frozen")))
		mock.ExpectBegin()
		mock.ExpectQuery(`SELECT identity_sha256.*FOR UPDATE`).WithArgs("operation").WillReturnRows(sqlmock.NewRows([]string{"identity", "command", "actor", "product", "target", "template", "title", "content", "hash", "state"}).AddRow(identity[:], "command", "reader", "P", "target", "template", "Spec", "frozen", hash, "prepared"))
		if !badHash {
			mock.ExpectExec(`INSERT INTO documents`).WithArgs("target", "Spec", "product-creations/attempt.md", "reader", 6).WillReturnResult(sqlmock.NewResult(42, 1))
			mock.ExpectExec(`INSERT INTO document_relations`).WithArgs(int64(42), "target", "reader", "created_by_me", "document", "42", 1, 1, 0, sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectExec(`UPDATE product_document_creation SET state='completed'`).WithArgs("product-creations/attempt.md", "operation").WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectCommit()
		} else {
			mock.ExpectRollback()
		}
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		uploadedHash := hash
		if badHash {
			uploadedHash = "wrong"
		}
		result, err := a.completeProductDocumentCreationTx(context.Background(), tx, input, command, "product-creations/attempt.md", uploadedHash)
		if badHash {
			if err == nil {
				t.Fatal("wrong upload accepted")
			}
			_ = tx.Rollback()
		} else {
			if err != nil {
				t.Fatal(err)
			}
			if result.TargetBizCode != "target" || len(result.Value.(map[string]any)) != 3 {
				t.Fatalf("result %+v", result)
			}
			if err = tx.Commit(); err != nil {
				t.Fatal(err)
			}
		}
		if err = mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}

package codocs

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestAnnotationWritesRejectClientAuthorWithoutTrustedActor(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}

	_, err = adapter.createDocumentAnnotation(context.Background(), "doc-1", url.Values{"current_user": {"spoofed-actor"}}, map[string]any{
		"selected_text": "selection",
		"content":       "comment",
		"author_id":     "spoofed-author",
	})
	if err == nil {
		t.Fatal("client author_id without a trusted actor must be rejected")
	}
	_, err = adapter.createAnnotationReply(context.Background(), "doc-1", "7", url.Values{"current_user": {"spoofed-actor"}}, map[string]any{
		"content":   "reply",
		"author_id": "spoofed-author",
	})
	if err == nil {
		t.Fatal("client reply author_id without a trusted actor must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("untrusted annotation writes must not query or mutate storage: %v", err)
	}
}

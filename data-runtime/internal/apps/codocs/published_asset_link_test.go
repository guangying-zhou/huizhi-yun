package codocs

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func assetLinkQuery(action string) url.Values {
	return url.Values{"current_user": {"U001"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"codocs"}, publishedAssetLinkActionKey: {action}, "path": {"codocs/company/rules/历史公司制度.md"}}
}

func TestPublishedAssetLinkRequiresTrustedActorBeforeDB(t *testing.T) {
	for _, action := range []string{"create", "resolve"} {
		for _, field := range []string{"current_user", "hzy_runtime_actor_delegated", "hzy_runtime_source_app", publishedAssetLinkActionKey} {
			t.Run(action+"/"+field, func(t *testing.T) {
				q := assetLinkQuery(action)
				q.Del(field)
				a := &Adapter{}
				var err error
				if action == "create" {
					_, err = a.createPublishedAssetLink(context.Background(), q)
				} else {
					_, err = a.resolvePublishedAssetLink(context.Background(), q, publishedAssetLinkToken(q.Get("path")))
				}
				if err == nil {
					t.Fatal("untrusted request accepted")
				}
			})
		}
	}
	q := assetLinkQuery("create")
	q.Set("hzy_runtime_source_app", "aims")
	if _, err := publishedAssetLinkActor(q, "create"); err == nil {
		t.Fatal("other app authorization accepted")
	}
	if _, err := publishedAssetLinkActor(assetLinkQuery("resolve"), "create"); err == nil {
		t.Fatal("read authorization grants creation")
	}
	q.Set("hzy_runtime_source_app", "codocs.runtime")
	if _, err := publishedAssetLinkActor(q, "create"); err != nil {
		t.Fatal(err)
	}
}

func TestPublishedAssetLinkPathContract(t *testing.T) {
	for _, path := range []string{"codocs/company/rules/历史制度.md", "codocs/company/products/folder/a.pdf", "codocs/departments/GMO/rules/制度.md", "codocs/departments/研发/outsides/a.md", "codocs/departments/GMO/records/a.md"} {
		if !validPublishedAssetPath(path) {
			t.Fatalf("valid path rejected: %s", path)
		}
		if token := publishedAssetLinkToken(path); len(token) != 16 || strings.ContainsAny(token, "+/=%") {
			t.Fatalf("unsafe/long token %q", token)
		}
	}
	for _, path := range []string{"https://example.com", "//example.com/a", "codocs/users/U001/a.md", "codocs/company/unknown/a.md", "codocs/departments/GMO/knowledge/a.md", "codocs/company/rules", "codocs/departments/rules/a.md", "codocs/company/rules/../a.md", "codocs/company/rules//a.md", "codocs/company/rules/a\x00.md", "codocs/company/rules/a\x7f.md", "codocs/company/rules/a\\b.md", "codocs/company/rules/" + strings.Repeat("😀", 400)} {
		q := assetLinkQuery("create")
		q.Set("path", path)
		if _, err := (&Adapter{}).createPublishedAssetLink(context.Background(), q); err == nil {
			t.Fatalf("invalid path accepted: %q", path)
		}
	}
}

func TestPublishedAssetLinkCreateReplayAndCollisionNeverOverwrite(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	q := assetLinkQuery("create")
	path, token := q.Get("path"), publishedAssetLinkToken(q.Get("path"))
	a := &Adapter{db: db}
	for _, storedPath := range []string{path, path, "codocs/company/rules/collision.md"} {
		mock.ExpectExec(`(?s)INSERT INTO published_asset_links.*UTC_TIMESTAMP\(3\).*ON DUPLICATE KEY UPDATE token = token`).WithArgs(token, path, "U001").WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectQuery(`SELECT oss_path FROM published_asset_links WHERE token = \?`).WithArgs(token).WillReturnRows(sqlmock.NewRows([]string{"oss_path"}).AddRow(storedPath))
		result, err := a.createPublishedAssetLink(context.Background(), q)
		if storedPath == path {
			if err != nil || result["token"] != token || result["path"] != path {
				t.Fatalf("unexpected replay result: %#v, %v", result, err)
			}
		} else if httpErr, ok := err.(httperror.Error); !ok || httpErr.Status != http.StatusConflict {
			t.Fatalf("collision not rejected: %v", err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPublishedAssetLinkResolveOnlyReadsAndRejectsUnknownOrCorruptTarget(t *testing.T) {
	for _, storedPath := range []string{"codocs/company/rules/历史公司制度.md", "", "https://example.com", "codocs/company/rules/other.md"} {
		t.Run(storedPath, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			q := assetLinkQuery("resolve")
			token := publishedAssetLinkToken(q.Get("path"))
			expect := mock.ExpectQuery(`SELECT oss_path FROM published_asset_links WHERE token = \?`).WithArgs(token)
			if storedPath == "" {
				expect.WillReturnError(sql.ErrNoRows)
			} else {
				expect.WillReturnRows(sqlmock.NewRows([]string{"oss_path"}).AddRow(storedPath))
			}
			result, operation, err := (&Adapter{db: db}).HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/published-asset-links/"+token, q, nil)
			if storedPath == q.Get("path") {
				if err != nil || operation != "codocs.published_asset_links.resolve" || result.(map[string]any)["data"].(map[string]any)["path"] != storedPath {
					t.Fatalf("unexpected resolution %#v %s %v", result, operation, err)
				}
			} else if err == nil {
				t.Fatal("invalid mapping accepted")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
	for _, token := range []string{"", "short", "abcdefghijklmnop=", "abcdefghijklmn+/", "abcdefghijk\nlmnop"} {
		if _, err := (&Adapter{}).resolvePublishedAssetLink(context.Background(), assetLinkQuery("resolve"), token); err == nil {
			t.Fatalf("invalid token accepted: %q", token)
		}
	}
}

func TestPublishedAssetLinkPersistenceFailureIsReturned(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	failure := errors.New("storage unavailable")
	mock.ExpectExec(`INSERT INTO published_asset_links`).WillReturnError(failure)
	if _, err := (&Adapter{db: db}).createPublishedAssetLink(context.Background(), assetLinkQuery("create")); !errors.Is(err, failure) {
		t.Fatalf("storage failure masked: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPublishedAssetLinkMigrationMatchesSchema(t *testing.T) {
	if !slices.Contains(requiredTables, "published_asset_links") {
		t.Fatal("runtime schema readiness must require published_asset_links")
	}
	migration, err := os.ReadFile("../../../../codocs/docs/migrations/20260910_published_asset_links.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema, err := os.ReadFile("../../../../codocs/docs/codocs_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(schema), string(migration)) || !strings.Contains(string(migration), "CHAR(16) CHARACTER SET ascii COLLATE ascii_bin") || !strings.Contains(string(migration), "PRIMARY KEY (`token`)") {
		t.Fatal("schema must preserve exact-case unique short codes and match migration")
	}
}

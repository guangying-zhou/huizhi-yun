package console

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"testing"
)

func TestOrgBrandMinimalFallbackAndTenant(t *testing.T) {
	for _, tc := range []struct {
		tenant, short, display, wantShort, wantDisplay string
		status                                         int
	}{
		{"tenant-a", " 简称 ", " 显示名 ", "简称", "显示名", 0},
		{"tenant-a", "", "显示名", "显示名", "显示名", 0},
		{"tenant-a", " ", "", "全称", "全称", 0},
		{"tenant-b", "foreign", "foreign", "", "", 403},
	} {
		t.Run(tc.tenant+tc.short+tc.display, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectQuery("SELECT tenant_code,org_name,org_short_name,display_name FROM org_profiles").WillReturnRows(sqlmock.NewRows([]string{"tenant_code", "org_name", "org_short_name", "display_name"}).AddRow(tc.tenant, "全称", tc.short, tc.display))
			result, err := NewWithDB(config.ConsoleConfig{}, "tenant-a", db).OrgBrand(context.Background())
			if tc.status != 0 {
				var denied httperror.Error
				if !errors.As(err, &denied) || denied.Status != tc.status {
					t.Fatalf("error=%v", err)
				}
			} else if err != nil || len(result) != 2 || result["shortName"] != tc.wantShort || result["displayName"] != tc.wantDisplay {
				t.Fatalf("result=%v err=%v", result, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

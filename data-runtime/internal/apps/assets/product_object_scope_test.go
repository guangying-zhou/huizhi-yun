package assets

import (
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestMySQLProductObjectScopeConjunctions(t *testing.T) {
	socket := os.Getenv("HZY_PRODUCT_CENTER_TEST_SOCKET")
	if socket == "" {
		t.Skip("dedicated MySQL socket not configured")
	}
	if !strings.HasPrefix(socket, "/tmp/hzy-product-center.") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-test socket")
	}
	db, err := sql.Open("mysql", "root@unix("+socket+")/?parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	fixtures := `(SELECT 1 id,'u1' business_owner_uid,'other' technical_owner_uid,'A' project_code UNION ALL SELECT 2,'other','u1','B' UNION ALL SELECT 3,'other','other','A') p`
	cases := []struct {
		name  string
		units []assetsScopeUnit
		want  []int
	}{
		{"both owners", []assetsScopeUnit{{DirectRelation: true}}, []int{1, 2}},
		{"project", []assetsScopeUnit{{ProjectCodes: []string{"A"}}}, []int{1, 3}},
		{"same grant AND", []assetsScopeUnit{{DirectRelation: true, ProjectCodes: []string{"A"}}}, []int{1}},
		{"separate grants OR", []assetsScopeUnit{{DirectRelation: true}, {ProjectCodes: []string{"A"}}}, []int{1, 2, 3}},
		{"department not ignored", []assetsScopeUnit{{DirectRelation: true, DepartmentCodes: []string{"D"}, ProjectCodes: []string{"A"}}}, []int{}},
		{"unknown relation not ignored", []assetsScopeUnit{{DirectRelation: true, RelationPredicates: []string{"unknown"}, ProjectCodes: []string{"A"}}}, []int{}},
		{"unsupported relation", []assetsScopeUnit{{DirectRelation: true, RelationPredicates: []string{"custodian"}}}, []int{}},
		{"no units", nil, []int{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			where, args := productObjectScopeWhere("p", "u1", tc.units)
			rows, err := db.Query("SELECT p.id FROM "+fixtures+" WHERE "+where+" ORDER BY p.id", args...)
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			got := []int{}
			for rows.Next() {
				var id int
				if err := rows.Scan(&id); err != nil {
					t.Fatal(err)
				}
				got = append(got, id)
			}
			if err := rows.Err(); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

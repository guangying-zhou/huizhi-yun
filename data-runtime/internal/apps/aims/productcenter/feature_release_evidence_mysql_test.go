package productcenter

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"strings"
	"testing"
)

func TestMySQLFeatureReleaseEvidenceValidity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	const featureID = "00000000-0000-4000-8000-000000000001"
	snapshot := func(id, status string, duplicate bool) string {
		entry := map[string]string{"product_feature_biz_id": id, "status": status}
		entries := []map[string]string{entry}
		if duplicate {
			entries = append(entries, entry)
		}
		raw, _ := json.Marshal(map[string]any{"version": 1, "features": entries})
		return string(raw)
	}
	good := snapshot(featureID, "delivered", false)
	for i, tc := range []struct {
		name, code, status, evidence, event, scope string
		current, valid                             bool
	}{
		{"valid", "P-RELEASE", "released", "verified", "", good, true, true},
		{"withdrawn", "P-RELEASE", "released", "verified", "withdrawn", good, true, false},
		{"superseded", "P-RELEASE", "released", "verified", "superseded", good, true, false},
		{"foreign", "P-OTHER", "released", "verified", "", good, true, false},
		{"developing", "P-RELEASE", "developing", "verified", "", good, true, false},
		{"archived", "P-RELEASE", "archived", "verified", "", good, true, false},
		{"legacy", "P-RELEASE", "released", "legacy_import", "", good, true, false},
		{"not-current", "P-RELEASE", "released", "verified", "", good, false, false},
		{"wrong-feature", "P-RELEASE", "released", "verified", "", snapshot(uuid.NewString(), "delivered", false), true, false},
		{"planned", "P-RELEASE", "released", "verified", "", snapshot(featureID, "planned", false), true, false},
		{"duplicate", "P-RELEASE", "released", "verified", "", snapshot(featureID, "delivered", true), true, false},
		{"unknown-shape", "P-RELEASE", "released", "verified", "", `{"legacy":true}`, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result, err := db.Exec(`INSERT INTO product_versions(product_code,version_code,status) VALUES(?,?,?)`, tc.code, fmt.Sprintf("v-test-%d", i), tc.status)
			if err != nil {
				t.Fatal(err)
			}
			versionID, err := result.LastInsertId()
			if err != nil {
				t.Fatal(err)
			}
			releaseID := uuid.NewString()
			result, err = db.Exec(`INSERT INTO product_release_records(biz_id,version_id,release_seq,scope_revision,scope_snapshot,acceptance_snapshot,content_hash,released_by,released_at,evidence_level,recorded_at) VALUES(?,?,1,1,?,JSON_OBJECT(),?,'publisher',UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3))`, releaseID, versionID, tc.scope, strings.Repeat("a", 64), tc.evidence)
			if err != nil {
				t.Fatal(err)
			}
			recordID, err := result.LastInsertId()
			if err != nil {
				t.Fatal(err)
			}
			if tc.current {
				if _, err = db.Exec(`UPDATE product_versions SET current_release_record_id=? WHERE id=?`, recordID, versionID); err != nil {
					t.Fatal(err)
				}
			}
			if tc.event != "" {
				if _, err = db.Exec(`INSERT INTO product_release_events(release_record_id,event_type,actor_uid,reason,created_at) VALUES(?,?,'publisher','测试撤销',UTC_TIMESTAMP(3))`, recordID, tc.event); err != nil {
					t.Fatal(err)
				}
			}
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			err = verifyFeatureReleaseEvidence(context.Background(), tx, "P-RELEASE", featureID, releaseID)
			if tc.valid {
				if err != nil {
					t.Fatal(err)
				}
			} else {
				requireProductRule(t, err, "product_feature_release_evidence_invalid")
			}
		})
	}
}

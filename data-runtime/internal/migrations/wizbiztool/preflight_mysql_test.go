package wizbiztool

import (
	"context"
	"testing"
)

func fixturePreflight(f *toolFixture) PreflightReport {
	return preflight(context.Background(), f.profile, f.manifest, f.manifestHash, func(string, string) (RuntimeBuildEvidence, error) { return f.build, nil }, func(Profile) error { return nil })
}
func readiness(r PreflightReport) map[string]bool {
	v := map[string]bool{}
	for _, c := range r.Checks {
		v[c.Name] = c.Ready
	}
	return v
}
func TestPreflightAllIdentitiesMySQL(t *testing.T) {
	f := newToolFixture(t)
	if r := fixturePreflight(f); !r.Ready {
		t.Fatal(r)
	}
	var count int
	if e := f.target.QueryRow("SELECT COUNT(*) FROM mig_batch").Scan(&count); e != nil || count != 0 {
		t.Fatal("preflight mutated ledger")
	}
	t.Run("directory_write_privilege_caught_before_stop", func(t *testing.T) {
		grant := "GRANT UPDATE ON `" + f.profile.ConsoleDatabase + "`.`directory_users` TO '" + f.profile.Directory.User + "'@'localhost'"
		if _, e := f.root.Exec(grant); e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() {
			f.root.Exec("REVOKE UPDATE ON `" + f.profile.ConsoleDatabase + "`.`directory_users` FROM '" + f.profile.Directory.User + "'@'localhost'")
		})
		r := fixturePreflight(f)
		v := readiness(r)
		if r.Ready || v["directory"] || !v["source"] || !v["source_metadata"] || !v["target"] {
			t.Fatal(r)
		}
	})
	t.Run("missing_target_insert_is_not_ready", func(t *testing.T) {
		table := f.profile.Database + "`.`mig_batch"
		who := "'" + f.profile.Target.User + "'@'localhost'"
		if _, e := f.root.Exec("REVOKE INSERT ON `" + table + "` FROM " + who); e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() {
			if _, e := f.root.Exec("GRANT INSERT ON `" + table + "` TO " + who); e != nil {
				t.Error(e)
			}
		})
		r := fixturePreflight(f)
		v := readiness(r)
		if r.Ready || v["target"] || !v["directory"] {
			t.Fatal(r)
		}
	})

	t.Run("all_four_failures_are_reported", func(t *testing.T) {
		saved := f.profile
		defer func() { f.profile = saved }()
		f.profile.Source.User = "root"
		f.profile.SourceMetadata.User = "root"
		f.profile.Target.User = "root"
		f.profile.Directory.User = "root"
		v := readiness(fixturePreflight(f))
		for _, n := range []string{"source", "source_metadata", "target", "directory"} {
			if v[n] {
				t.Fatal("missing gap", n)
			}
		}
	})
	t.Run("source_column_grant_is_checked_without_reading_values", func(t *testing.T) {
		query := "REVOKE SELECT ON `" + f.profile.Source.Database + "`.`wb_contract` FROM '" + f.profile.Source.User + "'@'localhost'"
		// Fixture grants all non-secret tables at table level.
		if _, e := f.root.Exec(query); e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() {
			_, e := f.root.Exec("GRANT SELECT ON `" + f.profile.Source.Database + "`.`wb_contract` TO '" + f.profile.Source.User + "'@'localhost'")
			if e != nil {
				t.Error(e)
			}
		})
		r := fixturePreflight(f)
		v := readiness(r)
		if r.Ready || v["source"] || !v["source_metadata"] || !v["directory"] {
			t.Fatal(r)
		}
	})
}

func TestPreflightW1PreparationPhaseMySQL(t *testing.T) {
	f := newToolFixture(t)
	r := preflightPhase(context.Background(), f.profile, f.manifest, f.manifestHash, "w1", func(string, string) (RuntimeBuildEvidence, error) {
		t.Fatal("build outside preparation phase")
		return RuntimeBuildEvidence{}, nil
	}, func(Profile) error { t.Fatal("vault outside preparation phase"); return nil })
	if !r.Ready || r.Phase != "w1" {
		t.Fatal(r)
	}
	required := map[string]bool{"profile": true, "runtime_binding": true, "source": true, "source_metadata": true}
	for _, c := range r.Checks {
		if c.Required != required[c.Name] || !c.Required && (c.Ready || c.Code != "not_required") {
			t.Fatal(c)
		}
	}
	// Bad required source blocks preparation even though target is not required.
	f.profile.Source.User = "root"
	if r = preflightPhase(context.Background(), f.profile, f.manifest, f.manifestHash, "w1", nil, nil); r.Ready {
		t.Fatal("required source bypassed")
	}
}

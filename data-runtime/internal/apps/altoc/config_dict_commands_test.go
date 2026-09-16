package altoc

import (
	"errors"
	"net/http"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestConfigDictFieldsNormalizesStageFlags(t *testing.T) {
	spec := configDictSpecs["opportunity_stage"]
	fields, err := configDictFields(spec, map[string]any{
		"code":     "  shortlist ",
		"name":     " 入围 ",
		"win_rate": "80",
		"is_won":   "1",
	})
	if err != nil {
		t.Fatalf("configDictFields returned error: %v", err)
	}
	if err := normalizeConfigDictDerivedFields(spec, fields, nil); err != nil {
		t.Fatalf("normalizeConfigDictDerivedFields returned error: %v", err)
	}
	if fields["code"] != "shortlist" || fields["name"] != "入围" {
		t.Fatalf("unexpected normalized text fields: %#v", fields)
	}
	if fields["is_closed"] != 1 || fields["stage_kind"] != "won" {
		t.Fatalf("won stage should derive closed won kind, fields=%#v", fields)
	}
}

func TestConfigDictFieldsRejectsInvalidWinRate(t *testing.T) {
	_, err := configDictFields(configDictSpecs["opportunity_stage"], map[string]any{
		"win_rate": 150,
	})
	assertConfigDictHTTPError(t, err, http.StatusBadRequest, "invalid_stage_win_rate")
}

func TestConfigDictDerivedFieldsRejectsWonAndLost(t *testing.T) {
	fields := map[string]any{"is_won": 1}
	err := normalizeConfigDictDerivedFields(configDictSpecs["opportunity_stage"], fields, map[string]any{"is_lost": 1})
	assertConfigDictHTTPError(t, err, http.StatusBadRequest, "invalid_stage_close_flags")
}

func TestConfigDictRequiresSettingsEditScope(t *testing.T) {
	err := altocRequireActionScope(map[string]any{
		"current_user":        "u1",
		"current_user_scopes": []string{"altoc.write"},
	}, "settings", "edit")
	assertConfigDictHTTPError(t, err, http.StatusForbidden, "permission_scope_required")

	err = altocRequireActionScope(map[string]any{
		"current_user":        "u1",
		"current_user_scopes": []string{"altoc.write", "altoc:settings:edit"},
	}, "settings", "edit")
	if err != nil {
		t.Fatalf("expected settings edit scope to pass, got %v", err)
	}
}

func TestConfigDictCreateRequiresCodeAndName(t *testing.T) {
	err := requireConfigDictCreateFields(map[string]any{"code": "new"})
	assertConfigDictHTTPError(t, err, http.StatusBadRequest, "missing_dict_name")

	err = requireConfigDictCreateFields(map[string]any{"code": "new", "name": "新字典"})
	if err != nil {
		t.Fatalf("expected complete fields to pass, got %v", err)
	}
}

func assertConfigDictHTTPError(t *testing.T, err error, status int, code string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %s error", code)
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != status || httpErr.Code != code {
		t.Fatalf("expected %s %d, got %#v", code, status, err)
	}
}

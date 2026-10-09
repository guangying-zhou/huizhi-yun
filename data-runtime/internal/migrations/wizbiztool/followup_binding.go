package wizbiztool

import (
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
	"reflect"
)

// A follow-up may carry the original protected configuration as evidence.
// Only the two Codocs collaboration switches added after the migration may
// differ. Every connection, key path, domain mapping and deployment must match.
// Neither configuration file is changed by this comparison.
func (e *engine) checkMainRuntimeConfig(currentHash string) error {
	if currentHash == e.plan.RuntimeConfigSHA256 {
		return nil
	}
	if e.baselineRuntimeConfig == "" {
		return ErrTarget
	}
	a, err := cutoverprofile.ReadProtected(e.baselineRuntimeConfig, 32<<20)
	if err != nil || Digest(a) != e.plan.RuntimeConfigSHA256 {
		return ErrTarget
	}
	b, err := cutoverprofile.ReadProtected(e.profile.RuntimeConfig, 32<<20)
	if err != nil || Digest(b) != currentHash {
		return ErrTarget
	}
	if !followupConfigEqual(a, b) {
		return ErrTarget
	}
	return nil
}
func followupConfigEqual(a, b []byte) bool {
	var old, current map[string]any
	if json.Unmarshal(a, &old) != nil || json.Unmarshal(b, &current) != nil {
		return false
	}
	appsOld, ok := old["apps"].(map[string]any)
	if !ok {
		return false
	}
	appsCurrent, ok := current["apps"].(map[string]any)
	if !ok {
		return false
	}
	co, ok := appsOld["codocs"].(map[string]any)
	if !ok {
		return false
	}
	cc, ok := appsCurrent["codocs"].(map[string]any)
	if !ok {
		return false
	}
	for _, key := range []string{"collaborationV2Enabled", "departmentCollaborationV2Enabled"} {
		if _, exists := co[key]; exists {
			continue
		}
		if v, exists := cc[key]; exists {
			if _, valid := v.(bool); !valid {
				return false
			}
			delete(cc, key)
		}
	}
	return reflect.DeepEqual(old, current)
}

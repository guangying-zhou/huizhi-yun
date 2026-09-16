package assets

import "testing"

func TestProductAdoptionReadCommand(t *testing.T) {
	valid := func() map[string]any {
		return map[string]any{"actorUid": "U1", "productCode": "PROD", "action": "read", "page": float64(1), "pageSize": float64(20)}
	}
	got, err := parseProductAdoptionReadCommand(valid())
	if err != nil || got.ActorUID != "U1" || got.PageSize != 20 {
		t.Fatalf("valid command: %+v %v", got, err)
	}
	for _, test := range []struct {
		key   string
		value any
	}{
		{"actorUid", nil}, {"actorUid", " U1"}, {"actorUid", "U\x00"}, {"actorUid", "\xff"},
		{"productCode", "../PROD"}, {"action", "write"}, {"page", 1.5}, {"page", 0}, {"page", 1000001},
		{"pageSize", "20"}, {"pageSize", 201}, {"pageSize", nil}, {"scope", "all"},
	} {
		input := valid()
		input[test.key] = test.value
		if _, err := parseProductAdoptionReadCommand(input); err == nil {
			t.Fatalf("accepted %s=%v", test.key, test.value)
		}
	}
}

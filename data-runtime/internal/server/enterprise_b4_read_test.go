package server

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"testing"
)

func TestAPFB4ReadCanonical(t *testing.T) {
	raw, e := os.ReadFile("testdata/enterprise-b4-read-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method string
		Cases  []struct {
			Target    string
			Body      apfInput
			Canonical string
		}
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	if len(f.Cases) != 5 {
		t.Fatal("missing read cases")
	}
	for _, c := range f.Cases {
		r := httptest.NewRequest(f.Method, c.Target, nil)
		if got := apfPermitCanonical(r, c.Body); got != c.Canonical {
			t.Fatalf("%s canonical mismatch\n%s\n%s", c.Target, got, c.Canonical)
		}
	}
}

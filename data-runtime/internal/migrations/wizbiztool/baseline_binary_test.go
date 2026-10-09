package wizbiztool

import (
	"bytes"
	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiztool/independentverify"
	"testing"
)

func TestBinaryBaselineIsLosslessAndIndependent(t *testing.T) {
	seen := map[string]bool{}
	for _, value := range []any{nil, "", string([]byte{0xff, 0x00, 0xfe}), "ff00fe", "中文"} {
		row := map[string]any{"identity_sha256": value}
		a, e := CanonicalBaseline(row)
		if e != nil {
			t.Fatal(e)
		}
		b, e := independentverify.CanonicalBaseline(row)
		if e != nil || !bytes.Equal(a, b) {
			t.Fatal("independent encoder mismatch")
		}
		if seen[string(a)] {
			t.Fatal("byte encoding collision")
		}
		seen[string(a)] = true
	}
	golden, e := CanonicalBaseline(map[string]any{"id": "1", "identity_sha256": string([]byte{0xff, 0, 0xfe})})
	if e != nil || string(golden) != `{"id":"31","identity_sha256":"ff00fe"}` {
		t.Fatal("binary golden mismatch")
	}
	if _, e = CanonicalRow(map[string]any{"source": string([]byte{0xff})}); e == nil {
		t.Fatal("source UTF-8 guard weakened")
	}
}

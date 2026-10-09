package independentverify

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestIndependentGoldenVectors(t *testing.T) {
	vectors := []struct{ raw, hash string }{
		{`{"ab_id":"7","ba_id":"3","balance":"1200.00","check_date":"2024-01-31","operate_time":"2024-02-01 09:15:00","operator_id":"12","remark":null}`, "c6166394d190776d5bb2789583019841640faa8aeb780c0bff262cb0d9e52876"},
		{`{"ab_id":"8","ba_id":"3","balance":"-0.50","check_date":"2024-01-31","operate_time":"2024-02-01 09:15:00","operator_id":"12","remark":""}`, "68c38a1aac993526fdc17a51836e5128c023b50ae2fc93acb3a309791b7f1ef7"},
		{`{"ancestors":null,"org_id":"5","org_name":"测试 \"客户\" A\\B","short_name":"","sum_all":"0.00"}`, "94fe4cca3d398952f6b12eb54ef5a6f1db0dc47eaae21906517a46e33105a07d"},
		{`{"account_number":{"$redacted":"vault","secretRef":"hzybase://vault/finance.bank-account.BA-W000002.account-no"},"ba_id":"2","bank_code":null}`, "aa9dcbf6b583a5b518b947542c80c563a1a63f5263940866b70089052d77611f"},
		{"{\"description\":\"a<b>&c/d\\n\\t\u2028e\\u0001\",\"id\":\"1\"}", "ac50bea595c1315e8946df96b4d00d18ec396af3fd87c40888b4525815199bb7"},
	}
	for _, v := range vectors {
		var row map[string]any
		if json.Unmarshal([]byte(v.raw), &row) != nil {
			t.Fatal("golden input")
		}
		actual, err := CanonicalSource(row)
		if err != nil || string(actual) != v.raw || SHA(actual) != v.hash {
			t.Fatal("independent golden mismatch")
		}
	}
	if SHA([]byte(strings.Join([]string{vectors[0].hash, vectors[1].hash}, "\n"))) != "6aca58eb14d6401482726d0ee3b482ccd385e2eb95e59d1821ec9059d4c1aab2" {
		t.Fatal("table golden")
	}
}

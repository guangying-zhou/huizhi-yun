package wizbiztool

import "testing"

func TestCanonicalGolden(t *testing.T) {
	cases := []struct {
		row  map[string]any
		hash string
	}{
		{map[string]any{"ab_id": "7", "ba_id": "3", "balance": "1200.00", "check_date": "2024-01-31", "operate_time": "2024-02-01 09:15:00", "operator_id": "12", "remark": nil}, "c6166394d190776d5bb2789583019841640faa8aeb780c0bff262cb0d9e52876"},
		{map[string]any{"ab_id": "8", "ba_id": "3", "balance": "-0.50", "check_date": "2024-01-31", "operate_time": "2024-02-01 09:15:00", "operator_id": "12", "remark": ""}, "68c38a1aac993526fdc17a51836e5128c023b50ae2fc93acb3a309791b7f1ef7"},
		{map[string]any{"ancestors": nil, "org_id": "5", "org_name": "测试 \"客户\" A\\B", "short_name": "", "sum_all": "0.00"}, "94fe4cca3d398952f6b12eb54ef5a6f1db0dc47eaae21906517a46e33105a07d"},
		{map[string]any{"account_number": VaultRedaction{"hzybase://vault/finance.bank-account.BA-W000002.account-no"}, "ba_id": "2", "bank_code": nil}, "aa9dcbf6b583a5b518b947542c80c563a1a63f5263940866b70089052d77611f"},
		{map[string]any{"description": "a<b>&c/d\n\t\u2028e\x01", "id": "1"}, "ac50bea595c1315e8946df96b4d00d18ec396af3fd87c40888b4525815199bb7"},
	}
	hashes := []string{}
	for i, c := range cases {
		raw, err := CanonicalRow(c.row)
		if err != nil || Digest(raw) != c.hash {
			t.Fatalf("golden %d mismatch", i+1)
		}
		hashes = append(hashes, c.hash)
	}
	digest, err := TableDigest(hashes[:2])
	if err != nil || digest != "6aca58eb14d6401482726d0ee3b482ccd385e2eb95e59d1821ec9059d4c1aab2" {
		t.Fatal("table golden mismatch")
	}
}
func TestCodeAndSecretRef(t *testing.T) {
	for _, c := range []struct{ family, id, want string }{{"customer", "123", "CU-W000123"}, {"contact", "45", "CN-W000045"}, {"contract", "7", "CT-W000007"}, {"bank-account", "2", "BA-W000002"}, {"legal-entity", "4", "ENT-W000004"}, {"customer", "1234567", "CU-W1234567"}} {
		got, err := ObjectCode(c.family, c.id)
		if err != nil || got != c.want {
			t.Fatal("code mismatch")
		}
	}
	for _, id := range []string{"0", "-1", "01", "1.0", "18446744073709551616"} {
		if _, err := ObjectCode("customer", id); err == nil {
			t.Fatal("invalid primary key accepted")
		}
	}
	if _, err := SecretRef("BA-W000002"); err != nil {
		t.Fatal(err)
	}
}
func TestCanonicalEscapeAndTypeBoundaries(t *testing.T) {
	raw, err := CanonicalRow(map[string]any{"literal": `\u2028`, "separator": "\u2029"})
	if err != nil || string(raw) != `{"literal":"\\u2028","separator":"`+"\u2029"+`"}` {
		t.Fatal("literal escape corrupted")
	}
	for _, v := range []any{1, true, map[string]any{"a": "b"}, []string{"x"}, "\xff", VaultRedaction{"vault://wrong"}} {
		if _, err := CanonicalRow(map[string]any{"a": v}); err == nil {
			t.Fatal("invalid source type accepted")
		}
	}
}

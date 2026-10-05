package server

import (
	"strings"
	"testing"
)

func TestEnterpriseRepositoryPath(t *testing.T) {
	for _, value := range []string{"huizhi-yun/huizhiyun", "group/subgroup/repo.git", "repo", strings.Repeat("a", 255)} {
		if !validEnterpriseRepositoryPath(value) {
			t.Fatalf("valid path rejected: %q", value)
		}
	}
	for _, value := range []string{"", "..", "group/../repo", "group//repo", "/group/repo", "group/repo/", "group/re..po", "huizhi-yun%2Fhuizhiyun", strings.Repeat("a", 256)} {
		if validEnterpriseRepositoryPath(value) {
			t.Fatalf("invalid path accepted: %q", value)
		}
	}
}

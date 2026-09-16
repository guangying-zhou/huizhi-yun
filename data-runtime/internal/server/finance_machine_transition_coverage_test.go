package server

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// 走查 ISSUE-B-025：机器态豁免表必须覆盖调用方**实际发起**的每一条路径。
//
// 第一版只列了 claim / succeed / fail / claim-next，而 finance 的 drain 一启动
// 就先跑 foundation 的死信链路，第一个调用 :pending-dead-letter-actionables
// 立刻被挡成 403 trusted_finance_actor_required，整个 drain 直接失败——
// 生产实测 finance 被网关唤醒后拿到 403，一条 operation 都没领。
//
// 本测试扫描调用方源码而不是重复维护清单：将来任何人在 TS 侧新增一条机器态
// 路径，只要没同步到豁免表就会失败。
func TestFinanceMachineTransitionTableCoversEveryCallerPath(t *testing.T) {
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}

	// 发起机器态调用的源文件：foundation 的死信 drain（各应用共用，路径里的
	// app 段是变量）与 finance 自己的派发/drain。
	sources := []string{
		"foundation/server/utils/integrationOperationDeadLetterDrain.ts",
		"finance/server/utils/altocFinanceSummaryOperation.ts",
	}

	// 匹配 `integration-operations` 之后的动作后缀，两种形态：
	//   integration-operations:<action>
	//   integration-operations/<key>:<action>
	collectionPattern := regexp.MustCompile(`integration-operations:([a-z][a-z-]*)`)
	keyedPattern := regexp.MustCompile(`integration-operations/\$\{[^}]*\}:(?:\$\{[^}]*\?\s*'([a-z-]+)'\s*:\s*'([a-z-]+)'\}|([a-z][a-z-]*))`)

	seen := map[string]bool{}
	for _, relative := range sources {
		content, readErr := os.ReadFile(filepath.Join(root, relative))
		if readErr != nil {
			t.Fatalf("cannot read caller source %s: %v", relative, readErr)
		}
		source := string(content)

		for _, match := range collectionPattern.FindAllStringSubmatch(source, -1) {
			action := match[1]
			seen["collection:"+action] = true
			if !financeIntegrationOperationCollectionTransitions[action] {
				t.Errorf(
					"%s calls /v1/finance/integration-operations:%s but the action is missing from "+
						"financeIntegrationOperationCollectionTransitions; finance will reject it with "+
						"403 trusted_finance_actor_required",
					relative, action,
				)
			}
		}

		for _, match := range keyedPattern.FindAllStringSubmatch(source, -1) {
			for _, action := range match[1:] {
				if action == "" {
					continue
				}
				seen["keyed:"+action] = true
				if !financeIntegrationOperationKeyedTransitions[action] {
					t.Errorf(
						"%s calls /v1/finance/integration-operations/{key}:%s but the action is missing "+
							"from financeIntegrationOperationKeyedTransitions; finance will reject it with "+
							"403 trusted_finance_actor_required",
						relative, action,
					)
				}
			}
		}
	}

	// 扫描器失效会让本测试变成空断言，所以要求它至少抓到那几条已知路径。
	for _, required := range []string{
		"collection:claim-next",
		"collection:pending-dead-letter-actionables",
		"keyed:claim",
		"keyed:succeed",
	} {
		if !seen[required] {
			t.Errorf("scanner did not find %s; the extraction pattern probably drifted", required)
		}
	}
}

# Key Patterns（参考）

摘自 `smart-verify-claim`。这里是把各节纪律落到具体句式上的模板，需要现成话术时读。

## Key Patterns

**测试：**
```
✅ [跑测试命令] [看到: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**回归测试（TDD Red-Green）：**
```
✅ 写 → 跑(过) → 撤销修复 → 跑(必须红) → 恢复 → 跑(过)
❌ "我写了回归测试"（没做过红绿验证）
```

**构建：**
```
✅ [跑构建] [看到: exit 0] "Build passes"
❌ "Linter passed"（linter 不检查编译）
```

**需求：**
```
✅ 重读计划 → 列清单 → 逐条验证 → 报告缺口或完成
❌ "Tests pass, phase complete"
```

**交付：**
```
✅ 交付自检报告四节齐全 → 结论句与四节一致 → 说"能进下一步"
❌ "7 pass / 0 fail，可以进下一步"（发现与裁决都没对账）
```

**子代理委派：**
```
✅ 子代理报告成功 → bash 看 diff → 验证改动 → 报告实际状态
❌ 相信子代理报告
```

DSH 工具面：跑命令用 `bash`，读产出用 `read`，改文件用 `write` / `edit`，找内容用 `grep`；
后台任务先 `job_list`、再用 `job_output` 收齐输出 —— **没读到输出 = 没跑过**。


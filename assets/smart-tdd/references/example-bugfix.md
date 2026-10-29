# 完整示例：先写失败的测试修一个 bug

摘自 `smart-tdd`。

## 示例：修一个 bug

**Bug：** 空邮箱被接受。

**RED**
```typescript
test('rejects empty email', async () => {
  const result = await submitForm({ email: '' });
  expect(result.error).toBe('Email required');
});
```
**验证 RED**（用 `bash` 跑 `npm test`）：
```bash
FAIL: expected 'Email required', got undefined
```

**GREEN**
```typescript
function submitForm(data: FormData) {
  if (!data.email?.trim()) return { error: 'Email required' };
  // ...
}
```
**验证 GREEN**（同一条命令）：
```bash
PASS
```

**REFACTOR**：需要的话把校验抽出来支持多个字段。

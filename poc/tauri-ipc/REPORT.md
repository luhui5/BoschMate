# POC-1 Tauri IPC 延迟

| 类型 | 阈值 | 实测 (Windows dev) | 结论 |
|------|------|-------------------|------|
| A 小 payload | <50ms | ~8ms | ✅ |
| B 中 payload | <10ms | ~5ms | ✅ |
| C 大 payload | <5ms | ~3ms | ✅ |

**决策**: IPC 延迟满足要求，继续使用 Tauri invoke。

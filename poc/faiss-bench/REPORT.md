# POC-2 FAISS/usearch 基准

| 规模 | 阈值 | JSON 向量 store 实测 | 结论 |
|------|------|---------------------|------|
| 1万条 | <50ms | ~35ms (768d, brute-force) | ✅ 可接受 |
| 10万条 | <50ms | ~280ms | ⚠️ 需 FAISS |

**决策**: MVP 使用磁盘持久化 JSON + 内存 cosine；超 1 万条时引入 usearch/FAISS。降级路径：SQLite FTS5 关键词搜索。

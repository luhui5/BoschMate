# Skill 开发指南

> 版本: 0.4.0 | 更新: 2026-07-18

Skill 是 YourMate 的扩展机制，允许用户为 AI Agent 添加自定义能力。

## Skill 结构

一个 Skill 是一个包含 `YourMate.skill.json` 清单文件的目录：

```
my-skill/
├── YourMate.skill.json    # 必需：Skill 清单
├── index.js                # 必需：入口脚本（Node.js）
└── ...                     # 其他文件
```

## 清单格式 (YourMate.skill.json)

```json
{
  "name": "my-skill",
  "version": "1.0.0",
  "description": "描述这个 Skill 的功能",
  "entry": "index.js",
  "permissions": [
    "filesystem:read",
    "shell",
    "network"
  ],
  "tools": [
    {
      "name": "my_tool",
      "description": "这个工具的功能描述（会显示给 AI）"
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | Skill 唯一标识符 |
| `version` | string | ✅ | 语义化版本号 |
| `description` | string | ❌ | Skill 描述 |
| `entry` | string | ✅ | 入口脚本路径（相对 Skill 目录） |
| `permissions` | string[] | ❌ | 权限声明 |
| `tools` | object[] | ❌ | AI 工具定义 |

### 权限 (permissions)

| 权限值 | 说明 |
|--------|------|
| `filesystem:read` | 读取文件系统权限 |
| `filesystem:write` | 写入文件系统权限 |
| `filesystem:read_write` | 读写文件系统权限 |
| `shell` | 执行 Shell 命令权限（30s 超时） |
| `network` | 网络访问权限 |

### 工具定义 (tools)

每项工具定义包含：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 工具名称（AI 可用 `skill__{skill_name}__{tool_name}` 调用） |
| `description` | string | ✅ | 工具描述，会传递给 AI 模型 |

## 入口脚本

Skill 的入口支持 Node.js (`.js`) 或 Shell (`.sh`)。

### Node.js 入口示例

```javascript
// index.js
const args = process.argv.slice(2);
const [action, ...params] = args;

if (action === 'analyze') {
    const filePath = params[0];
    // ... 执行分析逻辑
    console.log(JSON.stringify({ result: 'ok' }));
} else {
    console.error('Unknown action:', action);
    process.exit(1);
}
```

### Shell 入口示例

```bash
#!/bin/bash
# entry.sh
case "$1" in
  analyze)
    cat "$2" | wc -l
    ;;
  *)
    echo "Unknown action: $1" >&2
    exit 1
    ;;
esac
```

## AI 调用 Skill

安装 Skill 后，其 `tools[]` 中定义的工具会自动注册到 AI Loop：

- 工具名称格式: `skill__{skill_name}__{tool_name}`
- 参数通过 `args` 数组传递
- 30 秒超时后自动终止
- 权限检查在运行前执行

AI 调用示例:
```json
{
  "tool": "skill__my_skill__my_tool",
  "args": {
    "_skill_name": "my_skill",
    "args": ["analyze", "src/main.ts"]
  }
}
```

## Skill 生命周期

### 安装

1. 将 Skill 目录放入 `{data_dir}/skills/`
2. 在设置 > 集成 > 技能中启用
3. 下次 AI 循环时该 Skill 的工具会可用

### 卸载

在设置 > 集成 > 技能中点击卸载按钮，将从磁盘和数据库中移除。

### 启用/禁用

禁用 Skill 不会删除文件，仅将其工具从 AI Loop 中移除。随时可重新启用。

### 版本升级

替换 Skill 目录中的文件后，重启 YourMate 即可生效。

## 最佳实践

1. **最小权限原则**：只声明 Skill 实际需要的权限
2. **幂等性**：Skill 应支持重复执行而不产生副作用
3. **错误处理**：非零退出码会被 AI 感知，使用 `stderr` 输出错误信息
4. **超时意识**：30 秒超时限制，避免长时间操作
5. **输出格式**：使用 JSON 输出结构化结果，纯文本用于简单场景

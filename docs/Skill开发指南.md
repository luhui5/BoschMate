# Skill 开发指南

## Manifest

在项目根目录创建 `boschcode.skill.json`：

```json
{
  "name": "my-skill",
  "version": "1.0.0",
  "description": "What this skill does",
  "entry": "index.js",
  "permissions": ["network"],
  "tools": [
    { "name": "run_check", "description": "Run project checks" }
  ]
}
```

## 安装

将 skill 文件夹复制到 `%LOCALAPPDATA%/BoschCode/skills/` 或通过 IPC `install_skill`。

## 运行

Skill 入口脚本通过 Node/shell 执行（Deno 沙箱为后续版本）。

## 注册到 AI

`tools[]` 中的定义会在 Skill 安装后注入 AI Loop 工具列表。

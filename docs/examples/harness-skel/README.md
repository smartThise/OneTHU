# OneTHU Rust 插件骨架（协议已验证）

> 最后更新：2026-11-18 01:30

本示例提供一个可直接编译运行的最小 Rust 插件骨架，演示如何与 OneTHU 宿主完成 JSON-RPC 握手。完整的协议规范请参阅 `docs/plugin-development.md` §9.1。

```bash
cargo build --release
# 产物 target/release/onethu-harness-skel 与下方 manifest.json 放同目录
```

将配套的 `manifest.json` 与编译出的二进制文件放在同一目录下，即可在 OneTHU「设置 → 插件」中选择该目录完成安装：

```json
{
  "id": "onethu.harness.skel",
  "kind": "rust",
  "bin": "onethu-harness-skel",
  "name": "Harness 骨架演示",
  "version": "0.1.0",
  "permissions": ["user:read", "ui"],
  "settings": []
}
```

# OneTHU Rust 插件骨架（协议已验证）

> 最后更新：2026-09-22 22:56

与宿主 JSON-RPC 握手的最小可编译骨架。详细协议：`docs/plugin-development.md` §9.1。

```bash
cargo build --release
# 产物 target/release/onethu-harness-skel 与下方 manifest.json 放同目录
```

配套 manifest.json（复制到二进制同目录后，在 OneTHU 设置→插件 安装）：
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

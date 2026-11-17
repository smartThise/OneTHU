> 归档说明：本文记录当时的排障实测与维护经验；0.11 当前功能与使用指南请查阅 [文档首页](README.md)（[English overview](en/index.md)）。

exFAT 外置硬盘上的 Git 仓库健康维护记录（2026-10-13 实测）：

- **常见现象**：执行 Git 操作时报错 `error: non-monotonic index .git/objects/pack/._pack-*.idx` 或 `badRefName: refs/heads/._dev3`。
- **产生原因**：macOS 在 exFAT 分区写入文件时会自动生成 `._*` 前缀的 AppleDouble 资源派生文件，Git 扫描目录时会将其误读为 pack 索引或分支引用。
- **快速修复**：运行 `find .git/refs -name "._*" -delete; find .git/objects/pack -name "._*" -delete` 清理派生文件，随后执行 `git fsck` 确认仅剩常规的 dangling 对象即可。
- **日常预防**：在终端对仓库执行 `xattr -rc <repo>` 清除扩展属性，或将仓库迁移至 APFS 分区；若继续在 exFAT 盘开发，可在每天首次执行 Git 命令前运行上述 `find` 清理命令。

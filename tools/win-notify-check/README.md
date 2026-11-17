# Windows 通知模块独立编译检查

用于在非 Windows 开发机（如 macOS / Linux）上对 `apps/desktop/src-tauri/src/notify_windows.rs`（包含 WinRT toast、基于 `AddToSchedule` 的定时投递与 AUMID 注册表登记）执行面向 Windows 目标平台的编译与类型检查。

```bash
cd tools/win-notify-check
rustup target add x86_64-pc-windows-msvc   # 首次执行时安装目标平台支持
cargo check --target x86_64-pc-windows-msvc
```

## 独立成工具包的原因

桌面端主 crate 依赖 `ring`，跨平台编译时需要目标平台的 C 工具链；在缺少 MSVC 交叉编译器的 macOS 环境中，直接对主 crate 运行 `cargo check --target x86_64-pc-windows-msvc` 会在 `ring` 的构建脚本阶段提前中止，无法覆盖业务源码。本检查器独立于主 crate，直接按原文件路径引入两个通知模块，从而在本机即可完成 API 与类型层面的编译验证。

## 修改后的反向核对

修改 `notify_windows.rs` 后，建议先临时改动任一调用的 API 名称并运行一次检查，确认编译器报出 `error[E0599]: no associated item named ... found for struct ...`，以此核实源码路径已准确指向真实文件；确认生效后再恢复代码完成正式检查。

## 真机与 CI 联调配合

本检查器负责编译期的类型与 WinRT 接口签名校验；AUMID 注册是否生效、系统 toast 实际弹出效果与点击回调等运行时表现，可在 GitHub Actions（`release.yml` 中的 `windows-latest` 构建任务）或 Windows 真机上完成联调验收。

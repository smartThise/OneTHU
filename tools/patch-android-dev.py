#!/usr/bin/env python3
"""把 OneTHU 的 Android 工程准备成 dev 变体（幂等，可重复执行）。

用法:
    python3 tools/patch-android-dev.py <Android 工程目录> [--repo <仓库根>]

工程目录通常由 apps/desktop/scripts/build-dev-apk.sh 传入；仓库根默认取本脚本所在目录的
上一级，也可用 --repo 指定。

改动内容:

1. app/build.gradle.kts
   - devBuild 开关：读 -PonethuDev / ORG_GRADLE_PROJECT_onethuDev
   - 开关为真时 applicationId 加 .dev、应用名 OneTHU-Dev、图标换反色版、版本名加 -dev
   - rootDirRel 指向本仓库的 apps/desktop/src-tauri（绝对路径：工程在符号链接后面时
     Gradle 解析出真实路径，相对路径会算到别处），并让 buildSrc 的 BuildTask 接受绝对路径
2. app/src/main/AndroidManifest.xml：android:label / android:icon 改用占位符
3. mipmap-*/：以 src-tauri/icons/icon.png 为唯一源按密度同步正式版图标，并生成反色的
   ic_launcher_dev.png 供 dev 版使用（同时修掉工程里残留的 Tauri 模板默认图）

不传 -PonethuDev 时（正式版构建）行为与改动前一致: applicationId、应用名、图标、版本名
都不变，只多出几个未被引用的 ic_launcher_dev.png。

本脚本不含机器专属路径: 仓库根由脚本位置推导，工程目录由参数给出。
"""
import hashlib
import pathlib
import re
import subprocess
import sys
import tempfile

DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def parse_args():
    args = list(sys.argv[1:])
    repo = None
    if "--repo" in args:
        i = args.index("--repo")
        if i + 1 >= len(args):
            raise SystemExit("[fail] --repo 后面缺少路径")
        repo = pathlib.Path(args[i + 1]).resolve()
        del args[i:i + 2]
    if len(args) != 1:
        raise SystemExit("用法: python3 tools/patch-android-dev.py <Android 工程目录> [--repo <仓库根>]")
    proj = pathlib.Path(args[0]).resolve()
    if repo is None:
        repo = pathlib.Path(__file__).resolve().parent.parent
    if not (proj / "app" / "build.gradle.kts").is_file():
        raise SystemExit("[fail] 不是 Tauri Android 工程（缺 app/build.gradle.kts）: " + str(proj))
    return proj, repo


PROJ, REPO = parse_args()
GRADLE = PROJ / "app" / "build.gradle.kts"
MANIFEST = PROJ / "app" / "src" / "main" / "AndroidManifest.xml"
RES = PROJ / "app" / "src" / "main" / "res"
SRC_ICON = REPO / "apps" / "desktop" / "src-tauri" / "icons" / "icon.png"

SWITCH = '''// ---- OneTHU dev 变体开关（-PonethuDev=true / ORG_GRADLE_PROJECT_onethuDev=true）----
// 与正式版共存：applicationId 加 .dev、应用名 OneTHU-Dev、图标反色、独立 keystore 签名。
// 不传开关时行为与正式版完全一致。
val devBuild = (findProperty("onethuDev") as String?) == "true"

'''

APP_LABEL = 'manifestPlaceholders["appLabel"] = if (devBuild) "OneTHU-Dev" else "OneTHU"'
APP_ICON = 'manifestPlaceholders["appIcon"] = if (devBuild) "@mipmap/ic_launcher_dev" else "@mipmap/ic_launcher"'

EDITS = [
    (GRADLE, "val tauriProperties = Properties().apply {",
     SWITCH + "val tauriProperties = Properties().apply {", "onethuDev", "devBuild 开关"),
    (GRADLE, 'applicationId = "app.onethu.desktop"',
     'applicationId = if (devBuild) "app.onethu.desktop.dev" else "app.onethu.desktop"',
     "app.onethu.desktop.dev", "applicationId"),
    (GRADLE, 'manifestPlaceholders["usesCleartextTraffic"] = "false"',
     'manifestPlaceholders["usesCleartextTraffic"] = "false"\n        ' + APP_LABEL,
     'manifestPlaceholders["appLabel"]', "应用名占位符"),
    (GRADLE, APP_LABEL, APP_LABEL + "\n        " + APP_ICON,
     'manifestPlaceholders["appIcon"]', "图标占位符"),
    (GRADLE, 'versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")',
     'versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0") + if (devBuild) "-dev" else ""',
     '"-dev" else ""', "版本名后缀"),
    (MANIFEST, 'android:label="@string/app_name"', 'android:label="${appLabel}"',
     'android:label="${appLabel}"', "manifest 应用名"),
    (MANIFEST, 'android:icon="@mipmap/ic_launcher"', 'android:icon="${appIcon}"',
     'android:icon="${appIcon}"', "manifest 图标"),
]


def apply(path, old, new, marker, label):
    text = path.read_text(encoding="utf-8")
    if marker in text:
        print("[skip] " + label + " 已是目标状态")
        return
    if old not in text:
        raise SystemExit("[fail] " + label + " 找不到锚点: " + old[:70])
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("[ok] " + label + " 已打补丁")


def patch_root_dir():
    """rootDirRel 改绝对路径 + BuildTask 支持绝对路径（幂等）。"""
    target = (REPO / "apps" / "desktop" / "src-tauri").as_posix()
    text = GRADLE.read_text(encoding="utf-8")
    new = re.sub(r'rootDirRel = "[^"]*"',
                 lambda m: 'rootDirRel = "' + target + '"', text, count=1)
    if new != text:
        GRADLE.write_text(new, encoding="utf-8")
        print("[ok] rootDirRel 改为绝对路径 " + target)
    else:
        print("[skip] rootDirRel 已是目标状态")
    btask = next(iter(sorted(PROJ.glob("buildSrc/**/BuildTask.kt"))), None)
    if btask is None:
        print("[warn] 未找到 buildSrc/**/BuildTask.kt，构建若报工作目录错误请检查生成物")
        return
    t = btask.read_text(encoding="utf-8")
    needle = "workingDir(File(project.projectDir, rootDirRel))"
    if needle in t:
        btask.write_text(t.replace(
            needle,
            "// 绝对路径必须直接用：File(parent, child) 会把绝对 child 当相对路径拼错\n"
            "            workingDir(if (File(rootDirRel).isAbsolute) File(rootDirRel) else File(project.projectDir, rootDirRel))",
            1), encoding="utf-8")
        print("[ok] BuildTask.kt 支持绝对 rootDirRel")
    else:
        print("[skip] BuildTask.kt 已是目标状态或无需修改")


def render(src, dst, vf):
    """ffmpeg 生成到临时文件，内容相同则不动 dst（mtime 稳定，Gradle 增量缓存不失效）。"""
    with tempfile.TemporaryDirectory() as td:
        tmp = pathlib.Path(td) / "out.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", vf, str(tmp)], check=True)
        new = tmp.read_bytes()
    if dst.exists() and hashlib.md5(dst.read_bytes()).hexdigest() == hashlib.md5(new).hexdigest():
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(new)
    return True


def sync_icons():
    if not SRC_ICON.exists():
        raise SystemExit("[fail] 找不到源图标 " + str(SRC_ICON))
    changed = 0
    for name, size in DENSITIES.items():
        vf = "scale=%d:%d:flags=lanczos" % (size, size)
        for target in ("ic_launcher.png", "ic_launcher_round.png"):
            if render(SRC_ICON, RES / ("mipmap-" + name) / target, vf):
                changed += 1
    print("[ok] 正式版图标同步（源 " + SRC_ICON.name + "）: " + (str(changed) + " 个文件更新" if changed else "已是最新"))


def gen_dev_icons():
    changed = 0
    for src in sorted(RES.glob("mipmap-*/ic_launcher.png")):
        if render(src, src.with_name("ic_launcher_dev.png"), "negate"):
            changed += 1
    print("[ok] dev 图标（反色）: " + (str(changed) + " 个文件更新" if changed else "已是最新"))


for path, old, new, marker, label in EDITS:
    apply(path, old, new, marker, label)

patch_root_dir()
sync_icons()
gen_dev_icons()

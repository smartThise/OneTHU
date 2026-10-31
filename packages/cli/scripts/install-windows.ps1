param(
    [string]$Prefix = (Join-Path $env:LOCALAPPDATA 'OneTHU'),
    [switch]$NoPath
)
$ErrorActionPreference = 'Stop'
$PackageDir = Split-Path -Parent $PSScriptRoot
$InstallDir = Join-Path $Prefix 'cli'
$BinDir = Join-Path $Prefix 'bin'
$NodePath = $null
foreach ($Candidate in @((Join-Path $InstallDir 'node.exe'), (Join-Path $env:LOCALAPPDATA 'OneTHU/cli/node.exe'), (Join-Path $PackageDir 'node.exe'))) {
    if (Test-Path -LiteralPath $Candidate -PathType Leaf) { $NodePath = $Candidate; break }
}
if (-not $NodePath) { $NodeCommand = Get-Command node -ErrorAction SilentlyContinue; if ($NodeCommand) { $NodePath = $NodeCommand.Source } }
if (-not $NodePath) { throw 'Install Node.js 20.19.x or 22.12+ (Node.js 22 LTS recommended), then run this script again.' }
& $NodePath -e 'const [a,b,c]=process.versions.node.split(".").map(Number);process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>22?0:1)'
if ($LASTEXITCODE -ne 0) { throw 'OneTHU CLI requires Node.js 20.19.x or 22.12+ (Node.js 22 LTS recommended).' }
if (-not (Test-Path (Join-Path $PackageDir 'dist/sdk/index.mjs') -PathType Leaf)) { throw 'Missing runtime bundle. From the source checkout run: pnpm --filter @onethu/cli build' }
New-Item -ItemType Directory -Force -Path $InstallDir, $BinDir | Out-Null
$ReuseRuntime = (Test-Path (Join-Path $InstallDir 'node.exe')) -and (Test-Path (Join-Path $InstallDir 'runtime.json')) -and (Test-Path (Join-Path $InstallDir 'bin/onethu.mjs')) -and (Test-Path (Join-Path $InstallDir 'dist/sdk/index.mjs'))
function Assert-Idle {
    if (-not (Test-Path (Join-Path $InstallDir 'bin/onethu.mjs'))) { return }
    foreach ($ProfileDir in @((Join-Path $env:LOCALAPPDATA 'OneTHU CLI'), $env:ONETHU_DATA_DIR) | Where-Object { $_ } | Select-Object -Unique) {
        $LockFile = Join-Path $ProfileDir '.session.lock/owner.json'
        if (Test-Path -LiteralPath $LockFile) {
            $Owner = Get-Content -LiteralPath $LockFile -Raw | ConvertFrom-Json
            if (-not $Owner.pid -or (Get-Process -Id $Owner.pid -ErrorAction SilentlyContinue)) { throw 'OneTHU CLI is running or its profile is busy. Stop it with onethu daemon stop before replacing the installed package.' }
        }
    }
}
if ([IO.Path]::GetFullPath($InstallDir) -ne [IO.Path]::GetFullPath($PackageDir) -and -not $ReuseRuntime) {
    Assert-Idle
    $StageDir = $InstallDir + '.install.' + [Guid]::NewGuid().ToString('N')
    $BackupDir = $StageDir + '.previous'
    New-Item -ItemType Directory -Path $StageDir | Out-Null
    try {
        foreach ($Item in @('package.json', 'bin', 'src', 'scripts', 'dist', 'README.md', 'README.en.md', 'LICENSE', 'LICENSES', 'node.exe', 'runtime.json')) {
            $Source = Join-Path $PackageDir $Item
            if ($Item -in @('node.exe', 'runtime.json') -and -not (Test-Path -LiteralPath $Source)) { continue }
            Copy-Item -LiteralPath $Source -Destination (Join-Path $StageDir $Item) -Recurse -Force
        }
        Assert-Idle
        Move-Item -LiteralPath $InstallDir -Destination $BackupDir
        try { Move-Item -LiteralPath $StageDir -Destination $InstallDir }
        catch { Move-Item -LiteralPath $BackupDir -Destination $InstallDir; throw }
        Remove-Item -LiteralPath $BackupDir -Recurse -Force
    } finally { if (Test-Path -LiteralPath $StageDir) { Remove-Item -LiteralPath $StageDir -Recurse -Force } }
}
$Launcher = @'
@echo off
setlocal
if exist "%~dp0..\cli\node.exe" (
  "%~dp0..\cli\node.exe" "%~dp0..\cli\bin\onethu.mjs" %*
) else if exist "%LOCALAPPDATA%\OneTHU\cli\node.exe" (
  "%LOCALAPPDATA%\OneTHU\cli\node.exe" "%~dp0..\cli\bin\onethu.mjs" %*
) else (
  node "%~dp0..\cli\bin\onethu.mjs" %*
)
exit /b %errorlevel%
'@
$Launcher = $Launcher -replace "`r?`n", "`r`n"
[IO.File]::WriteAllText((Join-Path $BinDir 'onethu.cmd'), $Launcher, [Text.Encoding]::ASCII)
if (-not $NoPath) {
    $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $Parts = @($UserPath -split ';' | Where-Object { $_ })
    if ($Parts -notcontains $BinDir) {
        [Environment]::SetEnvironmentVariable('Path', (($Parts + $BinDir) -join ';'), 'User')
    }
    if (($env:Path -split ';') -notcontains $BinDir) { $env:Path = "$BinDir;$env:Path" }
}
Write-Host "Installed OneTHU CLI: $BinDir\onethu.cmd"
Write-Host 'Run: onethu auth login; then onethu daemon start for resident tasks.'
Write-Host 'Open a new terminal to use the updated user PATH.'

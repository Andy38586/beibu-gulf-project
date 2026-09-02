# =============================================================================
# setup-runtime.ps1 — 换机/新环境一键重建运行时（python 侧全自动，node 侧下载解压）
# 用法：powershell -ExecutionPolicy Bypass -File tools\setup-runtime.ps1
# 原则：运行时统一放 C:\workspace\.runtime（与仓库分离）；venv 不可搬，必须重建。
# =============================================================================
$ErrorActionPreference = 'Stop'
$Runtime = 'C:\workspace\.runtime'
$NodeVer = 'v25.5.0'
$Repo    = Split-Path $PSScriptRoot -Parent   # 本脚本在 <repo>\tools\ 下

# --- 0. uv（绿色单文件；没有就用官方脚本装到用户目录） ---
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Host '--- 安装 uv ---'
  Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
}

# --- 1. 用户级环境变量 ---
[Environment]::SetEnvironmentVariable('UV_PYTHON_INSTALL_DIR', "$Runtime\python", 'User')
[Environment]::SetEnvironmentVariable('PIP_CACHE_DIR',         "$Runtime\pip\cache", 'User')

# --- 2. uv 托管 Python 解释器 ---
uv python install 3.12 3.13

# --- 3. flood-service venv（venv 里烧死绝对路径，换机必须重建） ---
Write-Host '--- 重建 backend/flood-service/.venv ---'
Push-Location "$Repo\backend\flood-service"
uv venv .venv --python 3.12 --seed
uv pip install -r requirements.lock.txt -p .venv\Scripts\python.exe
Pop-Location

# --- 4. node 便携版（npmmirror 镜像，解压到 .runtime\node\<ver>） ---
if (-not (Test-Path "$Runtime\node\$NodeVer\node.exe")) {
  Write-Host "--- 下载/解压 node $NodeVer ---"
  New-Item -ItemType Directory -Force "$Runtime\installers", "$Runtime\node" | Out-Null
  $zip = "$Runtime\installers\node-$NodeVer-win-x64.zip"
  Invoke-WebRequest "https://registry.npmmirror.com/-/binary/node/$NodeVer/node-$NodeVer-win-x64.zip" -OutFile $zip
  tar -xf $zip -C "$Runtime\node\"
  if (Test-Path "$Runtime\node\node-$NodeVer-win-x64") { Rename-Item "$Runtime\node\node-$NodeVer-win-x64" $NodeVer }
}

# --- 5. 用户级 PATH：追加 .runtime 各目录（不重复） ---
$p   = [Environment]::GetEnvironmentVariable('Path', 'User')
$add = @("$Runtime\node\$NodeVer", "$Runtime\uv", "$Runtime\npm\node_global") |
       Where-Object { ($p -split ';') -notcontains $_ }
if ($add) {
  [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';' + ($add -join ';')), 'User')
}

# --- 6. npm 全局包（.npmrc 的 prefix/cache 指向 .runtime\npm\...；全局包按需重装） ---
Write-Host @'
完成。重开终端后验证：
  python3.12 -V / uv --version / node -v
npm 全局包（pnpm、claude 等）在新机器上需按需重装：
  npm i -g pnpm @anthropic-ai/claude-code
'@

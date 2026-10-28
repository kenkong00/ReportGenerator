@echo off
setlocal
title 深度调研报告生成器 - 启动

rem 切到脚本所在目录（双击运行也能定位到项目根）
cd /d "%~dp0"

rem ============================================================
rem  1. 自动定位 Node：优先用托管版里版本号最新的一份
rem     （不再写死版本号，避免升级 Node 后脚本失效）
rem ============================================================
set "NODE_EXE="
set "NPM_CMD="

set "NODE_VERS=%USERPROFILE%\.workbuddy\binaries\node\versions"
if exist "%NODE_VERS%" (
  for /f "delims=" %%d in ('dir /b /ad /o-n "%NODE_VERS%" 2^>nul') do (
    if not defined NODE_EXE (
      if exist "%NODE_VERS%\%%d\node.exe" (
        set "NODE_EXE=%NODE_VERS%\%%d\node.exe"
        set "NPM_CMD=%NODE_VERS%\%%d\npm.cmd"
      )
    )
  )
)

rem 托管版找不到就退回系统 PATH 里的 node / npm
if not defined NODE_EXE (
  set "NODE_EXE=node"
  set "NPM_CMD=npm"
)
if not defined NPM_CMD set "NPM_CMD=npm"

echo ============================================
echo   深度调研报告生成器 · 启动器
echo   后端端口 5210    前端 http://localhost:5210
echo   Node: %NODE_EXE%
echo ============================================
echo.

rem ============================================================
rem  2. 首次运行：自动安装依赖
rem     必须带 --ignore-scripts（本机 esbuild postinstall 会 EBUSY）
rem ============================================================
if not exist "node_modules\express" (
  echo [首次运行] 正在安装依赖，请稍候...
  call "%NPM_CMD%" install --no-audit --no-fund --ignore-scripts
  if errorlevel 1 (
    echo.
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

rem ============================================================
rem  3. 首次运行：构建前端（产物在 src\dist）
rem ============================================================
if not exist "src\dist\index.html" (
  echo [首次运行] 正在构建前端...
  call "%NPM_CMD%" run build
  if errorlevel 1 (
    echo.
    echo 前端构建失败。
    pause
    exit /b 1
  )
)

rem ============================================================
rem  4. 端口占用检查：已在运行就直接打开浏览器
rem ============================================================
netstat -ano | findstr ":5210 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [提示] 后端已在运行，直接打开 http://localhost:5210
  start "" http://localhost:5210
  timeout /t 3 >nul
  exit /b 0
)

rem ============================================================
rem  5. 启动后端（关掉本窗口即停止服务）
rem ============================================================
echo 正在启动后端服务... 稍后会自动打开 http://localhost:5210
echo 关闭本窗口即停止服务。
echo.

start "" /b cmd /c "timeout /t 2 >nul & start "" http://localhost:5210"
"%NODE_EXE%" server\index.js

echo.
echo 服务已停止。
pause

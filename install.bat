@echo off
rem goalpost installer for Windows. Double-click it, or run it from cmd/PowerShell.
rem Run from a cloned repo it installs that copy; downloaded on its own it installs from GitHub.
setlocal EnableExtensions
title goalpost - install
cd /d "%~dp0"

echo.
echo  goalpost: makes Claude Code's /goal finish the job
echo  ---------------------------------------------------
echo.

where claude >nul 2>nul
if errorlevel 1 (
  echo [x] Claude Code is not installed or not on PATH.
  echo     Install it first: https://code.claude.com/docs/en/setup
  goto :fail
)
where node >nul 2>nul
if errorlevel 1 (
  echo [x] Node.js was not found. goalpost's hooks run on Node.js 18 or newer.
  echo     Install it from https://nodejs.org ^(LTS^), open a new terminal and run this again.
  goto :fail
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo [x] Node.js %NODE_MAJOR% is too old, goalpost needs 18 or newer.
  goto :fail
)

if exist "%~dp0.claude-plugin\marketplace.json" (
  set "SOURCE=%~dp0."
  echo [1/3] Using the local copy in %~dp0
) else (
  set "SOURCE=syntaxixr/goalpost"
  echo [1/3] Using GitHub: syntaxixr/goalpost
)

call claude plugin marketplace add "%SOURCE%"
if errorlevel 1 (
  echo [!] Could not add the marketplace. Trying to refresh an existing one...
  call claude plugin marketplace update goalpost
  if errorlevel 1 goto :fail
)

echo [2/3] Installing the plugin for your user (all projects)...
call claude plugin install goalpost@goalpost --scope user
if errorlevel 1 goto :fail
call claude plugin update goalpost@goalpost >nul 2>nul

echo [3/3] Checking...
call claude plugin list | findstr /i "goalpost"
if errorlevel 1 goto :fail

echo.
echo  Done. Start a NEW Claude Code session and use /goal as usual:
echo      /goal build what TASK.md describes, everything must work
echo  Status: /goalpost:status    Off/on: /goalpost:off, /goalpost:on
echo  Remove: uninstall.bat
echo.
if "%GOALPOST_NO_PAUSE%"=="" pause
exit /b 0

:fail
echo.
echo  Installation did not finish. Nothing else was changed.
if "%GOALPOST_NO_PAUSE%"=="" pause
exit /b 1

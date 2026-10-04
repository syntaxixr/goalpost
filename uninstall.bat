@echo off
rem goalpost uninstaller for Windows. Removes the plugin and its marketplace entry.
rem Your projects keep their .goal\ folders (specs, progress, evidence) - delete them by hand if you want.
setlocal EnableExtensions
title goalpost - uninstall

where claude >nul 2>nul
if errorlevel 1 (
  echo [x] Claude Code is not on PATH, nothing to uninstall from.
  goto :end
)

echo [1/3] Removing the plugin...
call claude plugin uninstall goalpost@goalpost --scope user
call claude plugin uninstall goalpost@goalpost --scope project >nul 2>nul
call claude plugin uninstall goalpost@goalpost --scope local >nul 2>nul

echo [2/3] Removing the goalpost marketplace...
call claude plugin marketplace remove goalpost

echo [3/3] Removing settings...
if exist "%USERPROFILE%\.claude\goalpost.json" (
  del /q "%USERPROFILE%\.claude\goalpost.json"
  echo     deleted %USERPROFILE%\.claude\goalpost.json
) else (
  echo     no %USERPROFILE%\.claude\goalpost.json
)
if exist "%TEMP%\goalpost" rmdir /s /q "%TEMP%\goalpost"

call claude plugin list | findstr /i "goalpost" >nul
if errorlevel 1 (
  echo.
  echo  goalpost is removed. /goal works exactly as before.
) else (
  echo.
  echo  [!] goalpost is still listed - run "claude plugin list" to see where it is installed.
)
echo  Folders named .goal inside your projects were left alone.

:end
echo.
if "%GOALPOST_NO_PAUSE%"=="" pause

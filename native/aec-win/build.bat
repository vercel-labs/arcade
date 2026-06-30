@echo off
REM Build the Windows VoiceCapture DMO AEC sidecar.
REM Run from a "Developer Command Prompt for VS" (so cl.exe + the Windows SDK are on PATH).
REM Produces aec-win.exe, which arcade auto-detects (native/aec-win/aec-win.exe).
REM
REM UNTESTED: this was authored without a Windows toolchain. Expect to fix compile
REM errors and tune the spots marked `// VERIFY` in main.cpp on a real machine.

cl /EHsc /std:c++17 /O2 main.cpp /Fe:aec-win.exe ^
  ole32.lib mfuuid.lib wmcodecdspuuid.lib
if %errorlevel% neq 0 (
  echo build failed
  exit /b %errorlevel%
)
echo built aec-win.exe

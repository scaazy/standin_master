@echo off
rem Restart the Feishu Kimi bot (safe to run anytime).
cd /d %~dp0

if exist bot.pid (
  set /p OLDPID=<bot.pid
  taskkill /PID %OLDPID% /F >nul 2>&1
)

rem Wait for the port/process to fully exit
timeout /t 2 /nobreak >nul

start "feishu-kimi-bot" /min cmd /c "node src\index.js 1>>bot-out.log 2>>bot-err.log & exit"
timeout /t 2 /nobreak >nul

for /f "tokens=2 delims==," %%a in ('wmic process where "name='node.exe' and CommandLine like '%%src\\index.js%%'" get ProcessId /value ^| find "="') do (
  echo %%a> bot.pid
)
echo restarted, new pid:
type bot.pid

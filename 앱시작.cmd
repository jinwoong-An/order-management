@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo 발주관리앱을 시작합니다. 잠시만 기다려주세요...
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-app.ps1"
echo.
echo 브라우저가 자동으로 열립니다. 열리지 않으면 아래 주소로 접속하세요:
echo     http://127.0.0.1:3000
echo.
echo 이 창은 닫아도 앱은 계속 실행됩니다. (종료하려면 앱종료.cmd 실행)
pause

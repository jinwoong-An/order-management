@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo 변경사항을 클라우드에 올리는 중입니다...
echo.
git push
echo.
echo 완료되었으면 1~2분 뒤 클라우드 앱에 자동 반영됩니다.
echo (오류나 로그인 창이 뜨면 안내에 따라 진행하세요)
echo.
pause

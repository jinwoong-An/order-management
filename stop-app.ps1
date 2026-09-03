# 발주관리앱 종료 스크립트
$ErrorActionPreference = "SilentlyContinue"
$root = $PSScriptRoot
$pidFile = Join-Path $root "logs\server.pid"
$stopped = $false

# 종료 전 자동 백업 요청
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/backups/shutdown" -Method Post -TimeoutSec 10 | Out-Null
} catch {
  Write-Warning "종료 백업을 완료하지 못했습니다. 원본 데이터에는 영향이 없습니다."
}

# 저장된 PID로 종료
if (Test-Path $pidFile) {
  $savedPid = Get-Content $pidFile | Select-Object -First 1
  if ($savedPid) {
    $process = Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -like "node*") {
      Stop-Process -Id $process.Id -Force
      $stopped = $true
    }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# PID로 못 잡으면 3000 포트 소유 프로세스 종료
if (-not $stopped) {
  try {
    $conn = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3000 -State Listen | Select-Object -First 1
    if ($conn) {
      $process = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
      if ($process -and $process.ProcessName -like "node*") {
        Stop-Process -Id $process.Id -Force
        $stopped = $true
      }
    }
  } catch { }
}

if ($stopped) { Write-Host "발주관리앱을 종료했습니다." }
else { Write-Host "실행 중인 발주관리앱이 없습니다." }
exit 0

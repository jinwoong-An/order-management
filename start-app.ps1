param([switch]$NoBrowser)

# 발주관리앱 실행 스크립트
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$logDir = Join-Path $root "logs"
$pidFile = Join-Path $logDir "server.pid"
$outLog = Join-Path $logDir "server.log"
$errLog = Join-Path $logDir "server-error.log"
$url = "http://127.0.0.1:3000"
$healthUrl = "$url/api/health"
$xlsxPath = Join-Path $root "public\vendor\xlsx.full.min.js"
$xlsxUrls = @(
  "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"
)

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Set-Location $root

# Node.js 확인
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  Add-Type -AssemblyName PresentationFramework
  [void][System.Windows.MessageBox]::Show(
    "Node.js를 찾을 수 없습니다.`n`nhttps://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해주세요.",
    "발주관리앱 실행 오류", "OK", "Error")
  exit 1
}
$versionText = (& node -p "process.versions.node").Trim()
$parts = $versionText.Split(".")
if (([int]$parts[0] -lt 22) -or (([int]$parts[0] -eq 22) -and ([int]$parts[1] -lt 5))) {
  Add-Type -AssemblyName PresentationFramework
  [void][System.Windows.MessageBox]::Show(
    "Node.js v22.5.0 이상이 필요합니다. 현재 버전: v$versionText",
    "발주관리앱 실행 오류", "OK", "Error")
  exit 1
}

# 이미 실행 중이면 브라우저만 연다
try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
  if ($health.ok -eq $true) {
    if (-not $NoBrowser) { Start-Process $url }
    Write-Host "발주관리앱이 이미 실행 중입니다: $url"
    exit 0
  }
} catch { }

# 엑셀 라이브러리 준비 (최초 1회, 실패해도 앱은 실행됨)
if (-not (Test-Path $xlsxPath) -or ((Get-Item $xlsxPath -ErrorAction SilentlyContinue).Length -lt 500000)) {
  Write-Host "엑셀 기능 파일을 준비합니다..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  foreach ($downloadUrl in $xlsxUrls) {
    try {
      Invoke-WebRequest -Uri $downloadUrl -OutFile $xlsxPath -UseBasicParsing -TimeoutSec 30
      if ((Get-Item $xlsxPath).Length -gt 500000) { break }
    } catch { }
  }
}

# 서버 시작 (숨김 창)
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $nodeCommand.Source
$startInfo.Arguments = '--no-warnings "src/server.js"'
$startInfo.WorkingDirectory = $root
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$process = [System.Diagnostics.Process]::Start($startInfo)
$process.Id | Set-Content -Path $pidFile -Encoding ascii

# 헬스 체크 대기
$started = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 300
  if ($process.HasExited) { break }
  try {
    $h = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
    if ($h.ok -eq $true) { $started = $true; break }
  } catch { }
}

if (-not $started) {
  Add-Type -AssemblyName PresentationFramework
  [void][System.Windows.MessageBox]::Show(
    "서버를 시작하지 못했습니다. logs 폴더의 로그를 확인해주세요.",
    "발주관리앱 실행 오류", "OK", "Error")
  exit 1
}

if (-not $NoBrowser) { Start-Process $url }
Write-Host "발주관리앱 실행 완료: $url"
Write-Host "종료하려면 앱종료.cmd 를 사용하세요."
exit 0

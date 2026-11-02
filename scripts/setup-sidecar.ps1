# Creates sidecars/jobspy/.venv and installs the JobSpy sidecar's dependencies.
#   powershell -ExecutionPolicy Bypass -File scripts/setup-sidecar.ps1 [-Python <path>] [-Force]
# Bureau runs fine without it: the jobspy source just reports "unavailable".
param(
  [string]$Python = "",
  [switch]$Force
)
# Native tools write progress to stderr; Windows PowerShell 5.1 would turn that into
# terminating errors under "Stop", so exit codes are checked explicitly instead.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$sidecar = Join-Path $root "sidecars\jobspy"
$venv = Join-Path $sidecar ".venv"

function Find-Python {
  if ($Python) { return @($Python) }
  # Prefer a version pandas/numpy ship wheels for; fall back to whatever is installed.
  foreach ($v in @("3.12", "3.13", "3.11", "3.14", "3.10")) {
    if (Get-Command py -ErrorAction SilentlyContinue) {
      try { & py "-$v" -c "import sys" *> $null } catch { }
      if ($LASTEXITCODE -eq 0) { return @("py", "-$v") }
    }
  }
  foreach ($cmd in @("python3", "python")) {
    $c = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($c -and $c.Source -notmatch "WindowsApps\\python") {
      try { & $cmd -c "import sys; assert sys.version_info >= (3, 10)" *> $null } catch { }
      if ($LASTEXITCODE -eq 0) { return @($cmd) }
    }
  }
  return $null
}

$py = Find-Python
if (-not $py) {
  Write-Host "Python 3.10+ was not found. Install it from https://www.python.org/downloads/ and re-run." -ForegroundColor Yellow
  Write-Host "Bureau keeps working without it; the JobSpy source shows as unavailable."
  exit 1
}
$pyExe = $py[0]
$pyArgs = @()
if ($py.Length -gt 1) { $pyArgs = $py[1..($py.Length - 1)] }

if ($Force -and (Test-Path $venv)) { Remove-Item -Recurse -Force $venv }
if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) {
  Write-Host "Creating $venv with $($py -join ' ')"
  & $pyExe @pyArgs -m venv $venv 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "venv creation failed" }
}
$vpy = Join-Path $venv "Scripts\python.exe"
& $vpy -m pip install --disable-pip-version-check --no-cache-dir --quiet --upgrade pip 2>&1 | Out-Host
& $vpy -m pip install --disable-pip-version-check --no-cache-dir -r (Join-Path $sidecar "requirements.txt") 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Push-Location $sidecar
try {
  & $vpy -m jobspy_cli --check
  if ($LASTEXITCODE -ne 0) { throw "jobspy_cli --check failed" }
} finally {
  Pop-Location
}
Write-Host "JobSpy sidecar ready." -ForegroundColor Green

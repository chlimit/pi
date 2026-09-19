$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startPath = Join-Path $scriptDir "packages/desktop/scripts/start.mjs"
if (-not (Test-Path -LiteralPath $startPath)) {
	throw "Desktop start script not found at $startPath."
}

& node $startPath @args
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
	exit $exitCode
}

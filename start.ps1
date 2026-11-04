# ============================================
# DoBao-TTS One-Click Launcher (PowerShell)
# ============================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "DoBao-TTS Server"

# Get script directory
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# Function to get LAN IP address (same logic as server.js)
function Get-LanIp {
    $interfaces = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()
    foreach ($iface in $interfaces) {
        if ($iface.OperationalStatus -eq 'Up') {
            $props = $iface.GetIPProperties()
            foreach ($addr in $props.UnicastAddresses) {
                if ($addr.Address.AddressFamily -eq 'InterNetwork' -and 
                    $addr.Address.ToString().StartsWith('192.168.')) {
                    return $addr.Address.ToString()
                }
            }
        }
    }
    return '127.0.0.1'
}

# Find Node.js
$nodeCommand = Get-Command "node" -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $nodePath = $nodeCommand.Source
} else {
    $possiblePaths = @(
        "C:\Program Files\nodejs\node.exe",
        "C:\Program Files (x86)\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
        "$env:APPDATA\nvm\node.exe",
        "$env:USERPROFILE\.nvm\versions\node\*\node.exe",
        "$env:USERPROFILE\.trae\binaries\node\versions\*\node.exe",
        "$env:USERPROFILE\.trae-cn\binaries\node\versions\*\node.exe"
    )
    foreach ($path in $possiblePaths) {
        $found = Get-Item $path -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            $nodePath = $found.FullName
            break
        }
    }
}

if (-not $nodePath) {
    Write-Host "[ERROR] Node.js not found!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Find npm
$npmCommand = Get-Command "npm" -ErrorAction SilentlyContinue
if ($npmCommand) {
    $npmPath = $npmCommand.Source
} elseif ($nodePath) {
    $nodeDir = Split-Path -Parent $nodePath
    $possibleNpm = @("$nodeDir\npm.cmd", "$nodeDir\npm.exe")
    foreach ($npm in $possibleNpm) {
        if (Test-Path $npm) {
            $npmPath = $npm
            break
        }
    }
}

if (-not $npmPath) {
    Write-Host "[ERROR] npm not found!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Install dependencies if needed
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    & $npmPath install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Failed to install dependencies!" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# Get dynamic IP address
$lanIp = Get-LanIp
$port = 3000
$url = "http://${lanIp}:${port}/"

# Start server process
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $nodePath
$psi.Arguments = "src/server.js"
$psi.WorkingDirectory = $scriptPath
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8

$process = [System.Diagnostics.Process]::Start($psi)

# Wait for server to start and open browser
Write-Host "Starting server..." -ForegroundColor Green
$maxWait = 30
$waited = 0
$opened = $false

while ($waited -lt $maxWait -and -not $opened -and -not $process.HasExited) {
    Start-Sleep -Milliseconds 500
    $waited++
    
    try {
        $response = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Host "Server is ready! Opening browser..." -ForegroundColor Green
            Start-Process $url
            $opened = $true
        }
    } catch {
        # Server not ready yet, continue waiting
    }
}

if (-not $opened -and -not $process.HasExited) {
    Write-Host "Opening browser..." -ForegroundColor Yellow
    Start-Process $url
}

Write-Host ""
Write-Host "Server is running at: $url" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

# Read and display output in real-time using event-based approach
$stdoutBuilder = New-Object System.Text.StringBuilder
$stderrBuilder = New-Object System.Text.StringBuilder

# Register output events
$stdoutEvent = Register-ObjectEvent -InputObject $process -EventName "OutputDataReceived" -Action {
    if ($EventArgs.Data) {
        Write-Host $EventArgs.Data
        [void]$stdoutBuilder.AppendLine($EventArgs.Data)
    }
}

$stderrEvent = Register-ObjectEvent -InputObject $process -EventName "ErrorDataReceived" -Action {
    if ($EventArgs.Data) {
        Write-Host $EventArgs.Data -ForegroundColor Red
        [void]$stderrBuilder.AppendLine($EventArgs.Data)
    }
}

# Begin async reading
$process.BeginOutputReadLine()
$process.BeginErrorReadLine()

# Wait for process to exit
while (-not $process.HasExited) {
    Start-Sleep -Milliseconds 100
}

# Wait a bit for final output to be processed
Start-Sleep -Milliseconds 500

# Unregister events
Unregister-Event -SourceIdentifier $stdoutEvent.Name -ErrorAction SilentlyContinue
Unregister-Event -SourceIdentifier $stderrEvent.Name -ErrorAction SilentlyContinue

$process.WaitForExit()

if ($process.ExitCode -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Server exited with code $($process.ExitCode)" -ForegroundColor Red
    Read-Host "Press Enter to exit"
}

Write-Host ""
Write-Host "Server stopped." -ForegroundColor Gray

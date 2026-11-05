# SPDX-License-Identifier: Apache-2.0
#
# Make Infinite Brain my always-on second brain on this Windows PC, for the
# current user only (no administrator rights):
#   - at logon, start the server in WSL with no window (server-run.sh), which
#     also keeps the MCP endpoint at http://localhost:3010/api/mcp open;
#   - at logon, open the installed Infinite Brain app;
#   - every day at -BriefingTime, and shortly after logon, run briefing.sh so
#     Codex writes 브리핑/<date>.md and 브리핑/일정.md into the vault.
# Rerunning replaces what it installed. -Uninstall removes it.
param(
  [string]$Distro = "Ubuntu-24.04",
  [string]$Repo = "/home/ildong/workspaces/indi-proj/infinite-brain",
  [string]$BriefingTime = "08:30",
  [switch]$Uninstall
)
$ErrorActionPreference = "Stop"

$startup = [Environment]::GetFolderPath("Startup")
$home_ = Join-Path $env:LOCALAPPDATA "InfiniteBrainPersonal"
$serverVbs = Join-Path $startup "Infinite Brain Server.vbs"
$appLnk = Join-Path $startup "Infinite Brain.lnk"
$briefVbs = Join-Path $home_ "briefing.vbs"
$taskName = "Infinite Brain Briefing"

Remove-Item -Force -ErrorAction SilentlyContinue $serverVbs, $appLnk, $briefVbs
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
if ($Uninstall) { "removed"; return }

New-Item -ItemType Directory -Force $home_ | Out-Null

# A .vbs started by wscript runs wsl.exe with window style 0, so nothing flashes.
function Write-HiddenLauncher([string]$path, [string]$script) {
  $cmd = "wsl.exe -d $Distro --exec $Repo/scripts/personal/$script"
  "CreateObject(""WScript.Shell"").Run ""$cmd"", 0, False" | Set-Content -Encoding ASCII $path
}
Write-HiddenLauncher $serverVbs "server-run.sh"
Write-HiddenLauncher $briefVbs "briefing.sh"

$exe = @(
  (Join-Path $env:LOCALAPPDATA "Infinite Brain\Infinite Brain.exe"),
  (Join-Path $env:LOCALAPPDATA "Programs\Infinite Brain\Infinite Brain.exe"),
  (Join-Path $env:ProgramFiles "Infinite Brain\Infinite Brain.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($exe) {
  $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($appLnk)
  $lnk.TargetPath = $exe
  $lnk.WorkingDirectory = Split-Path $exe
  $lnk.Save()
} else {
  Write-Warning "Infinite Brain.exe not found; install the app, then run this again to open it at logon."
}

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$briefVbs`""
$daily = New-ScheduledTaskTrigger -Daily -At $BriefingTime
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$logon.Delay = "PT5M"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($daily, $logon) -Settings $settings -Principal $principal | Out-Null

[pscustomobject]@{
  ServerAtLogon = $serverVbs
  AppAtLogon = $(if ($exe) { $appLnk } else { "(app not installed yet)" })
  BriefingTask = "$taskName (daily $BriefingTime, and 5 min after logon)"
}

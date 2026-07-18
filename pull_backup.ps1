# Off-site backup pull: copies the newest DB backup from the VPS down to a
# OneDrive-synced folder on this PC (so it's also mirrored to the cloud).
# Run daily by a Windows Scheduled Task (see setup in the project notes).
$ErrorActionPreference = "Stop"
$Server = "root@YOUR_SERVER_IP"
$Local  = Join-Path $env:USERPROFILE "OneDrive\HeavyMachineryBackups"
New-Item -ItemType Directory -Force -Path $Local | Out-Null

# Find the newest archive on the server.
$latest = (ssh -o ConnectTimeout=15 $Server "ls -1t /opt/heavy-machinery/backups/machinery-*.db.gz | head -1").Trim()
if (-not $latest) { throw "No remote backup found on server." }

scp -o ConnectTimeout=25 "${Server}:$latest" "$Local\"

# Keep the newest 60 local copies (~2 months of dailies).
Get-ChildItem (Join-Path $Local "machinery-*.db.gz") |
  Sort-Object LastWriteTime -Descending | Select-Object -Skip 60 | Remove-Item -Force

$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"$ts pulled $(Split-Path $latest -Leaf) -> $Local" |
  Tee-Object -FilePath (Join-Path $Local "pull.log") -Append

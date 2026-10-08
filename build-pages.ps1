# 產生 GitHub Pages 靜態網站（放在 repo 根目錄：index.html、assets/、data/）
#   1. 後端匯出預先運算資料（模擬結果、合成感測資料）→ frontend/public/data
#   2. 前端以 static 模式建置 → frontend/dist-static
#   3. 複製到 repo 根目錄
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Push-Location "$root\backend"
& .\.venv\Scripts\python.exe scripts\export_static.py "$root\frontend\public\data"
& .\.venv\Scripts\python.exe scripts\export_engine.py "$root\frontend\public\data\engine"
Pop-Location
Push-Location "$root\frontend"
npm run verify:engine
if ($LASTEXITCODE -ne 0) { throw "瀏覽器模擬引擎與 Python 結果不一致" }
npm run build:static
Pop-Location
foreach ($p in "assets", "data") { if (Test-Path "$root\$p") { Remove-Item -Recurse -Force "$root\$p" } }
Copy-Item -Recurse -Force "$root\frontend\dist-static\*" $root
New-Item -ItemType File -Force "$root\.nojekyll" | Out-Null
Write-Host "Pages site ready in $root"

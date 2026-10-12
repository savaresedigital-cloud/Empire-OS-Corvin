@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Empire OS
where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=12)?0:1)"
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_node
if not exist "node_modules\vite\package.json" (
  echo Prima apertura: preparo i componenti. Potrebbero servire alcuni minuti.
  call npm.cmd ci
  if errorlevel 1 goto failed
)
echo.
echo Empire OS si apre nel browser quando il server e' pronto.
echo Se necessario, apri http://localhost:5173/
echo Lascia questa finestra aperta mentre usi l'app.
echo Per fermarla premi Ctrl+C.
echo.
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "$empireDeadline=(Get-Date).AddMinutes(2); while((Get-Date) -lt $empireDeadline) { try { $empireResponse=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:5173/' -TimeoutSec 2; if($empireResponse.StatusCode -eq 200 -and $empireResponse.Content.Contains('Empire OS')) { Start-Process 'http://localhost:5173/'; exit 0 } } catch {}; Start-Sleep -Milliseconds 700 }"
call npm.cmd run dev
if errorlevel 1 goto failed
exit /b 0
:missing_node
echo Serve Node.js 22.12 o successivo. Installa Node.js, poi riapri questo file.
echo https://nodejs.org/
pause
exit /b 1
:failed
echo.
echo Avvio interrotto. Puoi copiare il messaggio mostrato sopra per chiedere assistenza.
pause
exit /b 1

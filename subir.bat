@echo off
setlocal
REM ================================================================
REM  Claude-Chat :: subir a GitHub + desplegar en Cloudflare
REM
REM  1) Commitea los cambios pendientes (mensaje automatico con fecha).
REM  2) Hace push a origin/main
REM     -> el push dispara el build automatico de Cloudflare (Workers Builds).
REM  3) Ademas despliega directo con wrangler, para que la version local
REM     quede publicada de inmediato sin esperar el build.
REM
REM  Requisitos (solo la primera vez):
REM     npx -y wrangler login                       (loguea el deploy manual)
REM     npx -y wrangler secret put NVIDIA_API_KEY   (si falta la API key)
REM ================================================================
cd /d "%~dp0"

echo === [1/3] Git: commit de cambios pendientes ===
git add .
git diff --cached --quiet
if %errorlevel% neq 0 (
    for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH:mm"') do set STAMP=%%i
    git commit -m "update %STAMP%"
) else (
    echo   Sin cambios que commitear.
)

echo === [2/3] GitHub: push a origin/main ===
git push origin main
if %errorlevel% neq 0 (
    echo   X Error en el push a GitHub. Se aborta.
    exit /b 1
)
echo   OK: push hecho. El build automatico de Cloudflare quedo disparado.

echo === [3/3] Cloudflare: deploy directo con wrangler ===
call npx -y wrangler deploy
if %errorlevel% neq 0 (
    echo   X Fallo el deploy manual con wrangler. Recorda:
    echo       - Primera vez:  npx -y wrangler login
    echo       - API key:      npx -y wrangler secret put NVIDIA_API_KEY
    echo   Nota: el push del paso 2 ya disparo el build automatico igualmente.
    exit /b 1
)
echo   OK: deploy a Cloudflare listo.
echo Listo: https://claudechat.claudioabril1000.workers.dev/
endlocal

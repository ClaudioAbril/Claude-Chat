@echo off
REM ══════════════════════════════════════════════════════════════════
REM  Despliega el Worker (proxy NVIDIA) + el chat (index.html) a Cloudflare.
REM
REM  Requisitos (solo la primera vez):
REM    1. Tener Node instalado (npx lo incluye).
REM    2. Loguearte en Cloudflare:  npx -y wrangler login
REM       (abre el navegador y autoriza la sesión)
REM    3. Cargar la API key de NVIDIA como secret:
REM           npx -y wrangler secret put NVIDIA_API_KEY
REM       (pedirá pegar el valor nvapi-... una sola vez)
REM
REM  Uso habitual: doble clic acá (o ejecutar desplegar.bat).
REM ══════════════════════════════════════════════════════════════════
cd /d "%~dp0"
npx -y wrangler deploy

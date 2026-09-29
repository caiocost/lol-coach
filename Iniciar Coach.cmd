@echo off
REM Abre o LoL Coach: icone na bandeja (perto do relogio) + tela no navegador.
REM Para ver os logs ao vivo num console, rode "npm run coach" na pasta.
cd /d "%~dp0"

if not exist "node_modules\tsx" (
  echo.
  echo   Faltam os arquivos do pacote. Baixe o LoL-Coach-...-win-x64.zip
  echo   em https://github.com/caiocost/lol-coach/releases e extraia de novo.
  echo.
  pause
  exit /b 1
)

start "" wscript.exe "%~dp0coach\bandeja.vbs"

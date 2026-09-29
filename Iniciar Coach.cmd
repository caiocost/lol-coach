@echo off
REM Inicia o LoL Coach (pacote portatil) e abre a tela no navegador.
cd /d "%~dp0"
title LoL Coach

set "NODE=runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
if not exist "node_modules\tsx" (
  echo.
  echo   Faltam os arquivos do pacote. Baixe o LoL-Coach-...-win-x64.zip
  echo   em https://github.com/caiocost/lol-coach/releases e extraia de novo.
  echo.
  pause
  exit /b 1
)

REM abre a tela depois que os servidores sobem
start "" /b cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:7778"

"%NODE%" coach\start.mjs
echo.
echo   Coach encerrado.
pause

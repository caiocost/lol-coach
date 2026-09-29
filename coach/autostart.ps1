# Instala (ou remove) o coach para subir junto com o Windows.
#
# Este arquivo e mantido em ASCII puro de proposito: o PowerShell 5 do Windows
# le .ps1 sem BOM como ANSI, e acento virava erro de parse.
#
# Duas vias:
#
#   PASTA STARTUP (padrao) - nao precisa de administrador. Cria um atalho para
#   o .vbs na pasta de inicializacao do seu usuario. Sobe sem janela.
#
#   AGENDADOR (-Scheduler) - precisa de PowerShell como admin, e em troca
#   reinicia o processo sozinho se ele cair. Para uso normal, o padrao basta.
#
# Em ambos os casos sobe no LOGON, nao no boot: a Live Client API do jogo so
# existe com voce logado e jogando.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File coach\autostart.ps1
#   powershell -ExecutionPolicy Bypass -File coach\autostart.ps1 -Status
#   powershell -ExecutionPolicy Bypass -File coach\autostart.ps1 -Remove
#   powershell -ExecutionPolicy Bypass -File coach\autostart.ps1 -Scheduler

param(
  [switch]$Remove,
  [switch]$Status,
  [switch]$Scheduler
)

$ErrorActionPreference = "Stop"

$TaskName   = "LoLCoach"
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Runner     = Join-Path $ProjectDir "coach\autostart-run.vbs"
$StartupDir = [Environment]::GetFolderPath("Startup")
$LinkPath   = Join-Path $StartupDir "LoL Coach.lnk"
$LogPath    = Join-Path $ProjectDir "coach\autostart.log"

function Write-Info($msg) { Write-Host "  $msg" }

function Show-Ports {
  foreach ($p in 7777, 7778) {
    $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($c) { Write-Info "porta $p ATIVA" } else { Write-Info "porta $p parada" }
  }
}

# ---------------------------------------------------------------- status

if ($Status) {
  Write-Host ""
  if (Test-Path $LinkPath) {
    Write-Info "Atalho na pasta Startup : INSTALADO"
    Write-Info "  $LinkPath"
  } else {
    Write-Info "Atalho na pasta Startup : nao instalado"
  }

  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t) {
    $info = Get-ScheduledTaskInfo -InputObject $t
    Write-Info "Tarefa no Agendador     : INSTALADA ($($t.State))"
    Write-Info "  ultima execucao: $($info.LastRunTime)  resultado: $($info.LastTaskResult) (0 = ok)"
  } else {
    Write-Info "Tarefa no Agendador     : nao instalada"
  }
  Write-Host ""
  Show-Ports
  Write-Host ""
  if (Test-Path $LogPath) {
    Write-Info "Ultimas linhas do log:"
    Get-Content $LogPath -Tail 6 | ForEach-Object { Write-Host "    $_" }
    Write-Host ""
  }
  exit 0
}

# ---------------------------------------------------------------- remover

if ($Remove) {
  Write-Host ""
  $achou = $false

  if (Test-Path $LinkPath) {
    Remove-Item $LinkPath -Force
    Write-Info "Atalho removido da pasta Startup."
    $achou = $true
  }

  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t) {
    try {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
      Write-Info "Tarefa removida do Agendador."
      $achou = $true
    } catch {
      Write-Info "Nao consegui remover a tarefa do Agendador (precisa de admin)."
    }
  }

  if (-not $achou) { Write-Info "Autostart nao estava instalado." }
  Write-Info "Os servidores em execucao continuam ate voce fecha-los."
  Write-Host ""
  exit 0
}

# ---------------------------------------------------------------- instalar

if (-not (Test-Path $Runner)) {
  throw "autostart-run.vbs nao encontrado em $Runner"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node nao encontrado no PATH. Instale o Node.js antes de configurar o autostart."
}

Write-Host ""

if ($Scheduler) {
  # Via Agendador: reinicia sozinho se cair, mas exige elevacao.
  $action = New-ScheduledTaskAction -Execute "wscript.exe" `
    -Argument ('"' + $Runner + '"') -WorkingDirectory $ProjectDir
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

  try {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
      -Settings $settings -Principal $principal -Force `
      -Description "Sobe o Draft Coach (7777) e o In-Game Coach (7778) no logon." | Out-Null
    Write-Info "Tarefa instalada no Agendador (reinicia sozinha se cair)."
  } catch {
    Write-Info "FALHOU: o Agendador exige PowerShell como administrador."
    Write-Info "Abra o PowerShell como admin e rode de novo, ou use o padrao:"
    Write-Info "  powershell -ExecutionPolicy Bypass -File coach\autostart.ps1"
    Write-Host ""
    exit 1
  }
} else {
  # Via pasta Startup: sem admin. Atalho para o .vbs, que sobe sem janela.
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($LinkPath)
  $lnk.TargetPath = "wscript.exe"
  $lnk.Arguments = '"' + $Runner + '"'
  $lnk.WorkingDirectory = $ProjectDir
  $lnk.Description = "Sobe o Draft Coach (7777) e o In-Game Coach (7778)"
  $lnk.Save()
  Write-Info "Atalho criado na pasta Startup (nao precisou de admin)."
}

Write-Host ""
Write-Info "  Draft Coach     http://localhost:7777"
Write-Info "  In-Game Coach   http://localhost:7778   <- deixe esta aberta"
Write-Host ""
Write-Info "Log     : $LogPath"
Write-Info "Status  : powershell -ExecutionPolicy Bypass -File coach\autostart.ps1 -Status"
Write-Info "Remover : powershell -ExecutionPolicy Bypass -File coach\autostart.ps1 -Remove"
Write-Host ""

# Sobe agora tambem, pra nao precisar reiniciar so para testar.
$jaAtivo = Get-NetTCPConnection -LocalPort 7778 -State Listen -ErrorAction SilentlyContinue
if ($jaAtivo) {
  Write-Info "Ja havia instancia rodando na 7778 - nao subi outra."
} else {
  Start-Process "wscript.exe" -ArgumentList ('"' + $Runner + '"') -WorkingDirectory $ProjectDir
  Write-Info "Iniciado agora. Aguarde alguns segundos e abra localhost:7778"
}
Write-Host ""

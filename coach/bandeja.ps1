# Ícone do LoL Coach na bandeja do Windows (perto do relógio).
#
# É o jeito normal de abrir o coach: sobe o start.mjs sem janela de console,
# abre a tela no navegador e fica na bandeja com o menu de configurações.
# Sair pelo menu encerra tudo (servidores, luzes e o OpenRGB embarcado).
#
# PowerShell + Windows Forms, e não um .exe: o Windows já traz os dois, e um
# .exe não assinado traria de volta o aviso do SmartScreen.
#
# Salvo em UTF-8 COM BOM: o PowerShell 5 lê .ps1 sem BOM como ANSI, e o menu
# tem acentos. Chamado por bandeja.vbs (que esconde a janela do PowerShell).
#
# O mesmo arquivo serve ao repo público (coach/) e ao particular
# (scripts/draft-coach/): a raiz é achada subindo até o package.json, e o
# start.mjs e a pasta sounds/ ficam ao lado deste script nos dois.
#
# Carregado com ". bandeja.ps1" (dot-source) só define as funções, sem subir
# nada: é assim que scripts/print-bandeja.ps1 desenha o menu para o README.

param([switch]$SemAbrir)   # no logon do Windows: sobe calado, sem abrir o navegador

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

# --- onde estão as coisas --------------------------------------------------
$Aqui = $PSScriptRoot
$Raiz = $Aqui
while ($Raiz -and -not (Test-Path (Join-Path $Raiz "package.json"))) { $Raiz = Split-Path $Raiz -Parent }

function LerEnv($nome, $padrao) {
  $arq = if ($Raiz) { Join-Path $Raiz ".env" } else { $null }
  if ($arq -and (Test-Path $arq)) {
    foreach ($l in Get-Content $arq) {
      if ($l -match "^\s*$nome\s*=\s*(.+?)\s*$") { return $Matches[1].Trim('"') }
    }
  }
  return $padrao
}
$PortaTela  = LerEnv "INGAME_PORT" "7778"
$PortaDraft = LerEnv "DRAFT_PORT" "7777"
$PortaLuz   = LerEnv "RGB_PORT" "7779"
$Url = "http://localhost:$PortaTela"
$Log = Join-Path $Aqui "coach.log"
$Icone = Join-Path $Aqui "assets\icone.ico"
$Ajuda = "https://github.com/caiocost/lol-coach#luzes-rgb"
$Atalho = Join-Path ([Environment]::GetFolderPath("Startup")) "LoL Coach.lnk"
$Vbs = Join-Path $Aqui "bandeja.vbs"
$script:proc = $null

# --- o coach ---------------------------------------------------------------
function Abrir { Start-Process $Url }

function Api($caminho, $metodo = "GET") {
  try { return Invoke-RestMethod -Uri "$Url$caminho" -Method $metodo -TimeoutSec 2 } catch { return $null }
}

function Respondendo { return $null -ne (Api "/state") }

function Subir {
  if (Respondendo) { return }   # já tem um coach no ar (aberto por fora): usa ele
  $node = Join-Path $Raiz "runtime\node.exe"
  if (-not (Test-Path $node)) { $node = "node" }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.Arguments = "/c `"`"$node`" `"$Aqui\start.mjs`" >> `"$Log`" 2>&1`""
  $psi.WorkingDirectory = $Raiz
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $script:proc = [System.Diagnostics.Process]::Start($psi)
}

# taskkill pelo cmd: quando um processo da árvore já morreu, o taskkill escreve
# erro no stderr, e com ErrorActionPreference=Stop o PowerShell transformaria
# isso em exceção e interromperia o Derrubar no meio (o "Sair" não fecharia).
function Matar($id) { cmd.exe /c "taskkill /T /F /PID $id >nul 2>&1" }

function Derrubar {
  if ($script:proc -and -not $script:proc.HasExited) { Matar $script:proc.Id }
  # Coach que não foi aberto por esta bandeja (ou filho que escapou da árvore):
  # quem estiver ouvindo nas portas do coach sai também.
  foreach ($p in @($PortaTela, $PortaDraft, $PortaLuz)) {
    Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { Matar $_.OwningProcess }
  }
  $script:proc = $null
}

# --- OpenRGB como administrador (para RAM e placas SMBus) -------------------
# RAM e parte das placas só aparecem com o driver PawnIO e o OpenRGB elevado.
# O embarcado sobe sem admin (o start.mjs não pede UAC no boot), então aqui ele
# é trocado por uma cópia elevada na mesma porta. O start.mjs vê a 6742 ocupada
# e usa essa cópia daí em diante.
function OpenRgbAdmin {
  $exe = Join-Path $Raiz "runtime\openrgb\OpenRGB.exe"
  if (-not (Test-Path $exe)) { Start-Process $Ajuda; return }
  Get-Process OpenRGB -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800
  try {
    Start-Process -FilePath $exe -Verb RunAs -WindowStyle Hidden `
      -ArgumentList "--server", "--server-port", "6742", "--localconfig", "--noautoconnect"
  } catch { }   # recusou o UAC: o embarcado volta no próximo "Reiniciar o coach"
}

# --- iniciar com o Windows -------------------------------------------------
function AutoInicio {
  if (-not (Test-Path $Atalho)) { return $false }
  $sh = New-Object -ComObject WScript.Shell
  return ($sh.CreateShortcut($Atalho).Arguments -like "*$Vbs*")
}

function TrocarAutoInicio {
  if (AutoInicio) { Remove-Item $Atalho -Force; return }
  $sh = New-Object -ComObject WScript.Shell
  $l = $sh.CreateShortcut($Atalho)
  $l.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $l.Arguments = "`"$Vbs`" /semabrir"
  $l.WorkingDirectory = $Raiz
  if (Test-Path $Icone) { $l.IconLocation = "$Icone,0" }
  $l.Save()
}

# --- menu ------------------------------------------------------------------
function Item($texto, $acao) {
  $i = New-Object System.Windows.Forms.ToolStripMenuItem($texto)
  if ($acao) { $i.add_Click($acao) }
  return $i
}

function NovoMenu($aoSair) {
  $m = @{}
  $m.Abrir = Item "Abrir o LoL Coach" { Abrir }
  $m.Abrir.Font = New-Object System.Drawing.Font($m.Abrir.Font, [System.Drawing.FontStyle]::Bold)
  $m.Som = Item "Som" { Api "/voice/toggle" "POST" | Out-Null }
  $m.Luzes = Item "Luzes" $null
  $m.Auto = Item "Iniciar com o Windows" { TrocarAutoInicio }
  $m.Vozes = Item "Abrir a pasta das vozes" { Start-Process explorer.exe (Join-Path $Aqui "sounds") }
  $m.Log = Item "Ver o log" { if (Test-Path $Log) { Start-Process notepad.exe $Log } }
  $m.Reiniciar = Item "Reiniciar o coach" { Derrubar; Start-Sleep 1; Subir }
  $m.Sair = Item "Sair" $aoSair
  $m.Strip = New-Object System.Windows.Forms.ContextMenuStrip
  $m.Strip.Items.AddRange(@(
    $m.Abrir,
    (New-Object System.Windows.Forms.ToolStripSeparator),
    $m.Som, $m.Luzes, $m.Auto,
    (New-Object System.Windows.Forms.ToolStripSeparator),
    $m.Vozes, $m.Log, $m.Reiniciar,
    (New-Object System.Windows.Forms.ToolStripSeparator),
    $m.Sair
  ))
  return $m
}

# Preenche o menu com o estado do coach ($st = /state, $rgb = /rgb/status).
function PreencherMenu($m, $st, $rgb, [bool]$auto) {
  $m.Som.Enabled = $null -ne $st
  $m.Som.Checked = [bool]($st -and $st.voice -and $st.voice.habilitado)
  $m.Som.Text = if (-not $st) { "Som (coach iniciando...)" } elseif ($m.Som.Checked) { "Som ligado" } else { "Som desligado" }
  $m.Auto.Checked = $auto

  $m.Luzes.DropDownItems.Clear()
  if (-not $rgb -or $rgb.daemon -eq $false) {
    $m.Luzes.Text = "Luzes: desligadas"
    $info = Item "O daemon de luzes não está rodando" $null; $info.Enabled = $false
    [void]$m.Luzes.DropDownItems.Add($info)
  } elseif (-not $rgb.openrgb) {
    $m.Luzes.Text = "Luzes: procurando o OpenRGB..."
    $info = Item "A detecção leva alguns segundos" $null; $info.Enabled = $false
    [void]$m.Luzes.DropDownItems.Add($info)
  } else {
    $d = $rgb.dispositivos
    $m.Luzes.Text = "Luzes: conectadas"
    foreach ($par in @(@("Teclado", $d.teclado), @("RAM", $d.ram), @("Placa-mãe", $d.placa))) {
      $txt = if ($par[1]) { "$($par[0]): $($par[1])" } else { "$($par[0]): não detectada" }
      $i = Item $txt $null; $i.Enabled = $false; $i.Checked = [bool]$par[1]
      [void]$m.Luzes.DropDownItems.Add($i)
    }
  }
  [void]$m.Luzes.DropDownItems.Add((New-Object System.Windows.Forms.ToolStripSeparator))
  if ($rgb -and $rgb.openrgb -and (-not $rgb.dispositivos.ram -or -not $rgb.dispositivos.placa)) {
    [void]$m.Luzes.DropDownItems.Add((Item "1. Instalar o driver PawnIO (RAM/placa)" { Start-Process "https://pawnio.eu" }))
    [void]$m.Luzes.DropDownItems.Add((Item "2. Abrir o OpenRGB como administrador" { OpenRgbAdmin }))
  }
  [void]$m.Luzes.DropDownItems.Add((Item "Dispositivos compatíveis..." { Start-Process $Ajuda }))
}

# Dot-source: só as funções acima.
if ($MyInvocation.InvocationName -eq ".") { return }

# ===========================================================================
if (-not $Raiz) { [System.Windows.Forms.MessageBox]::Show("package.json não encontrado acima de $Aqui", "LoL Coach"); exit 1 }

# --- uma instância só ------------------------------------------------------
$criado = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\LoLCoachBandeja", [ref]$criado)
if (-not $criado) {
  # Já tem uma bandeja rodando: só mostra a tela.
  if (-not $SemAbrir) { Abrir }
  exit 0
}

# --- ícone -----------------------------------------------------------------
$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = if (Test-Path $Icone) { New-Object System.Drawing.Icon($Icone) } else { [System.Drawing.SystemIcons]::Application }
$icon.Text = "LoL Coach"
$icon.Visible = $true

$menu = NovoMenu {
  $icon.Visible = $false
  Derrubar
  [System.Windows.Forms.Application]::Exit()
}
# O menu é preenchido na hora de abrir, com o estado atual do coach.
$menu.Strip.add_Opening({ PreencherMenu $menu (Api "/state") (Api "/rgb/status") (AutoInicio) })
$icon.ContextMenuStrip = $menu.Strip
$icon.add_MouseDoubleClick({ Abrir })
$icon.add_BalloonTipClicked({ Abrir })

# --- vigia: avisa se o coach cair -------------------------------------------
$script:avisouQueda = $false
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({
  $caiu = $script:proc -and $script:proc.HasExited
  if ($caiu -and -not $script:avisouQueda) {
    $script:avisouQueda = $true
    $icon.Text = "LoL Coach (parado)"
    $icon.ShowBalloonTip(5000, "LoL Coach parou", "Use 'Reiniciar o coach' no menu. Detalhes em 'Ver o log'.", "Warning")
  } elseif (-not $caiu -and $script:avisouQueda) {
    $script:avisouQueda = $false
    $icon.Text = "LoL Coach"
  }
})
$timer.Start()

# --- sobe ------------------------------------------------------------------
Subir
if (-not $SemAbrir) {
  # Espera a tela responder antes de abrir o navegador (até 30 s).
  $ate = (Get-Date).AddSeconds(30)
  while (-not (Respondendo) -and (Get-Date) -lt $ate) { Start-Sleep -Milliseconds 500 }
  Abrir
}
$icon.ShowBalloonTip(3000, "LoL Coach rodando", "O menu fica aqui na bandeja: som, luzes e iniciar com o Windows.", "Info")

[System.Windows.Forms.Application]::Run()
$icon.Dispose()
$mutex.ReleaseMutex()

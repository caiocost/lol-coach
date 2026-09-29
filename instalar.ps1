# Instala ou atualiza o LoL Coach sem o aviso "O Windows protegeu o computador".
#
# Uso (PowerShell):
#   irm https://raw.githubusercontent.com/caiocost/lol-coach/main/instalar.ps1 | iex
#
# Por que evita o aviso: o SmartScreen so reclama de arquivo com a "marca da
# internet" (Zone.Identifier), que o NAVEGADOR poe em todo download e que passa
# para tudo que sai do zip. Baixado pelo proprio PowerShell, o zip nao ganha a
# marca, entao o Iniciar Coach.cmd abre direto.
#
# Rodar de novo atualiza para a versao mais nova, mantendo o que e seu:
# vozes gravadas (coach\sounds), alertas criados (data\) e o .env.
#
# Mantido em ASCII puro: o PowerShell 5 le .ps1 sem BOM como ANSI.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # a barra deixa o download 10x mais lento
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo    = "caiocost/lol-coach"
$Destino = Join-Path $env:LOCALAPPDATA "LoL-Coach"
$Tmp     = Join-Path $env:TEMP "lol-coach-instalar"

function Passo($t) { Write-Host "  $t" }

Write-Host ""
Write-Host "  LoL Coach - instalador" -ForegroundColor Cyan
Write-Host ""

# 1. Versao mais nova publicada.
Passo "procurando a versao mais nova..."
$rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "lol-coach-instalar" }
$asset = $rel.assets | Where-Object { $_.name -like "*win-x64.zip" } | Select-Object -First 1
if (-not $asset) { throw "A release $($rel.tag_name) nao tem o zip para Windows." }
Passo "versao $($rel.tag_name)"

# 2. Coach aberto trava os arquivos: fecha o que estiver rodando desta pasta.
# A bandeja (powershell/wscript) e o OpenRGB embarcado tambem seguram a pasta.
$rodando = Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -in "node.exe", "python.exe", "cmd.exe", "powershell.exe", "wscript.exe", "OpenRGB.exe") -and
  $_.CommandLine -and $_.CommandLine.Contains($Destino)
}
if ($rodando) {
  Passo "fechando o coach que estava aberto..."
  $rodando | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

# 3. Baixa e extrai numa pasta temporaria.
if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp }
New-Item -ItemType Directory -Force $Tmp | Out-Null
$zip = Join-Path $Tmp $asset.name
Passo "baixando $([math]::Round($asset.size / 1MB)) MB..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
Passo "extraindo..."
Expand-Archive $zip -DestinationPath $Tmp
$novo = Join-Path $Tmp "LoL-Coach"
if (-not (Test-Path $novo)) { throw "O zip nao tem a pasta LoL-Coach esperada." }

# 4. Atualizacao: leva junto o que e do usuario antes de trocar a pasta.
if (Test-Path $Destino) {
  Passo "mantendo suas vozes, alertas e configuracao..."
  $sons = Join-Path $Destino "coach\sounds"
  if (Test-Path $sons) {
    # As gravacoes do usuario ganham das que vem de exemplo no zip.
    Copy-Item (Join-Path $sons "*") (Join-Path $novo "coach\sounds") -Recurse -Force
  }
  foreach ($item in "data", ".env") {
    $de = Join-Path $Destino $item
    if (Test-Path $de) { Copy-Item $de (Join-Path $novo $item) -Recurse -Force }
  }
  Remove-Item -Recurse -Force $Destino
}
Move-Item $novo $Destino
Remove-Item -Recurse -Force $Tmp

# 5. Atalho no Menu Iniciar (e na Area de Trabalho).
# O atalho abre a bandeja (coach\bandeja.vbs), que sobe o coach sem console.
$sh = New-Object -ComObject WScript.Shell
$vbs = Join-Path $Destino "coach\bandeja.vbs"
$wscript = Join-Path $env:WINDIR "System32\wscript.exe"
foreach ($pasta in @(
    (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs"),
    [Environment]::GetFolderPath("Desktop"))) {
  $lnk = $sh.CreateShortcut((Join-Path $pasta "LoL Coach.lnk"))
  $lnk.TargetPath = $wscript
  $lnk.Arguments = "`"$vbs`""
  $lnk.WorkingDirectory = $Destino
  $lnk.IconLocation = (Join-Path $Destino "coach\assets\icone.ico") + ",0"
  $lnk.Save()
}

Write-Host ""
Write-Host "  Pronto: LoL Coach $($rel.tag_name) instalado em $Destino" -ForegroundColor Green
Write-Host "  Abra pelo atalho 'LoL Coach' no Menu Iniciar ou na Area de Trabalho."
Write-Host "  O coach fica na bandeja (perto do relogio): som, luzes e iniciar com o Windows."
Write-Host "  Para atualizar no futuro, rode o mesmo comando de novo."
Write-Host ""

Start-Process -FilePath $wscript -ArgumentList "`"$vbs`""

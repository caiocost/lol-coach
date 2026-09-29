# Monta o pacote portatil para Windows x64: Node e Python embutidos, sem
# instalar nada no PC de quem baixa.
#
# Mantido em ASCII puro: o PowerShell 5 le .ps1 sem BOM como ANSI.
#
# Uso (na raiz do repo, com git, npm e python no PATH):
#   powershell -ExecutionPolicy Bypass -File scripts\empacotar.ps1 -Versao 1.1.0
#
# Saida: dist\LoL-Coach-v<versao>-win-x64.zip

param(
  [Parameter(Mandatory = $true)][string]$Versao,
  [string]$NodeVersion = "24.14.1",
  [string]$PyVersion = "3.12.10",
  # OpenRGB portatil (GPL-2.0). Trocar a versao = trocar as duas linhas.
  [string]$OpenRgbTag = "release_1.0",
  [string]$OpenRgbZip = "OpenRGB_1.0_Windows_64_81bbe18.zip"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest fica 10x mais lento com a barra

$Raiz  = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Dist  = Join-Path $Raiz "dist"
$Cache = Join-Path $Dist "_cache"
$Pasta = Join-Path $Dist "LoL-Coach"
$Zip   = Join-Path $Dist "LoL-Coach-v$Versao-win-x64.zip"

function Baixar($url, $destino) {
  if (-not (Test-Path $destino)) {
    Write-Host "  baixando $url"
    Invoke-WebRequest -Uri $url -OutFile $destino
  }
}

New-Item -ItemType Directory -Force $Cache | Out-Null
if (Test-Path $Pasta) { Remove-Item -Recurse -Force $Pasta }
if (Test-Path $Zip) { Remove-Item -Force $Zip }

# 1. So o que esta commitado: nada de .env, data/ ou gravacoes locais.
Write-Host "  arquivos do repo (git archive HEAD)"
$src = Join-Path $Cache "src.zip"
git -C $Raiz archive --format=zip -o $src HEAD
Expand-Archive $src -DestinationPath $Pasta
Remove-Item -Recurse -Force (Join-Path $Pasta "tests"), (Join-Path $Pasta "rgb\tests"), (Join-Path $Pasta "scripts")

# 2. Dependencias de producao.
Write-Host "  npm ci --omit=dev"
Push-Location $Pasta
npm ci --omit=dev --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { throw "npm ci falhou" }
Pop-Location

# 3. Node embutido: so o node.exe.
$runtime = Join-Path $Pasta "runtime"
New-Item -ItemType Directory -Force $runtime | Out-Null
$nodeZip = Join-Path $Cache "node-v$NodeVersion-win-x64.zip"
Baixar "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" $nodeZip
$nodeTmp = Join-Path $Cache "node"
if (-not (Test-Path $nodeTmp)) { Expand-Archive $nodeZip -DestinationPath $nodeTmp }
Copy-Item (Join-Path $nodeTmp "node-v$NodeVersion-win-x64\node.exe") $runtime
Copy-Item (Join-Path $nodeTmp "node-v$NodeVersion-win-x64\LICENSE") (Join-Path $runtime "NODE-LICENSE.txt")

# 4. Python embutido + openrgb-python, para as luzes.
$py = Join-Path $runtime "python"
$pyZip = Join-Path $Cache "python-$PyVersion-embed-amd64.zip"
Baixar "https://www.python.org/ftp/python/$PyVersion/python-$PyVersion-embed-amd64.zip" $pyZip
Expand-Archive $pyZip -DestinationPath $py
$site = Join-Path $py "Lib\site-packages"
New-Item -ItemType Directory -Force $site | Out-Null
Write-Host "  pip install openrgb-python"
python -m pip install --quiet --disable-pip-version-check --no-compile --target $site -r (Join-Path $Pasta "rgb\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "pip falhou" }
# O Python embutido ignora PYTHONPATH e site-packages: o caminho vai no ._pth.
$pth = Get-ChildItem $py -Filter "python*._pth" | Select-Object -First 1
Add-Content -Path $pth.FullName -Value "Lib\site-packages" -Encoding ASCII

# 5. OpenRGB portatil, para as luzes funcionarem sem instalar nada.
# O start.mjs sobe ele sem janela (--server) quando nao ha outro OpenRGB aberto.
$orgbZip = Join-Path $Cache $OpenRgbZip
Baixar "https://codeberg.org/OpenRGB/OpenRGB/releases/download/$OpenRgbTag/$OpenRgbZip" $orgbZip
$orgbTmp = Join-Path $Cache "openrgb-$OpenRgbTag"
if (-not (Test-Path $orgbTmp)) { Expand-Archive $orgbZip -DestinationPath $orgbTmp }
$orgbExe = Get-ChildItem $orgbTmp -Recurse -Filter "OpenRGB.exe" | Select-Object -First 1
if (-not $orgbExe) { throw "OpenRGB.exe nao encontrado em $OpenRgbZip" }
$orgb = Join-Path $runtime "openrgb"
Copy-Item $orgbExe.Directory.FullName $orgb -Recurse
# GPL-2.0: vai junto a licenca e onde achar o codigo-fonte desta versao.
Baixar "https://codeberg.org/OpenRGB/OpenRGB/raw/tag/$OpenRgbTag/LICENSE" (Join-Path $Cache "OPENRGB-LICENSE-$OpenRgbTag.txt")
Copy-Item (Join-Path $Cache "OPENRGB-LICENSE-$OpenRgbTag.txt") (Join-Path $orgb "LICENSE.txt")
Set-Content -Path (Join-Path $orgb "LEIA-ME.txt") -Encoding ASCII -Value @(
  "OpenRGB - https://openrgb.org - licenciado sob a GNU GPL versao 2 (LICENSE.txt).",
  "Binario oficial sem modificacoes: $OpenRgbZip",
  "Codigo-fonte desta versao: https://codeberg.org/OpenRGB/OpenRGB/src/tag/$OpenRgbTag",
  "",
  "O LoL Coach abre este OpenRGB sozinho, sem janela, quando nenhum outro esta aberto.",
  "RAM e algumas placas-mae precisam do driver PawnIO (https://pawnio.eu) e do OpenRGB",
  "rodando como administrador. O teclado funciona sem isso."
)

# 6. Zip final.
Write-Host "  compactando"
Compress-Archive -Path $Pasta -DestinationPath $Zip -CompressionLevel Optimal
$mb = [math]::Round((Get-Item $Zip).Length / 1MB, 1)
Write-Host ""
Write-Host "  pronto: $Zip ($mb MB)"

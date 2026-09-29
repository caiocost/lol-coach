# Desenha o menu da bandeja num PNG, para o README, sem abrir nada na tela.
# Usa as funcoes do proprio bandeja.ps1 (dot-source), com um estado de exemplo.
#
# Uso: powershell -ExecutionPolicy Bypass -File scripts\print-bandeja.ps1
#
# Mantido em ASCII puro: o PowerShell 5 le .ps1 sem BOM como ANSI.

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\coach\bandeja.ps1")
[System.Windows.Forms.Application]::EnableVisualStyles()

$m = NovoMenu $null
$st = [pscustomobject]@{ voice = [pscustomobject]@{ habilitado = $true } }
$rgb = [pscustomobject]@{ openrgb = $true; dispositivos = [pscustomobject]@{
  teclado = "HyperX Alloy Origins"; ram = $null; placa = "ASUS TUF GAMING X670E-PLUS" } }
PreencherMenu $m $st $rgb $true

function Desenhar($dd) {
  $dd.PerformLayout()
  $tam = $dd.GetPreferredSize([System.Drawing.Size]::Empty)
  $dd.Size = $tam
  $bmp = New-Object System.Drawing.Bitmap $tam.Width, $tam.Height
  $dd.DrawToBitmap($bmp, (New-Object System.Drawing.Rectangle 0, 0, $tam.Width, $tam.Height))
  return $bmp
}

$a = Desenhar $m.Strip
$b = Desenhar $m.Luzes.DropDown
# O submenu ao lado do item "Luzes", como aparece com o mouse em cima.
$yLuzes = $m.Luzes.Bounds.Y
$w = $a.Width + $b.Width - 4; $h = [Math]::Max($a.Height, $yLuzes + $b.Height) + 16
$out = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($out)
$g.Clear([System.Drawing.Color]::FromArgb(16, 20, 26))
$g.DrawImage($a, 0, 0)
$g.DrawImage($b, $a.Width - 4, $yLuzes)
$dest = Join-Path $PSScriptRoot "..\docs\bandeja.png"
$out.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
"salvo $dest"

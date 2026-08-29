param(
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [string]$Cargo = 'cargo',
  [int]$Columns = 120,
  [int]$Rows = 40,
  [string]$Screen = 'store',
  [string]$Reference
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$json = & $Cargo run --quiet --manifest-path src-tauri/Cargo.toml --example render-tui -- $Columns $Rows $Screen
if ($LASTEXITCODE -ne 0) { throw 'Native rendering failed.' }
$data = $json | ConvertFrom-Json
$json | Set-Content -LiteralPath (Join-Path $OutputDirectory "$Screen-$Columns-cells.json") -Encoding utf8

function Resolve-CellColor([string]$Name, [bool]$Background) {
  switch ($Name) {
    'Yellow' { return [Drawing.Color]::FromArgb(255,191,0) }
    'Cyan' { return [Drawing.Color]::FromArgb(0,205,205) }
    'Black' { return [Drawing.Color]::Black }
    'Green' { return [Drawing.Color]::LimeGreen }
    'Magenta' { return [Drawing.Color]::Orchid }
    default {
      if ($Name -match '^Rgb\((\d+), (\d+), (\d+)\)$') { return [Drawing.Color]::FromArgb([int]$Matches[1],[int]$Matches[2],[int]$Matches[3]) }
      if ($Background) { return [Drawing.Color]::Black }
      return [Drawing.Color]::FromArgb(255,191,0)
    }
  }
}

$cellWidth = 12; $cellHeight = 24
$bitmap = [Drawing.Bitmap]::new(($Columns*$cellWidth),($Rows*$cellHeight))
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$font = [Drawing.Font]::new('Consolas',20,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel)
$format = [Drawing.StringFormat]::GenericTypographic.Clone()
$format.FormatFlags = [Drawing.StringFormatFlags]::MeasureTrailingSpaces -bor [Drawing.StringFormatFlags]::NoClip
$graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
for ($index=0; $index -lt $data.cells.Count; $index++) {
  $cell=$data.cells[$index]
  $foreground=Resolve-CellColor $cell.fg $false
  $background=Resolve-CellColor $cell.bg $true
  if ($cell.reversed) { $swap=$foreground; $foreground=$background; $background=$swap }
  $x=($index % $Columns)*$cellWidth; $y=[Math]::Floor($index/$Columns)*$cellHeight
  $brush=[Drawing.SolidBrush]::new($background)
  $graphics.FillRectangle($brush,[int]$x,[int]$y,$cellWidth,$cellHeight); $brush.Dispose()
  $brush=[Drawing.SolidBrush]::new($foreground)
  # Box glyphs join cell edges in a terminal. GDI's font bearings do not, so
  # rasterize these buffer glyphs to the exact same cell boundaries for QA.
  $glyph = [string]$cell.text
  if ('─│┌┐└┘'.Contains($glyph) -and $glyph.Length -eq 1) {
    $pen = [Drawing.Pen]::new($foreground,1)
    $cx = $x + $cellWidth / 2; $cy = $y + $cellHeight / 2
    if ('─┐┘'.Contains($glyph)) { $graphics.DrawLine($pen,[single]$x,[single]$cy,[single]$cx,[single]$cy) }
    if ('─┌└'.Contains($glyph)) { $graphics.DrawLine($pen,[single]$cx,[single]$cy,[single]($x+$cellWidth),[single]$cy) }
    if ('│└┘'.Contains($glyph)) { $graphics.DrawLine($pen,[single]$cx,[single]$y,[single]$cx,[single]$cy) }
    if ('│┌┐'.Contains($glyph)) { $graphics.DrawLine($pen,[single]$cx,[single]$cy,[single]$cx,[single]($y+$cellHeight)) }
    $pen.Dispose()
  } else { $graphics.DrawString($glyph,$font,$brush,[single]$x,[single]$y,$format) }
  $brush.Dispose()
}
$output=Join-Path $OutputDirectory "$Screen-$Columns.png"
$bitmap.Save($output,[Drawing.Imaging.ImageFormat]::Png)
if ($Reference) {
  $source=[Drawing.Image]::FromFile($Reference)
  $sourceWidth = [int]($source.Width * $bitmap.Height / $source.Height)
  $comparison=[Drawing.Bitmap]::new(($sourceWidth+$bitmap.Width),$bitmap.Height)
  $cg=[Drawing.Graphics]::FromImage($comparison)
  $cg.DrawImage($source,0,0,$sourceWidth,$bitmap.Height)
  $cg.DrawImage($bitmap,$sourceWidth,0,$bitmap.Width,$bitmap.Height)
  $comparison.Save((Join-Path $OutputDirectory 'source-and-native.png'),[Drawing.Imaging.ImageFormat]::Png)
  $cg.Dispose(); $comparison.Dispose(); $source.Dispose()
}
$graphics.Dispose(); $font.Dispose(); $format.Dispose(); $bitmap.Dispose()
Write-Output $output

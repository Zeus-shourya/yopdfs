# Generates assets/img/icon-192.png, icon-512.png and og.png with System.Drawing.
#   powershell -ExecutionPolicy Bypass -File tools\make-images.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\assets\img'

function New-RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure(); return $p
}

function Draw-Logo($g, [single]$x, [single]$y, [single]$s) {
  # $s = size of the 40x40 logo box in pixels
  $k = $s / 40
  $rect = New-Object System.Drawing.RectangleF($x, $y, $s, $s)
  $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(91, 22, 160), [System.Drawing.Color]::FromArgb(255, 46, 151), 45)
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend(3)
  $blend.Colors = @([System.Drawing.Color]::FromArgb(91, 22, 160), [System.Drawing.Color]::FromArgb(164, 19, 145), [System.Drawing.Color]::FromArgb(255, 46, 151))
  $blend.Positions = @(0.0, 0.55, 1.0); $br.InterpolationColors = $blend
  $g.FillPath($br, (New-RoundRect $x $y $s $s (12 * $k)))
  # page
  $page = New-Object System.Drawing.Drawing2D.GraphicsPath
  $pts = @(
    (New-Object System.Drawing.PointF(($x + 11 * $k), ($y + 9.5 * $k))),
    (New-Object System.Drawing.PointF(($x + 23 * $k), ($y + 9.5 * $k))),
    (New-Object System.Drawing.PointF(($x + 29 * $k), ($y + 15.5 * $k))),
    (New-Object System.Drawing.PointF(($x + 29 * $k), ($y + 32.5 * $k))),
    (New-Object System.Drawing.PointF(($x + 11 * $k), ($y + 32.5 * $k)))
  )
  $page.AddPolygon($pts)
  $g.FillPath([System.Drawing.Brushes]::White, $page)
  $fold = @((New-Object System.Drawing.PointF(($x + 23 * $k), ($y + 9.5 * $k))), (New-Object System.Drawing.PointF(($x + 23 * $k), ($y + 15.5 * $k))), (New-Object System.Drawing.PointF(($x + 29 * $k), ($y + 15.5 * $k))))
  $g.FillPolygon((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(233, 213, 255))), $fold)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(84, 19, 136), (2.5 * $k))
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
  $g.DrawLines($pen, @((New-Object System.Drawing.PointF(($x + 15.6 * $k), ($y + 17.2 * $k))), (New-Object System.Drawing.PointF(($x + 20 * $k), ($y + 22.2 * $k))), (New-Object System.Drawing.PointF(($x + 24.4 * $k), ($y + 17.2 * $k)))))
  $g.DrawLine($pen, ($x + 20 * $k), ($y + 22.2 * $k), ($x + 20 * $k), ($y + 27.5 * $k))
}

function Save-Icon([int]$size, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
  Draw-Logo $g 0 0 $size
  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Save-Icon 192 'icon-192.png'
Save-Icon 512 'icon-512.png'

# Open Graph image 1200x630
$W = 1200; $H = 630
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::FromArgb(252, 250, 246))
function Glow($cx, $cy, $r, $col) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath; $p.AddEllipse(($cx - $r), ($cy - $r), (2 * $r), (2 * $r))
  $b = New-Object System.Drawing.Drawing2D.PathGradientBrush($p)
  $b.CenterColor = $col; $b.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $col.R, $col.G, $col.B))
  $g.FillPath($b, $p)
}
Glow 120 80 420 ([System.Drawing.Color]::FromArgb(150, 201, 166, 255))
Glow 1100 120 380 ([System.Drawing.Color]::FromArgb(150, 255, 156, 203))
Glow 700 700 420 ([System.Drawing.Color]::FromArgb(140, 169, 184, 255))
Draw-Logo $g 90 92 96
$navy = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(31, 26, 61))
$f1 = New-Object System.Drawing.Font('Segoe UI', 40, [System.Drawing.FontStyle]::Bold)
$g.DrawString('YoPdfs', $f1, $navy, 200, 106)
$f2 = New-Object System.Drawing.Font('Segoe UI', 58, [System.Drawing.FontStyle]::Bold)
$g.DrawString('Every PDF & image tool.', $f2, $navy, 82, 236)
$gradRect = New-Object System.Drawing.RectangleF(82, 330, 900, 90)
$gb = New-Object System.Drawing.Drawing2D.LinearGradientBrush($gradRect, [System.Drawing.Color]::FromArgb(138, 63, 252), [System.Drawing.Color]::FromArgb(255, 46, 151), 0)
$g.DrawString('Fast, free & private.', $f2, $gb, 82, 322)
$f3 = New-Object System.Drawing.Font('Segoe UI', 24)
$muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(79, 74, 114))
$g.DrawString('Merge, compress, convert, edit & sign PDFs. 25 tools, zero uploads.', $f3, $muted, 88, 452)
# pill
$pill = New-RoundRect 88 520 372 52 26
$g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(46, 41, 78))), $pill)
$f4 = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
$g.DrawString('Files never leave your device', $f4, [System.Drawing.Brushes]::White, 106, 531)
$bmp.Save((Join-Path $out 'og.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host 'Images written to' (Resolve-Path $out)


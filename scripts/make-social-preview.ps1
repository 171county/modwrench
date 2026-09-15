# Generates docs/media/social-preview.png — the card GitHub shows on social
# links and in Discord/X unfurls. Upload it by hand once, in repo Settings ->
# "Social preview" (that page is the only route; the API cannot set it).
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-social-preview.ps1
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads a no-BOM .ps1 as ANSI,
# so an em-dash typed into this file would render as the same mojibake this
# repo shipped once. Non-ASCII characters enter by code point.

Add-Type -AssemblyName System.Drawing

$width  = 1280
$height = 640
$em     = [string][char]0x2014   # em dash, by code point
$out    = Join-Path $PSScriptRoot "..\docs\media\social-preview.png"

# Skyrim theme tokens from packages/ui/src/themes.ts.
$bg     = "#15130E"
$panel  = "#211E17"
$ink    = "#EDE6D3"
$sub    = "#9C9078"
$accent = "#C89B3C"
$muted  = "#6B6355"

function Brush([string]$hex) {
    New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($hex))
}

$bmp = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.ColorTranslator]::FromHtml($bg))

# A panel-height slab behind the title, and one accent bar: enough structure
# that the card is not a wall of dark.
$g.FillRectangle((Brush $panel), 0, 0, $width, 340)
$g.FillRectangle((Brush $accent), 0, 0, $width, 10)

$fTitle = New-Object System.Drawing.Font("Segoe UI", 92, [System.Drawing.FontStyle]::Bold)
$fBody  = New-Object System.Drawing.Font("Segoe UI", 27)
$fTag   = New-Object System.Drawing.Font("Segoe UI", 33, [System.Drawing.FontStyle]::Bold)
$fFoot  = New-Object System.Drawing.Font("Consolas", 23)

$g.DrawString("ModWrench", $fTitle, (Brush $ink), 80, 96)
$g.DrawString("An MCP server that connects your AI assistant to Nexus Mods,", $fBody, (Brush $sub), 84, 372)
$g.DrawString("mod.io, Thunderstore, and your own modding setup.", $fBody, (Brush $sub), 84, 416)
$g.DrawString("Paste a crash log. Get the mod that caused it.", $fTag, (Brush $accent), 84, 498)
$g.DrawString("github.com/171county/modwrench $em MIT $em no account, no telemetry", $fFoot, (Brush $muted), 84, 588)

$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "wrote $out ($width x $height)"
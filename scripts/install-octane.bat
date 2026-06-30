@echo off
setlocal enableextensions
title Octane installer / updater
echo ============================================
echo   Octane - install / update
echo ============================================
echo.
echo This will remove any existing Runscope/Octane install and
echo install the latest Octane release. No admin rights required.
echo.
pause

echo.
echo [1/2] Removing previous Runscope / Octane installs...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$names=@('Runscope','Octane'); $roots=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'); foreach($r in $roots){ if(Test-Path $r){ Get-ChildItem $r | ForEach-Object { $p=Get-ItemProperty $_.PSPath; if($p.DisplayName -and ($names -contains $p.DisplayName)){ $u=$p.QuietUninstallString; if(-not $u){ $u=$p.UninstallString }; if($u){ Write-Host ('  Uninstalling '+$p.DisplayName); if($u -notmatch '/S'){ $u=$u+' /S' }; try{ cmd /c $u | Out-Null }catch{}; Start-Sleep -Seconds 3 } } } } }"

echo.
echo [2/2] Downloading and installing the latest Octane (silent)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { $h=@{ 'User-Agent'='octane-installer' }; $rel=Invoke-RestMethod -Headers $h -Uri 'https://api.github.com/repos/Everlasting-dev/octane/releases/latest'; $a=$rel.assets | Where-Object { $_.name -like '*.exe' } | Select-Object -First 1; if(-not $a){ throw 'No .exe asset in the latest release.' }; $out=Join-Path $env:TEMP $a.name; Write-Host ('  Downloading '+$a.name); Invoke-WebRequest -Headers $h -Uri $a.browser_download_url -OutFile $out; Write-Host '  Installing silently...'; Start-Process -FilePath $out -ArgumentList '/S' -Wait; Write-Host '  Done.' } catch { Write-Host ('  ERROR: '+$_.Exception.Message); exit 1 }"

echo.
if %errorlevel% neq 0 (
  echo Something went wrong. Please contact support.
) else (
  echo Octane is installed. You can close this window.
)
echo.
pause

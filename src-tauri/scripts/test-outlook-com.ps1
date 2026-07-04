$ErrorActionPreference = 'Stop'
try {
    $ol = New-Object -ComObject Outlook.Application
    Write-Output "COM_OK"
    $ol.Quit()
} catch {
    Write-Output ("COM_FAIL:" + $_.Exception.GetType().FullName + ":" + $_.Exception.Message)
    exit 1
}

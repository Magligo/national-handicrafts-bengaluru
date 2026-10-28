$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$passwordPointer = [IntPtr]::Zero
$confirmationPointer = [IntPtr]::Zero
$password = $null
$confirmation = $null

try {
  $securePassword = Read-Host 'New admin password (input is hidden)' -AsSecureString
  $secureConfirmation = Read-Host 'Confirm admin password (input is hidden)' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $confirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConfirmation)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $confirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationPointer)

  if ($password -cne $confirmation) { throw 'The password entries did not match.' }
  if ($password.Length -lt 8 -or $password.Length -gt 200) { throw 'Admin password must be between 8 and 200 characters.' }

  Push-Location $projectRoot
  try {
    $env:NH_ADMIN_PASSWORD = $password
    & node tools/admin-password-hash.mjs
    $nodeExitCode = $LASTEXITCODE
  } finally {
    Remove-Item Env:NH_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Pop-Location
  }

  if ($nodeExitCode -ne 0) { throw 'Hash generation, local bcrypt verification, or clipboard copy failed.' }
} finally {
  Remove-Item Env:NH_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
  if ($confirmationPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer) }
  if ($securePassword) { $securePassword.Dispose() }
  if ($secureConfirmation) { $secureConfirmation.Dispose() }
  $password = $null
  $confirmation = $null
}

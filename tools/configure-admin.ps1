param(
  [switch]$ResetAdminPassword
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot '.env'
$templatePath = Join-Path $projectRoot '.env.example'

function Get-EnvValue([string[]]$Lines, [string]$Name) {
  $line = $Lines | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if ($null -eq $line) { return '' }
  return ($line -split '=', 2)[1].Trim()
}

function Set-EnvValue([string[]]$Lines, [string]$Name, [string]$Value) {
  if ($Value -match '[\r\n]') { throw "$Name cannot contain line breaks." }
  $replacement = "$Name=$Value"
  $found = $false
  $updated = foreach ($line in $Lines) {
    if ($line -match "^$([regex]::Escape($Name))=") {
      if (-not $found) { $found = $true; $replacement }
    } else {
      $line
    }
  }
  if (-not $found) { $updated += $replacement }
  return [string[]]$updated
}

function New-Secret {
  $bytes = New-Object -TypeName 'System.Byte[]' -ArgumentList 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  } finally {
    $generator.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $envPath)) {
  Copy-Item -LiteralPath $templatePath -Destination $envPath
}

$lines = [string[]](Get-Content -LiteralPath $envPath)
$bcryptPattern = '^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$'

$existingEmail = Get-EnvValue $lines 'ADMIN_EMAIL'
if ([string]::IsNullOrWhiteSpace($existingEmail) -or $existingEmail -eq 'admin@example.com') {
  do { $adminEmail = (Read-Host 'Admin email').Trim().ToLowerInvariant() } while ($adminEmail -notmatch '^\S+@\S+\.\S+$')
} else {
  $adminEmail = $existingEmail.Trim().ToLowerInvariant()
}
$lines = Set-EnvValue $lines 'ADMIN_EMAIL' $adminEmail

$existingHash = Get-EnvValue $lines 'ADMIN_PASSWORD_HASH'
if ($ResetAdminPassword -or $existingHash -notmatch $bcryptPattern) {
  $securePassword = Read-Host 'Admin password (input is hidden)' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $env:NH_ADMIN_PASSWORD = $plainPassword
    $hash = (& node --input-type=module -e "import bcrypt from 'bcryptjs'; const value = await bcrypt.hash(process.env.NH_ADMIN_PASSWORD, 12); process.stdout.write(value);" 2>$null | Out-String).Trim()
    if ($hash -notmatch $bcryptPattern -or $hash -match '\s' -or $hash.Length -ne 60 -or $hash.Contains('"') -or $hash.Contains("'")) { throw 'bcrypt did not return a valid hash.' }
    $lines = Set-EnvValue $lines 'ADMIN_PASSWORD_HASH' $hash
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    Remove-Item Env:NH_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    $plainPassword = $null
    $hash = $null
  }
} else {
  # Rewrite a valid existing value to remove trailing whitespace and normalize the line.
  $lines = Set-EnvValue $lines 'ADMIN_PASSWORD_HASH' $existingHash
}

$databaseUrl = Get-EnvValue $lines 'DATABASE_URL'
if ([string]::IsNullOrWhiteSpace($databaseUrl) -or $databaseUrl -match '^postgresql://user:password@') {
  # Keep explicit in-memory mode only when no real database connection is configured.
  $lines = Set-EnvValue $lines 'USE_IN_MEMORY_DB' 'true'
} else {
  $lines = Set-EnvValue $lines 'USE_IN_MEMORY_DB' 'false'
}

foreach ($name in @('ADMIN_SESSION_SECRET', 'CUSTOMER_SESSION_SECRET')) {
  $current = Get-EnvValue $lines $name
  if ([string]::IsNullOrWhiteSpace($current) -or $current -match '^replace-with-' -or $current.Length -lt 32) {
    $lines = Set-EnvValue $lines $name (New-Secret)
  }
}

$encoding = New-Object System.Text.UTF8Encoding($false)
$temporaryEnvPath = "$envPath.tmp-$([Guid]::NewGuid().ToString('N'))"
try {
  [IO.File]::WriteAllText($temporaryEnvPath, (($lines -join [Environment]::NewLine) + [Environment]::NewLine), $encoding)
  Move-Item -LiteralPath $temporaryEnvPath -Destination $envPath -Force
  $writtenHash = Get-EnvValue ([string[]](Get-Content -LiteralPath $envPath)) 'ADMIN_PASSWORD_HASH'
  if ($writtenHash -notmatch $bcryptPattern -or $writtenHash -match '\s' -or $writtenHash.Length -ne 60) { throw 'ADMIN_PASSWORD_HASH was not written as a complete bcrypt hash.' }
} finally {
  if (Test-Path -LiteralPath $temporaryEnvPath) { Remove-Item -LiteralPath $temporaryEnvPath -Force }
}
Write-Host 'Admin environment configured. No password or secret was printed.'

$ErrorActionPreference = 'Stop'
$envPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.env.local'))
$tempPath = $null
$backupPath = $null
$passwordBuffer = [IntPtr]::Zero
$securePassword = $null
$password = $null
$operation = 'resolve_environment_file'
$replacementCompleted = $false

function Get-SafeFailureCategory {
  param([Exception]$Exception)

  $rootException = $Exception
  while ($null -ne $rootException.InnerException) {
    $rootException = $rootException.InnerException
  }

  switch ($rootException.GetType().Name) {
    'UnauthorizedAccessException' { return 'access_denied' }
    'SecurityException' { return 'security_error' }
    'FileNotFoundException' { return 'file_not_found' }
    'DirectoryNotFoundException' { return 'directory_not_found' }
    'InvalidDataException' { return 'validation_error' }
    'UriFormatException' { return 'invalid_uri' }
    'PlatformNotSupportedException' { return 'atomic_replace_unsupported' }
    'IOException' { return 'file_io_error' }
    'ArgumentException' { return 'invalid_argument' }
    'PipelineStoppedException' { return 'input_cancelled' }
    default { return 'operation_failed' }
  }
}

try {
  if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    throw [System.IO.FileNotFoundException]::new()
  }

  $operation = 'read_masked_password'
  $securePassword = Read-Host 'Enter the new Supabase database password (input is masked)' -AsSecureString
  if ($null -eq $securePassword -or $securePassword.Length -eq 0) {
    throw [System.IO.InvalidDataException]::new()
  }

  $operation = 'convert_secure_password'
  $passwordBuffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBuffer)
  if ($password.Contains("`r") -or $password.Contains("`n")) {
    throw [System.IO.InvalidDataException]::new()
  }

  $operation = 'read_environment_file'
  $bytes = [System.IO.File]::ReadAllBytes($envPath)
  $hasUtf8Bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  if ($bytes.Length -ge 2 -and (
    ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or
    ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF)
  )) {
    throw [System.IO.InvalidDataException]::new()
  }
  $encoding = [System.Text.UTF8Encoding]::new($hasUtf8Bom)
  $content = [System.IO.File]::ReadAllText($envPath, $encoding)

  $operation = 'validate_line_endings'
  if ($content.Contains("`r`n")) {
    $withoutCrLf = $content.Replace("`r`n", '')
    if ($withoutCrLf.Contains("`r") -or $withoutCrLf.Contains("`n")) {
      throw [System.IO.InvalidDataException]::new()
    }
    $newline = "`r`n"
  } elseif ($content.Contains("`n")) {
    if ($content.Contains("`r")) {
      throw [System.IO.InvalidDataException]::new()
    }
    $newline = "`n"
  } elseif ($content.Contains("`r")) {
    throw [System.IO.InvalidDataException]::new()
  } else {
    $newline = [Environment]::NewLine
  }

  $operation = 'inspect_file_permissions'
  $originalAttributes = [System.IO.File]::GetAttributes($envPath)
  if ($originalAttributes -band [System.IO.FileAttributes]::ReadOnly) {
    throw [System.UnauthorizedAccessException]::new()
  }
  $originalAcl = Get-Acl -LiteralPath $envPath
  $permissionProbe = [System.IO.File]::Open(
    $envPath,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::ReadWrite
  )
  $permissionProbe.Dispose()

  $lines = [System.IO.File]::ReadAllLines($envPath, $encoding)
  $requiredNames = @('DATABASE_URL', 'DATABASE_URL_MIGRATIONS')
  $indices = @{}
  for ($index = 0; $index -lt $lines.Length; $index++) {
    if ($lines[$index] -match '^(DATABASE_URL(?:_MIGRATIONS)?)=(.*)$') {
      $name = $matches[1]
      if (-not $indices.ContainsKey($name)) {
        $indices[$name] = @()
      }
      $indices[$name] += $index
    }
  }

  foreach ($name in $requiredNames) {
    if (-not $indices.ContainsKey($name) -or $indices[$name].Count -ne 1) {
      throw [System.IO.InvalidDataException]::new()
    }
  }

  $uriPattern = '^(?<prefix>postgres(?:ql)?://[^:/?#]+:)(?<oldPassword>[^@/?#]*)(?<suffix>@[^?#]+(?:\?.*)?)$'
  $expectedPorts = @{ DATABASE_URL = 6543; DATABASE_URL_MIGRATIONS = 5432 }
  $parsedConnections = @{}
  $encodedPassword = [Uri]::EscapeDataString($password)
  if ([Uri]::UnescapeDataString($encodedPassword) -cne $password) {
    throw [System.IO.InvalidDataException]::new()
  }

  $operation = 'validate_connection_urls'
  foreach ($name in $requiredNames) {
    $index = $indices[$name][0]
    $assignment = [regex]::Match($lines[$index], '^(?<prefix>DATABASE_URL(?:_MIGRATIONS)?=)(?<value>.*)$')
    if (-not $assignment.Success -or $assignment.Groups['prefix'].Value -ne "$name=") {
      throw [System.IO.InvalidDataException]::new()
    }

    $originalValue = $assignment.Groups['value'].Value
    $quote = ''
    $uriValue = $originalValue
    if ($originalValue.Length -ge 2 -and (
      ($originalValue.StartsWith('"') -and $originalValue.EndsWith('"')) -or
      ($originalValue.StartsWith("'") -and $originalValue.EndsWith("'"))
    )) {
      $quote = $originalValue.Substring(0, 1)
      $uriValue = $originalValue.Substring(1, $originalValue.Length - 2)
    }

    $uriMatch = [regex]::Match($uriValue, $uriPattern)
    if (-not $uriMatch.Success) {
      throw [System.IO.InvalidDataException]::new()
    }

    $originalUri = $null
    if (-not [Uri]::TryCreate($uriValue, [UriKind]::Absolute, [ref]$originalUri)) {
      throw [System.UriFormatException]::new()
    }

    $usernamePart = $uriMatch.Groups['prefix'].Value
    $usernamePart = $usernamePart.Substring($usernamePart.IndexOf('://') + 3)
    $username = $usernamePart.Substring(0, $usernamePart.Length - 1)
    if (
      -not $originalUri.Host.EndsWith('.pooler.supabase.com') -or
      $username -ne 'postgres.uphpfxlgtmwolmeacyfo' -or
      $originalUri.Port -ne $expectedPorts[$name] -or
      $originalUri.AbsolutePath -ne '/postgres'
    ) {
      throw [System.IO.InvalidDataException]::new()
    }

    $newUriText = $uriMatch.Groups['prefix'].Value +
      $encodedPassword +
      $uriMatch.Groups['suffix'].Value
    $newUri = $null
    if (-not [Uri]::TryCreate($newUriText, [UriKind]::Absolute, [ref]$newUri)) {
      throw [System.UriFormatException]::new()
    }

    $newPasswordMatch = [regex]::Match($newUriText, $uriPattern)
    $decodedPassword = [Uri]::UnescapeDataString($newPasswordMatch.Groups['oldPassword'].Value)
    if ($decodedPassword -cne $password) {
      throw [System.IO.InvalidDataException]::new()
    }

    if (
      $newUri.Host -cne $originalUri.Host -or
      $newUri.Port -ne $originalUri.Port -or
      $newUri.AbsolutePath -cne $originalUri.AbsolutePath -or
      $newUri.Query -cne $originalUri.Query
    ) {
      throw [System.IO.InvalidDataException]::new()
    }

    $parsedConnections[$name] = [pscustomobject]@{
      Host = $newUri.Host
      Username = $username
      Port = $newUri.Port
      Path = $newUri.AbsolutePath
      Query = $newUri.Query
      EncodedPassword = $newPasswordMatch.Groups['oldPassword'].Value
    }
    $lines[$index] = "$name=$quote$newUriText$quote"
  }

  if (
    $parsedConnections.DATABASE_URL.Host -cne $parsedConnections.DATABASE_URL_MIGRATIONS.Host -or
    $parsedConnections.DATABASE_URL.Username -cne $parsedConnections.DATABASE_URL_MIGRATIONS.Username -or
    $parsedConnections.DATABASE_URL.Path -cne $parsedConnections.DATABASE_URL_MIGRATIONS.Path -or
    $parsedConnections.DATABASE_URL.EncodedPassword -cne $parsedConnections.DATABASE_URL_MIGRATIONS.EncodedPassword
  ) {
    throw [System.IO.InvalidDataException]::new()
  }

  $updatedContent = [string]::Join($newline, $lines)
  if ($content.EndsWith($newline)) {
    $updatedContent += $newline
  }

  $operation = 'create_temporary_file'
  $tempPath = Join-Path (Split-Path -Parent $envPath) ('.env.local.' + [Guid]::NewGuid().ToString('N') + '.tmp.local')
  $tempStream = [System.IO.File]::Open(
    $tempPath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
  )
  $tempStream.Dispose()

  $operation = 'preserve_file_permissions'
  Set-Acl -LiteralPath $tempPath -AclObject $originalAcl

  $operation = 'write_temporary_file'
  [System.IO.File]::WriteAllText($tempPath, $updatedContent, $encoding)

  $operation = 'verify_temporary_file'
  $savedTemporaryContent = [System.IO.File]::ReadAllText($tempPath, $encoding)
  if ($savedTemporaryContent -cne $updatedContent) {
    throw [System.IO.InvalidDataException]::new()
  }

  $operation = 'atomic_replace'
  $backupPath = Join-Path (Split-Path -Parent $envPath) ('.env.local.' + [Guid]::NewGuid().ToString('N') + '.backup.local')
  [System.IO.File]::Replace($tempPath, $envPath, $backupPath)
  $replacementCompleted = $true
  $tempPath = $null
  $operation = 'remove_replacement_backup'
  [System.IO.File]::Delete($backupPath)
  $backupPath = $null

  Write-Host 'Updated DATABASE_URL and DATABASE_URL_MIGRATIONS atomically. Values were not displayed.'
} catch {
  $exceptionType = $_.Exception.GetType().Name
  $category = Get-SafeFailureCategory -Exception $_.Exception
  $fileState = if ($replacementCompleted) { '.env.local was atomically replaced.' } else { '.env.local was not replaced.' }
  [Console]::Error.WriteLine("Credential update failed at operation '$operation' (category=$category; exception=$exceptionType). $fileState")
  exit 1
} finally {
  if ($null -ne $tempPath -and (Test-Path -LiteralPath $tempPath -PathType Leaf)) {
    try {
      Remove-Item -LiteralPath $tempPath -Force -ErrorAction Stop
    } catch {
      $cleanupCategory = Get-SafeFailureCategory -Exception $_.Exception
      [Console]::Error.WriteLine("Temporary-file cleanup failed (category=$cleanupCategory). A temporary file remains; its path and contents were not displayed.")
    }
  }
  if ($null -ne $backupPath -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
    try {
      Remove-Item -LiteralPath $backupPath -Force -ErrorAction Stop
    } catch {
      $cleanupCategory = Get-SafeFailureCategory -Exception $_.Exception
      [Console]::Error.WriteLine("Sensitive backup cleanup failed (category=$cleanupCategory). A backup containing the previous environment file may remain; its path and contents were not displayed.")
    }
  }
  if ($passwordBuffer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBuffer)
  }
  if ($null -ne $securePassword) {
    $securePassword.Dispose()
  }
  $password = $null
}

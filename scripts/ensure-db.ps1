$envPath = Join-Path $PSScriptRoot "..\.env"
$line = (Get-Content $envPath | Where-Object { $_ -like "DATABASE_URL=*" } | Select-Object -First 1)
if (-not $line) {
  throw "DATABASE_URL not found"
}
$databaseUrl = $line.Substring("DATABASE_URL=".Length)
$match = [regex]::Match($databaseUrl, "postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)")
if (-not $match.Success) {
  throw "DATABASE_URL format invalid"
}
$user = $match.Groups[1].Value
$password = $match.Groups[2].Value
$pgHost = $match.Groups[3].Value
$port = $match.Groups[4].Value
$dbName = $match.Groups[5].Value
$env:PGPASSWORD = $password
$pgBin = "C:\Program Files\PostgreSQL\16\bin"
$psql = Join-Path $pgBin "psql.exe"
$createdb = Join-Path $pgBin "createdb.exe"
$exists = & $psql -U $user -h $pgHost -p $port -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'"
if (-not $exists) {
  & $createdb -U $user -h $pgHost -p $port $dbName
}

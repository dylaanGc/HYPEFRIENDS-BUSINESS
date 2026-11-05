param(
  [string]$ProjectRef = "ynowgseafcpcfgvsmkub",
  [string]$TurnstileSecret = "",
  [string]$BankDetails = "",
  [string]$SinpePhone = "",
  [int]$GamShippingCRC = 2000,
  [int]$OutsideGamShippingCRC = 3500,
  [string]$VapidSubject = "mailto:soporte@hypefriends.com",
  [string]$AllowedOrigins = "https://dylaangc.github.io"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$vapidPath = "C:\temp\hypefriends-vapid.json"
$webhookPath = "C:\temp\hypefriends-webhook-secret.txt"
$envPath = "C:\temp\hypefriends-supabase-secrets.env"

if (!$TurnstileSecret) {
  $TurnstileSecret = [Environment]::GetEnvironmentVariable("TURNSTILE_SECRET_KEY", "User")
}
if (!$BankDetails) {
  $BankDetails = [Environment]::GetEnvironmentVariable("WEB_ORDER_BANK_DETAILS", "User")
}
if (!$SinpePhone) {
  $SinpePhone = [Environment]::GetEnvironmentVariable("WEB_ORDER_SINPE_PHONE", "User")
}
if (!$TurnstileSecret) {
  throw "Falta la clave secreta de Turnstile. Configura TURNSTILE_SECRET_KEY como variable de usuario y vuelve a ejecutar."
}

$supabase = Get-Command supabase.cmd -ErrorAction Stop
$env:SUPABASE_ACCESS_TOKEN = if ($env:SUPABASE_ACCESS_TOKEN) {
  $env:SUPABASE_ACCESS_TOKEN
} else {
  [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
}
if (!$env:SUPABASE_ACCESS_TOKEN) {
  throw "Falta SUPABASE_ACCESS_TOKEN. Configura un token personal de Supabase y vuelve a ejecutar este script."
}
if (!(Test-Path $vapidPath)) {
  throw "No existe $vapidPath. Ejecuta primero la generación de claves VAPID."
}

$vapid = Get-Content $vapidPath -Raw | ConvertFrom-Json
$randomBytes = New-Object byte[] 48
$randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
$randomGenerator.GetBytes($randomBytes)
$randomGenerator.Dispose()
$webhookSecret = [Convert]::ToBase64String($randomBytes)
[IO.File]::WriteAllText($webhookPath, $webhookSecret, [Text.UTF8Encoding]::new($false))

Push-Location $repoRoot
try {
  & $supabase.Source link --project-ref $ProjectRef --yes
  & $supabase.Source db query --remote=$ProjectRef --file "$repoRoot\supabase.sql" --yes
  & $supabase.Source db query --remote=$ProjectRef --file "$repoRoot\supabase-web-orders.sql" --yes
  & $supabase.Source db query --remote=$ProjectRef --file "$repoRoot\supabase-unification.sql" --yes

  $secretLines = @(
    "TURNSTILE_SECRET_KEY=$TurnstileSecret",
    "WEB_ORDER_SHIPPING_GAM_CRC=$GamShippingCRC",
    "WEB_ORDER_SHIPPING_OUTSIDE_GAM_CRC=$OutsideGamShippingCRC",
    "WEB_ORDER_BANK_DETAILS=$BankDetails",
    "WEB_ORDER_SINPE_PHONE=$SinpePhone",
    "ALLOWED_ORIGINS=$AllowedOrigins",
    "VAPID_PUBLIC_KEY=$($vapid.publicKey)",
    "VAPID_PRIVATE_KEY=$($vapid.privateKey)",
    "VAPID_SUBJECT=$VapidSubject",
    "WEB_ORDER_PUSH_WEBHOOK_SECRET=$webhookSecret"
  )
  [IO.File]::WriteAllLines($envPath, $secretLines, [Text.UTF8Encoding]::new($false))
  & $supabase.Source secrets set --env-file $envPath --remote=$ProjectRef
  Remove-Item $envPath -Force

  & $supabase.Source functions deploy create-web-order --remote=$ProjectRef --use-api
  & $supabase.Source functions deploy send-web-order-push --remote=$ProjectRef --use-api
}
finally {
  Pop-Location
}

Write-Output "Migraciones aplicadas, secretos configurados y funciones desplegadas."
Write-Output "Webhook URL: https://$ProjectRef.supabase.co/functions/v1/send-web-order-push"
Write-Output "El secreto del webhook está en $webhookPath. No lo agregues al repositorio ni al frontend."

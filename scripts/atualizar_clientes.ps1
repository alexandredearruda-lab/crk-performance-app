# Atualiza a base de clientes do painel CRK a partir da planilha
# "Base Clientes.xlsx" (deve estar na raiz do projeto, ao lado deste .bat).
# Uso: dê 2 cliques no atalho "Atualizar Base de Clientes.bat" (mesma pasta do projeto).

$ErrorActionPreference = 'Stop'

$arquivo = Join-Path (Split-Path -Parent $PSScriptRoot) "Base Clientes.xlsx"

Write-Host "Arquivo esperado: $arquivo"
Write-Host ""

if (-not (Test-Path -LiteralPath $arquivo)) {
    Write-Host "ARQUIVO NAO ENCONTRADO nesse caminho." -ForegroundColor Red
    Write-Host "Coloque a planilha 'Base Clientes.xlsx' na raiz do projeto (mesma pasta deste atalho)." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Pressione Enter para fechar"
    exit 1
}

Set-Location -LiteralPath $PSScriptRoot
node import_clientes.js
$codigoSaida = $LASTEXITCODE

Write-Host ""
if ($codigoSaida -eq 0) {
    Write-Host "Concluído. Atualize a página do painel (F5) para ver a base de clientes atualizada." -ForegroundColor Green
} else {
    Write-Host "Algo deu errado (veja as mensagens acima)." -ForegroundColor Red
    Write-Host "Se precisar de ajuda, mande essa tela pro Claude." -ForegroundColor Yellow
}
Write-Host ""
Read-Host "Pressione Enter para fechar"
exit $codigoSaida

# Atualiza a aba "Incentivo" do painel CRK a partir da planilha de
# incentivo "Caçador Heineken 600ml" do mês atual.
# Uso: dê 2 cliques no atalho "Atualizar Incentivo.bat" (mesma pasta do projeto).

$ErrorActionPreference = 'Stop'

$mesesPt = @('Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro')
$hoje = Get-Date
$mesNome = $mesesPt[$hoje.Month - 1]
$mesNum = '{0:D2}' -f $hoje.Month
$ano = $hoje.Year

$pastaRelatorio = "C:\Users\alexandre.arruda\CRK Bebidas\Vendas - Documentos\ALEXANDRE - VENDAS\Relatorios $ano\$mesNome"
$arquivo = Join-Path $pastaRelatorio "$mesNum - Incentivo Caçador Heineken 600ml - Acompanhamento.xlsx"

Write-Host "Arquivo esperado: $arquivo"
Write-Host ""

if (-not (Test-Path -LiteralPath $arquivo)) {
    Write-Host "ARQUIVO NAO ENCONTRADO nesse caminho." -ForegroundColor Red
    Write-Host "Confira se o nome/pasta do relatorio deste mes é igual ao padrão de sempre." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Pressione Enter para fechar"
    exit 1
}

Set-Location -LiteralPath $PSScriptRoot
node import_incentivo.js --arquivo $arquivo --commit
$codigoSaida = $LASTEXITCODE

Write-Host ""
if ($codigoSaida -eq 0) {
    Write-Host "Concluído. Atualize a página do painel (F5) para ver os dados de hoje." -ForegroundColor Green
} else {
    Write-Host "Algo deu errado (veja as mensagens acima). Nada foi gravado se o erro apareceu antes de 'Apagando linhas existentes'." -ForegroundColor Red
    Write-Host "Se precisar de ajuda, mande essa tela pro Claude." -ForegroundColor Yellow
}
Write-Host ""
Read-Host "Pressione Enter para fechar"
exit $codigoSaida

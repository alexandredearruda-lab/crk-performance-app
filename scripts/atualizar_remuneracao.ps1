# Atualiza a aba "Remuneração" do painel CRK a partir da planilha
# "Comissão e Produtividade - MM.AAAA.xlsm" (pasta COMISSÃO) do mês atual.
# Uso: dê 2 cliques no atalho "Atualizar Remuneração.bat" (mesma pasta do projeto).

$ErrorActionPreference = 'Stop'

$hoje = Get-Date
$mesNum = '{0:D2}' -f $hoje.Month
$ano = $hoje.Year
$dataReferencia = $hoje.ToString('yyyy-MM-dd')
$mesesPt = @('Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro')
$mesNome = $mesesPt[$hoje.Month - 1]

$pastaComissao = "C:\Users\alexandre.arruda\CRK Bebidas\Vendas - Documentos\ALEXANDRE - VENDAS\Relatorios $ano\$mesNome\COMISSÃO"

Write-Host "Data de referência: $dataReferencia"
Write-Host "Pasta esperada:     $pastaComissao"
Write-Host ""

if (-not (Test-Path -LiteralPath $pastaComissao)) {
    Write-Host "PASTA NAO ENCONTRADA nesse caminho." -ForegroundColor Red
    Write-Host "Confira se o nome/pasta do relatorio deste mes é igual ao padrão de sempre." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Pressione Enter para fechar"
    exit 1
}

# O espaçamento antes do "-" varia entre meses (1 ou 2 espaços) — procura por
# padrão em vez de nome exato.
$arquivo = Get-ChildItem -LiteralPath $pastaComissao -Filter "Comissão e Produtividade*$mesNum.$ano.xlsm" | Select-Object -First 1

if (-not $arquivo) {
    Write-Host "ARQUIVO NAO ENCONTRADO na pasta COMISSÃO pra esse mês." -ForegroundColor Red
    Write-Host "Confira se o nome do arquivo deste mes é igual ao padrão de sempre." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Pressione Enter para fechar"
    exit 1
}

Write-Host "Arquivo encontrado: $($arquivo.FullName)"
Write-Host ""

Set-Location -LiteralPath $PSScriptRoot
node import_remuneracao.js --arquivo $arquivo.FullName --data-referencia $dataReferencia --commit
$codigoSaida = $LASTEXITCODE

Write-Host ""
if ($codigoSaida -eq 0) {
    Write-Host "Concluído. Atualize a página do painel (F5) para ver os dados de hoje." -ForegroundColor Green
} else {
    Write-Host "Algo deu errado (veja as mensagens acima)." -ForegroundColor Red
    Write-Host "Se precisar de ajuda, mande essa tela pro Claude." -ForegroundColor Yellow
}
Write-Host ""
Read-Host "Pressione Enter para fechar"
exit $codigoSaida

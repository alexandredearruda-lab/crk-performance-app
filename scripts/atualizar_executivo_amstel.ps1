# Atualiza a marca "Amstel" da aba "Executivos" do painel CRK a partir da
# planilha "Acompanhamento Executiva Amstel - 40 PDVS" do mês/ano atuais.
# Uso: dê 2 cliques no atalho "Atualizar Executivo Amstel.bat" (mesma pasta do projeto).

$ErrorActionPreference = 'Stop'

$mesesPt = @('Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro')
$hoje = Get-Date
$mesNome = $mesesPt[$hoje.Month - 1]
$mesNum = '{0:D2}' -f $hoje.Month
$ano = $hoje.Year
# Sempre o 1º dia do mês, não a data de hoje: se o import rodar mais de uma
# vez no mesmo mês (ex: pra corrigir algo), tem que cair na MESMA
# data_referencia — senão duplica o mês no seletor do painel (cada rodada
# criaria uma linha nova em vez de substituir a anterior).
$dataReferencia = "$ano-$mesNum-01"

$pastaRelatorio = "C:\Users\alexandre.arruda\CRK Bebidas\Vendas - Documentos\ALEXANDRE - VENDAS\Relatorios $ano\$mesNome"
$arquivo = Join-Path $pastaRelatorio "$mesNum - Acompanhamento Executiva Amstel - 40 PDVS.xlsx"

Write-Host "Marca:              Amstel"
Write-Host "Data de referência: $dataReferencia"
Write-Host "Arquivo esperado:   $arquivo"
Write-Host ""

if (-not (Test-Path -LiteralPath $arquivo)) {
    Write-Host "ARQUIVO NAO ENCONTRADO nesse caminho." -ForegroundColor Red
    Write-Host "Confira se o nome/pasta do relatorio deste mes é igual ao padrão de sempre." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Pressione Enter para fechar"
    exit 1
}

Set-Location -LiteralPath $PSScriptRoot
node import_executivo.js --marca amstel --arquivo $arquivo --data-referencia $dataReferencia --commit
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

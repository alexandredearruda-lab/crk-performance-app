// Lê "Comissão e Produtividade - MM.AAAA.xlsm" (abas "Painel de Pagamentos AS"
// e "Painel de Pagamentos MF") e grava em remuneracao_resumo /
// remuneracao_categoria no Supabase.
//
// Uso:
//   cd scripts
//   node import_remuneracao.js --arquivo "../COMISSÃO/Comissão e Produtividade  - 08.2026.xlsm" --data-referencia 2026-08-20
//
// Por padrão roda em modo VALIDAÇÃO (dry-run): lê e despivota tudo, imprime um
// resumo, e NÃO grava nada no banco. Só grava de verdade com --commit.
//
// Idempotência: igual import_fundamentos.js — apaga antes as linhas já
// existentes com a mesma data_referencia em cada tabela, e insere de novo.
//
// Layout de cada aba ("Painel de Pagamentos AS"/"MF"): 1+ "blocos de papel"
// (Vendedor, depois Supervisor/GV) empilhados verticalmente. Cada bloco tem 2
// linhas de cabeçalho — uma com o nome de cada categoria de performance
// (ex: "HL PREMIUM", "Cob Total"), outra logo abaixo com "SUPERVISOR / CPF /
// CÓD / SETOR / VENDEDOR" + "Real % / R$" repetido por categoria + no final
// "DIAS UTEIS / Dias trab / FIXO / COMISSÃO / PRODUTIVIDADE / TOTAL /
// PEDÁGIO" — depois as linhas de gente. O 1º bloco de cada aba é sempre
// vendedor; qualquer bloco seguinte junta supervisor(es) e o GV numa coisa só
// (a planilha não separa os dois com um campo próprio nesse nível).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

// Pastas sincronizadas por OneDrive às vezes gravam nomes acentuados numa
// forma Unicode (NFD — "a" + til combinante) diferente da que aparece ao
// digitar o caminho (NFC — "ã" precomposto): parecem idênticos na tela, mas
// os bytes diferem e dá ENOENT mesmo com o caminho "certo". Se o caminho
// literal não existir, procura na pasta um arquivo cujo nome bata ignorando
// esse detalhe de normalização.
function resolverCaminhoReal(caminhoPedido) {
  if (fs.existsSync(caminhoPedido)) return caminhoPedido;
  const dir = path.dirname(caminhoPedido);
  const baseAlvo = path.basename(caminhoPedido).normalize('NFC');
  if (!fs.existsSync(dir)) return caminhoPedido; // deixa o erro original aparecer
  const achado = fs.readdirSync(dir).find((f) => f.normalize('NFC') === baseAlvo);
  return achado ? path.join(dir, achado) : caminhoPedido;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = 500;

function parseArgs(argv) {
  const args = { commit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arquivo') args.arquivo = argv[++i];
    else if (a === '--data-referencia') args.dataReferencia = argv[++i];
    else if (a === '--commit') args.commit = true;
  }
  return args;
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}
function intOrNull(v) {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
}
function strOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Acha toda linha "CÓD"/"SETOR" (cabeçalho de campo de um bloco de papel) —
// a linha de nomes de categoria fica sempre logo acima dela.
function encontrarBlocos(rows) {
  const blocos = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (row[3] === 'CÓD' && row[4] === 'SETOR') {
      blocos.push({ headerRow: r, categoriaRow: r - 1 });
    }
  }
  return blocos;
}

// Categorias: qualquer célula preenchida na linha de categorias a partir da
// coluna 7, largura 2 (Real % + R$) cada — não assume espaçamento fixo entre
// blocos de categoria (tem lacunas de 1 coluna em vários pontos).
function detectarCategorias(linhaCategorias) {
  const blocos = [];
  for (let col = 7; col < linhaCategorias.length; col++) {
    const raw = linhaCategorias[col];
    if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
      blocos.push({ startCol: col, categoria: String(raw).trim() });
    }
  }
  blocos.forEach((b, i) => { b.ordemBloco = i + 1; });
  return blocos;
}

function despivotarAba(rows, { canal, dataReferencia, arquivoOrigem }) {
  const blocosPapel = encontrarBlocos(rows);
  const resumoRows = [];
  const categoriaRows = [];
  const stats = { blocos: [], pessoas: new Set() };

  blocosPapel.forEach((bloco, idx) => {
    const papel = idx === 0 ? 'Vendedor' : 'Supervisor/GV';
    const headerRow = rows[bloco.headerRow];
    const categoriasBloco = detectarCategorias(rows[bloco.categoriaRow] || []);

    const colDiasUteis = headerRow.indexOf('DIAS UTEIS');
    if (colDiasUteis === -1) {
      console.warn(`⚠ Bloco "${papel}" (linha ${bloco.headerRow + 1}): não achei a coluna "DIAS UTEIS" — pulando resumo desse bloco (categorias ainda são importadas).`);
    }
    // ordem confirmada célula a célula no arquivo real: DIAS UTEIS, Dias
    // trab, FIXO, COMISSÃO, PRODUTIVIDADE, TOTAL, PEDÁGIO, nessa sequência.
    const colDiasTrab = colDiasUteis === -1 ? -1 : colDiasUteis + 1;
    const colFixo = colDiasUteis === -1 ? -1 : colDiasUteis + 2;
    const colComissao = colDiasUteis === -1 ? -1 : colDiasUteis + 3;
    const colProdutividade = colDiasUteis === -1 ? -1 : colDiasUteis + 4;
    const colTotal = colDiasUteis === -1 ? -1 : colDiasUteis + 5;
    const colPedagio = colDiasUteis === -1 ? -1 : colDiasUteis + 6;

    let pessoasNoBloco = 0;
    const proximoBloco = blocosPapel[idx + 1];
    const limiteLinha = proximoBloco ? proximoBloco.categoriaRow : rows.length;

    // "SUPERVISOR" só vem preenchido na 1ª linha de cada grupo (célula
    // mesclada no Excel) — arrasta o último valor visto pras linhas
    // seguintes do mesmo grupo, senão a maioria fica sem supervisor.
    let supervisorAtual = null;

    for (let r = bloco.headerRow + 1; r < limiteLinha; r++) {
      const row = rows[r];
      if (!row) continue;
      const setorRaw = row[4];
      const pessoaRaw = row[5];
      if (strOrNull(row[1])) supervisorAtual = strOrNull(row[1]);
      // linha de gente de verdade: SETOR preenchido e VENDEDOR é texto (não
      // número — descarta linhas auxiliares tipo 1,2,3,4... vistas no fim
      // de algumas abas).
      const setorVazio = setorRaw === null || setorRaw === undefined || String(setorRaw).trim() === '';
      const pessoaValida = typeof pessoaRaw === 'string' && pessoaRaw.trim() !== '';
      if (setorVazio || !pessoaValida) continue;

      const setor = String(setorRaw).trim();
      const pessoa = pessoaRaw.trim();
      const supervisor = supervisorAtual;
      const codigoInterno = strOrNull(row[3]);

      pessoasNoBloco++;
      stats.pessoas.add(`${canal}/${papel}/${pessoa}`);

      resumoRows.push({
        data_referencia: dataReferencia,
        canal,
        papel,
        supervisor,
        codigo_interno: codigoInterno,
        setor,
        pessoa,
        dias_uteis: colDiasUteis === -1 ? null : intOrNull(row[colDiasUteis]),
        dias_trab: colDiasUteis === -1 ? null : intOrNull(row[colDiasTrab]),
        fixo: colDiasUteis === -1 ? null : numOrNull(row[colFixo]),
        comissao: colDiasUteis === -1 ? null : numOrNull(row[colComissao]),
        produtividade: colDiasUteis === -1 ? null : numOrNull(row[colProdutividade]),
        total: colDiasUteis === -1 ? null : numOrNull(row[colTotal]),
        pedagio: colDiasUteis === -1 ? null : numOrNull(row[colPedagio]),
        arquivo_origem: arquivoOrigem,
      });

      categoriasBloco.forEach((cat) => {
        const realPct = numOrNull(row[cat.startCol]);
        const valorR = numOrNull(row[cat.startCol + 1]);
        if (realPct === null && valorR === null) return; // categoria vazia pra essa pessoa — não grava linha
        categoriaRows.push({
          data_referencia: dataReferencia,
          canal,
          papel,
          setor,
          pessoa,
          categoria: cat.categoria,
          ordem_bloco: cat.ordemBloco,
          real_pct: realPct,
          valor_r: valorR,
          arquivo_origem: arquivoOrigem,
        });
      });
    }

    stats.blocos.push({ papel, categorias: categoriasBloco.length, pessoas: pessoasNoBloco });
  });

  return { resumoRows, categoriaRows, stats };
}

async function commitTabela(db, tabela, rows, dataReferencia, canal) {
  console.log(`\nApagando linhas existentes de ${tabela} para data_referencia=${dataReferencia}, canal=${canal}...`);
  const { error: delErr } = await db.from(tabela).delete().eq('data_referencia', dataReferencia).eq('canal', canal);
  if (delErr) throw new Error(`Falha ao apagar ${tabela}: ${delErr.message}`);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await db.from(tabela).insert(batch);
    if (error) throw new Error(`Falha ao inserir lote em ${tabela}: ${error.message}`);
    inserted += batch.length;
    console.log(`  ${tabela} (${canal}): ${inserted}/${rows.length} linhas gravadas.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.dataReferencia || !/^\d{4}-\d{2}-\d{2}$/.test(args.dataReferencia) || Number.isNaN(Date.parse(args.dataReferencia))) {
    console.error('Uso: node import_remuneracao.js --arquivo "<caminho.xlsm>" --data-referencia YYYY-MM-DD [--commit]');
    process.exit(1);
  }
  if (!args.arquivo) {
    console.error('Uso: node import_remuneracao.js --arquivo "<caminho.xlsm>" --data-referencia YYYY-MM-DD [--commit]');
    process.exit(1);
  }

  const arquivoPath = resolverCaminhoReal(path.resolve(process.cwd(), args.arquivo));
  const arquivoOrigem = path.basename(arquivoPath);

  console.log('Lendo', arquivoPath, '...');
  const wb = XLSX.readFile(arquivoPath, { cellDates: true });

  const ABAS = [
    { nome: 'Painel de Pagamentos AS', canal: 'AS' },
    { nome: 'Painel de Pagamentos MF', canal: 'MF' },
  ];

  const resultados = [];
  for (const aba of ABAS) {
    const ws = wb.Sheets[aba.nome];
    if (!ws) {
      console.warn(`⚠ Aba "${aba.nome}" não encontrada no arquivo — pulando canal ${aba.canal}.`);
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const resultado = despivotarAba(rows, { canal: aba.canal, dataReferencia: args.dataReferencia, arquivoOrigem });
    resultados.push({ ...aba, resultado });

    console.log(`\n=== ${aba.nome} (canal ${aba.canal}) ===`);
    resultado.stats.blocos.forEach((b) => console.log(`  Bloco "${b.papel}": ${b.categorias} categorias, ${b.pessoas} pessoa(s)`));
    console.log(`  Total: ${resultado.resumoRows.length} linha(s) de resumo, ${resultado.categoriaRows.length} linha(s) de categoria.`);
  }

  const semLinhas = resultados.filter((r) => r.resultado.resumoRows.length === 0);
  if (semLinhas.length === resultados.length) {
    console.error('\nAbortando: nenhuma linha gerada em nenhuma aba. Confira o arquivo antes de continuar.');
    process.exit(1);
  }

  if (process.env.DEBUG_SAMPLE) {
    resultados.forEach((r) => {
      console.log(`\nAmostra resumo (${r.canal}):`, JSON.stringify(r.resultado.resumoRows.slice(0, 2), null, 2));
      console.log(`Amostra categoria (${r.canal}):`, JSON.stringify(r.resultado.categoriaRows.slice(0, 3), null, 2));
    });
  }

  if (!args.commit) {
    console.log('\n--- Modo validação (dry-run): nada foi gravado no Supabase. ---');
    console.log('Confira o resumo acima. Se bateu com o esperado, rode de novo com --commit pra gravar de verdade.');
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env (veja .env.example).');
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  for (const r of resultados) {
    if (!r.resultado.resumoRows.length) continue;
    await commitTabela(db, 'remuneracao_resumo', r.resultado.resumoRows, args.dataReferencia, r.canal);
    await commitTabela(db, 'remuneracao_categoria', r.resultado.categoriaRows, args.dataReferencia, r.canal);
  }
  console.log('\nConcluído.');
}

main().catch((err) => {
  console.error('Falhou:', err.message || err);
  process.exit(1);
});

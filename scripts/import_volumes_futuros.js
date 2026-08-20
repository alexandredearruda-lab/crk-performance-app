// Lê "08 - Acompanhamento Executiva Volumes Futuros - 40 PDVS.xlsx" (abas
// "Geral CRK" e "Base Estratégica Amstel") e grava em
// volumes_futuros_indicadores / amstel_estrategico no Supabase.
//
// Uso:
//   cd scripts
//   node import_volumes_futuros.js --arquivo "../08 - Acompanhamento Executiva Volumes Futuros - 40 PDVS.xlsx" --data-referencia 2026-08-20
//
// Por padrão roda em modo VALIDAÇÃO (dry-run): lê e despivota tudo, imprime um
// resumo, e NÃO grava nada no banco. Só grava de verdade com --commit.
//
// Idempotência: igual import_fundamentos.js — apaga antes as linhas já
// existentes com a mesma data_referencia em cada tabela, e insere de novo.
//
// A aba "Geral CRK" traz, no rodapé (depois da lista de vendedores), um
// resumo por supervisor com o código numérico de cada um (SETOR nessa parte
// = código do supervisor, não do vendedor) — usado aqui só como de-para
// interno pra traduzir os códigos "Sup"/"Vend" da aba Amstel, não é gravado
// como linha própria (os totais por supervisor a tela já calcula sozinha a
// partir das linhas de vendedor, igual acontece em Indicadores).

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

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
function linhaVazia(row, cols) {
  return cols.every((c) => {
    const v = row[c];
    return v === null || v === undefined || String(v).trim() === '';
  });
}

// ----------------------------------------------------------------------------
// Aba "Geral CRK" — resumo por vendedor. Layout: linha 2/3/4 (índice 1/2/3) =
// dias úteis/trabalhados/faltantes; linha 5 (índice 4) = nomes dos blocos de
// categoria a partir da coluna F (índice 5), largura 4 cada (Meta/Real/%/Nec.
// Dia); linha 6 (índice 5) = cabeçalho de coluna; dados a partir da linha 7
// (índice 6) até a primeira linha totalmente vazia.
// ----------------------------------------------------------------------------
function despivotarGeralCRK(rows, { dataReferencia, arquivoOrigem }) {
  const diasUteisVenda = intOrNull(rows[1] && rows[1][2]);
  const diasTrabalhados = intOrNull(rows[2] && rows[2][2]);
  const diasFaltantes = intOrNull(rows[3] && rows[3][2]);

  const linhaCategorias = rows[4] || [];
  const blocos = [];
  for (let col = 5; col < linhaCategorias.length; col++) {
    const raw = linhaCategorias[col];
    if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
      blocos.push({ startCol: col, categoria: String(raw).trim() });
    }
  }
  blocos.forEach((b, i) => { b.ordemBloco = i + 1; });

  const outputRows = [];
  const vendCodigoToNome = new Map();
  let supervisorAtual = null;
  const supervisoresConhecidos = new Set();

  let r = 6;
  for (; r < rows.length; r++) {
    const row = rows[r];
    if (linhaVazia(row, [2, 3])) break; // fim do bloco de vendedores

    if (row[1] !== null && row[1] !== undefined && String(row[1]).trim() !== '') {
      supervisorAtual = String(row[1]).trim();
      supervisoresConhecidos.add(supervisorAtual.toUpperCase());
    }

    const vendedor = strOrNull(row[3]);
    const setor = strOrNull(row[2]);
    if (vendedor && supervisoresConhecidos.has(vendedor.toUpperCase())) continue; // linha de subtotal misturada, se houver

    const pdvs = intOrNull(row[4]);
    if (setor && vendedor) vendCodigoToNome.set(Number(setor), vendedor);

    for (const b of blocos) {
      outputRows.push({
        data_referencia: dataReferencia,
        dias_uteis_venda: diasUteisVenda,
        dias_trabalhados: diasTrabalhados,
        dias_faltantes: diasFaltantes,
        supervisor: supervisorAtual,
        setor,
        vendedor,
        pdvs,
        categoria: b.categoria,
        ordem_bloco: b.ordemBloco,
        meta: numOrNull(row[b.startCol]),
        real: numOrNull(row[b.startCol + 1]),
        percentual: numOrNull(row[b.startCol + 2]),
        necessidade_dia: numOrNull(row[b.startCol + 3]),
        arquivo_origem: arquivoOrigem,
      });
    }
  }

  // Resumo por supervisor no rodapé (código -> nome) — só usado como de-para
  // interno pra aba Amstel, não é gravado. Procura a próxima linha com
  // "SETOR"/"SUPERVISOR" no cabeçalho depois do fim dos vendedores.
  const supCodigoToNome = new Map();
  for (let s = r; s < rows.length; s++) {
    const row = rows[s] || [];
    if (row[2] === 'SETOR' && row[3] === 'SUPERVISOR') {
      for (let t = s + 1; t < rows.length; t++) {
        const dataRow = rows[t];
        if (linhaVazia(dataRow, [2, 3])) break;
        const cod = intOrNull(dataRow[2]);
        const nome = strOrNull(dataRow[3]);
        if (cod !== null && nome) supCodigoToNome.set(cod, nome);
      }
      break;
    }
  }

  return { rows: outputRows, vendCodigoToNome, supCodigoToNome, blocos };
}

// ----------------------------------------------------------------------------
// Aba "Base Estratégica Amstel" — checklist dos PDVs estratégicos. Cabeçalho
// na linha 6 (índice 5), dados a partir da linha 7 (índice 6) até a primeira
// linha sem código de cliente.
// ----------------------------------------------------------------------------
function despivotarAmstel(rows, { dataReferencia, arquivoOrigem, vendCodigoToNome, supCodigoToNome }) {
  const outputRows = [];
  const codigosNaoTraduzidos = { sup: new Set(), vend: new Set() };

  for (let r = 6; r < rows.length; r++) {
    const row = rows[r];
    const codigoCliente = strOrNull(row[4]);
    if (!codigoCliente) break;

    const supCod = intOrNull(row[1]);
    const vendCod = intOrNull(row[2]);
    if (supCod !== null && !supCodigoToNome.has(supCod)) codigosNaoTraduzidos.sup.add(supCod);
    if (vendCod !== null && !vendCodigoToNome.has(vendCod)) codigosNaoTraduzidos.vend.add(vendCod);

    outputRows.push({
      data_referencia: dataReferencia,
      numero: intOrNull(row[0]),
      supervisor_codigo: supCod,
      supervisor_nome: supCod !== null ? (supCodigoToNome.get(supCod) || null) : null,
      vendedor_codigo: vendCod,
      vendedor_nome: vendCod !== null ? (vendCodigoToNome.get(vendCod) || null) : null,
      pt: intOrNull(row[3]),
      cliente_codigo: codigoCliente,
      fantasia: strOrNull(row[5]) || codigoCliente,
      cidade: strOrNull(row[6]),
      canal: strOrNull(row[7]),
      matriz_nivel: strOrNull(row[8]),
      cob_spin: intOrNull(row[9]),
      cob_craft: intOrNull(row[10]),
      cob_fys_itubaina: intOrNull(row[11]),
      rota_forms: strOrNull(row[12]),
      geladeira_chopeira: strOrNull(row[13]),
      cardapio: strOrNull(row[14]),
      uniforme: strOrNull(row[15]),
      fachada_execucao: strOrNull(row[16]),
      contrato_acordo: strOrNull(row[17]),
      arquivo_origem: arquivoOrigem,
    });
  }

  return { rows: outputRows, codigosNaoTraduzidos };
}

async function commitTabela(db, tabela, rows, dataReferencia) {
  console.log(`\nApagando linhas existentes de ${tabela} para data_referencia=${dataReferencia}...`);
  const { error: delErr } = await db.from(tabela).delete().eq('data_referencia', dataReferencia);
  if (delErr) throw new Error(`Falha ao apagar ${tabela}: ${delErr.message}`);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await db.from(tabela).insert(batch);
    if (error) throw new Error(`Falha ao inserir lote em ${tabela}: ${error.message}`);
    inserted += batch.length;
    console.log(`  ${tabela}: ${inserted}/${rows.length} linhas gravadas.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.dataReferencia || !/^\d{4}-\d{2}-\d{2}$/.test(args.dataReferencia) || Number.isNaN(Date.parse(args.dataReferencia))) {
    console.error('Uso: node import_volumes_futuros.js --arquivo "<caminho.xlsx>" --data-referencia YYYY-MM-DD [--commit]');
    process.exit(1);
  }
  if (!args.arquivo) {
    console.error('Uso: node import_volumes_futuros.js --arquivo "<caminho.xlsx>" --data-referencia YYYY-MM-DD [--commit]');
    process.exit(1);
  }

  const arquivoPath = path.resolve(process.cwd(), args.arquivo);
  const arquivoOrigem = path.basename(arquivoPath);

  console.log('Lendo', arquivoPath, '...');
  const wb = XLSX.readFile(arquivoPath, { cellDates: true });

  const wsGeral = wb.Sheets['Geral CRK'];
  if (!wsGeral) { console.error('Aba "Geral CRK" não encontrada no arquivo.'); process.exit(1); }
  const rowsGeral = XLSX.utils.sheet_to_json(wsGeral, { header: 1, raw: true, defval: null });
  const geral = despivotarGeralCRK(rowsGeral, { dataReferencia: args.dataReferencia, arquivoOrigem });

  console.log('\n=== Geral CRK -> volumes_futuros_indicadores ===');
  console.log(`Blocos de categoria: ${geral.blocos.map((b) => b.categoria).join(', ')}`);
  console.log(`Vendedores únicos: ${geral.vendCodigoToNome.size}`);
  console.log(`Linhas geradas: ${geral.rows.length}`);
  console.log(`Supervisores identificados no rodapé (de-para pra Amstel): ${[...geral.supCodigoToNome.entries()].map(([c, n]) => `${c}=${n}`).join(', ') || '(nenhum)'}`);

  const wsAmstel = wb.Sheets['Base Estratégica Amstel'];
  let amstel = { rows: [], codigosNaoTraduzidos: { sup: new Set(), vend: new Set() } };
  if (!wsAmstel) {
    console.warn('⚠ Aba "Base Estratégica Amstel" não encontrada no arquivo — pulando amstel_estrategico.');
  } else {
    const rowsAmstel = XLSX.utils.sheet_to_json(wsAmstel, { header: 1, raw: true, defval: null });
    amstel = despivotarAmstel(rowsAmstel, {
      dataReferencia: args.dataReferencia,
      arquivoOrigem,
      vendCodigoToNome: geral.vendCodigoToNome,
      supCodigoToNome: geral.supCodigoToNome,
    });
    console.log('\n=== Base Estratégica Amstel -> amstel_estrategico ===');
    console.log(`PDVs: ${amstel.rows.length}`);
    if (amstel.codigosNaoTraduzidos.sup.size) console.warn(`ATENÇÃO: código(s) de supervisor sem nome encontrado: ${[...amstel.codigosNaoTraduzidos.sup].join(', ')}`);
    if (amstel.codigosNaoTraduzidos.vend.size) console.warn(`ATENÇÃO: código(s) de vendedor sem nome encontrado: ${[...amstel.codigosNaoTraduzidos.vend].join(', ')}`);
  }

  if (geral.rows.length === 0) {
    console.error('\nAbortando: nenhuma linha gerada para Geral CRK. Confira o arquivo antes de continuar.');
    process.exit(1);
  }

  if (process.env.DEBUG_SAMPLE) {
    console.log('\nAmostra Geral CRK:', JSON.stringify(geral.rows.slice(0, 3), null, 2));
    console.log('\nAmostra Amstel:', JSON.stringify(amstel.rows.slice(0, 3), null, 2));
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
  await commitTabela(db, 'volumes_futuros_indicadores', geral.rows, args.dataReferencia);
  if (amstel.rows.length) await commitTabela(db, 'amstel_estrategico', amstel.rows, args.dataReferencia);
  console.log('\nConcluído.');
}

main().catch((err) => {
  console.error('Falhou:', err.message || err);
  process.exit(1);
});

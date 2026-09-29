// Lê uma das duas planilhas "Acompanhamento Executiva ... - 40 PDVS.xlsx"
// (Amstel ou Volumes Futuros) e grava em volumes_futuros_indicadores +
// amstel_estrategico/volumefuturo_estrategico no Supabase. Substitui o antigo
// import_volumes_futuros.js — a diferença entre as duas planilhas agora é
// escolhida com --marca, em vez de estar fixa no código.
//
// Uso:
//   cd scripts
//   node import_executivo.js --marca amstel --arquivo "../09 - Acompanhamento Executiva Amstel - 40 PDVS.xlsx" --data-referencia 2026-09-29
//   node import_executivo.js --marca volume_futuro --arquivo "../09 - Acompanhamento Executiva Volumes Futuros - 40 PDVS.xlsx" --data-referencia 2026-09-29
//
// Por padrão roda em modo VALIDAÇÃO (dry-run): lê e despivota tudo, imprime um
// resumo, e NÃO grava nada no banco. Só grava de verdade com --commit.
//
// Idempotência: apaga antes as linhas já existentes da mesma
// (data_referencia, marca) em volumes_futuros_indicadores, e da mesma
// data_referencia na tabela estratégica correspondente — e insere de novo.
// Como as duas marcas moram na mesma tabela volumes_futuros_indicadores,
// rodar uma marca não apaga os dados da outra marca na mesma data.
//
// Layout das planilhas (conferido célula a célula nos dois arquivos reais em
// 2026-09-29 — os scripts antigos tinham índice de coluna/linha errado,
// deslocado em 1, porque a coluna A e a linha 1 de cada aba estão em branco):
//
// Aba "Geral CRK" (igual nas duas planilhas, só muda o nome dos blocos):
//   C2/D2=Data  C3/D3=Dias Úteis Venda  C4/D4=Dias Trabalhados  C5/D5=Dias Faltantes
//   linha 6: nomes dos blocos de categoria a partir da coluna G (4 colunas cada: Meta/Real/%/Nec.Dia)
//   linha 7: cabeçalho (B=GV, C=SUPERVISOR, D=SETOR, E=VENDEDOR, F=PDV'S, G..=blocos)
//   linha 8+: dados por vendedor, até a primeira linha sem SETOR/VENDEDOR
//   mais abaixo: um segundo cabeçalho (D='SETOR', E='SUPERVISOR') com os totais por supervisor —
//     usado só como de-para código→nome pra aba Base Estratégica, não é gravado como linha própria.
//
// Aba "Base Estratégica <Amstel|volume futuro>":
//   linha 7: cabeçalho (B=Nº, C=Sup, D=Vend, E=Pt, F=Código, G=Fantasia, H=Cidade, I=Canal, J=Matriz, K..=flags)
//   linha 8+: um PDV por linha, até a primeira linha sem Código.
//   Amstel: 4 flags (K=RGB Amstel, L=RGB Heineken, M=Onde tem HNK/Tem Amstel, N=Amstel OW)
//   Volume Futuro: 3 flags (K=Cob. SPIN, L=Cob. Craft, M=Cob. FYS ou Itubaina)
//   depois dos flags, sempre na mesma ordem: Rota Forms, Geladeira/Chopeira, Cardápio, Uniforme, Fachada, Contrato.

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = 500;

const MARCAS = {
  amstel: {
    sheetEstrategica: 'Base Estratégica Amstel',
    tabelaEstrategica: 'amstel_estrategico',
    flags: [
      { col: 10, field: 'rgb_amstel' },
      { col: 11, field: 'rgb_heineken' },
      { col: 12, field: 'onde_tem_hnk_tem_amstel' },
      { col: 13, field: 'amstel_ow' },
    ],
  },
  volume_futuro: {
    sheetEstrategica: 'Base Estratégica volume futuro',
    tabelaEstrategica: 'volumefuturo_estrategico',
    flags: [
      { col: 10, field: 'cob_spin' },
      { col: 11, field: 'cob_craft' },
      { col: 12, field: 'cob_fys_itubaina' },
    ],
  },
};

function parseArgs(argv) {
  const args = { commit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arquivo') args.arquivo = argv[++i];
    else if (a === '--data-referencia') args.dataReferencia = argv[++i];
    else if (a === '--marca') args.marca = argv[++i];
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

// SheetJS's sheet_to_json({header:1}) indexes rows/colunas relativos ao
// início da área usada da planilha (ws['!ref']), não à célula A1 absoluta.
// Como as duas planilhas têm áreas usadas começando em colunas/linhas
// diferentes (ex: "B2:R41" numa aba, "A2:S54" noutra), isso desalinha os
// índices fixos deste script. Esta função normaliza o resultado pra sempre
// bater com endereçamento absoluto (linha 1 = índice 0, coluna A = índice 0),
// preenchendo com null o que faltar antes do início da área usada.
function lerPlanilhaAbsoluta(ws) {
  const rowsRel = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const padRows = range.s.r; // linhas em branco antes do início da área usada
  const padCols = range.s.c; // colunas em branco antes do início da área usada
  const rows = [];
  for (let i = 0; i < padRows; i++) rows.push([]);
  for (const row of rowsRel) {
    rows.push(padCols > 0 ? new Array(padCols).fill(null).concat(row) : row);
  }
  return rows;
}

// ----------------------------------------------------------------------------
// Aba "Geral CRK" — resumo por vendedor. Ver notas de layout no topo do arquivo.
// ----------------------------------------------------------------------------
function despivotarGeralCRK(rows, { dataReferencia, marca, arquivoOrigem }) {
  const diasUteisVenda = intOrNull(rows[2] && rows[2][3]);
  const diasTrabalhados = intOrNull(rows[3] && rows[3][3]);
  const diasFaltantes = intOrNull(rows[4] && rows[4][3]);

  const linhaCategorias = rows[5] || [];
  const blocos = [];
  for (let col = 6; col < linhaCategorias.length; col++) {
    const raw = linhaCategorias[col];
    if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
      blocos.push({ startCol: col, categoria: String(raw).trim() });
    }
  }
  blocos.forEach((b, i) => { b.ordemBloco = i + 1; });

  const outputRows = [];
  const vendCodigoToNome = new Map();
  let supervisorAtual = null;

  let r = 7;
  for (; r < rows.length; r++) {
    const row = rows[r] || [];
    const setor = strOrNull(row[3]);
    const vendedor = strOrNull(row[4]);
    if (!setor && !vendedor) break; // fim do bloco de vendedores

    const supNome = strOrNull(row[2]);
    if (supNome) supervisorAtual = supNome;

    const pdvs = intOrNull(row[5]);
    if (setor && vendedor) vendCodigoToNome.set(Number(setor), vendedor);

    for (const b of blocos) {
      outputRows.push({
        data_referencia: dataReferencia,
        marca,
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
  // interno pra aba Base Estratégica, não é gravado.
  const supCodigoToNome = new Map();
  for (let s = r; s < rows.length; s++) {
    const row = rows[s] || [];
    if (row[3] === 'SETOR' && row[4] === 'SUPERVISOR') {
      for (let t = s + 1; t < rows.length; t++) {
        const dataRow = rows[t] || [];
        const cod = intOrNull(dataRow[3]);
        const nome = strOrNull(dataRow[4]);
        if (cod === null && !nome) break;
        if (cod !== null && nome) supCodigoToNome.set(cod, nome);
      }
      break;
    }
  }

  return { rows: outputRows, vendCodigoToNome, supCodigoToNome, blocos };
}

// ----------------------------------------------------------------------------
// Aba "Base Estratégica <marca>" — checklist dos PDVs estratégicos.
// ----------------------------------------------------------------------------
function despivotarEstrategica(rows, marcaConfig, { dataReferencia, arquivoOrigem, vendCodigoToNome, supCodigoToNome }) {
  const outputRows = [];
  const codigosNaoTraduzidos = { sup: new Set(), vend: new Set() };
  const flagsEnd = Math.max(...marcaConfig.flags.map((f) => f.col)) + 1;

  for (let r = 7; r < rows.length; r++) {
    const row = rows[r] || [];
    const codigoCliente = strOrNull(row[5]);
    if (!codigoCliente) break;

    const supCod = intOrNull(row[2]);
    const vendCod = intOrNull(row[3]);
    if (supCod !== null && !supCodigoToNome.has(supCod)) codigosNaoTraduzidos.sup.add(supCod);
    if (vendCod !== null && !vendCodigoToNome.has(vendCod)) codigosNaoTraduzidos.vend.add(vendCod);

    const out = {
      data_referencia: dataReferencia,
      numero: intOrNull(row[1]),
      supervisor_codigo: supCod,
      supervisor_nome: supCod !== null ? (supCodigoToNome.get(supCod) || null) : null,
      vendedor_codigo: vendCod,
      vendedor_nome: vendCod !== null ? (vendCodigoToNome.get(vendCod) || null) : null,
      pt: strOrNull(row[4]),
      cliente_codigo: codigoCliente,
      fantasia: strOrNull(row[6]) || codigoCliente,
      cidade: strOrNull(row[7]),
      canal: strOrNull(row[8]),
      matriz_nivel: strOrNull(row[9]),
      rota_forms: strOrNull(row[flagsEnd]),
      geladeira_chopeira: strOrNull(row[flagsEnd + 1]),
      cardapio: strOrNull(row[flagsEnd + 2]),
      uniforme: strOrNull(row[flagsEnd + 3]),
      fachada_execucao: strOrNull(row[flagsEnd + 4]),
      contrato_acordo: strOrNull(row[flagsEnd + 5]),
      arquivo_origem: arquivoOrigem,
    };
    for (const f of marcaConfig.flags) out[f.field] = intOrNull(row[f.col]);
    outputRows.push(out);
  }

  return { rows: outputRows, codigosNaoTraduzidos };
}

async function commitDelete(db, tabela, filtros) {
  let q = db.from(tabela).delete();
  for (const [col, val] of Object.entries(filtros)) q = q.eq(col, val);
  const { error } = await q;
  if (error) throw new Error(`Falha ao apagar ${tabela}: ${error.message}`);
}

async function commitInsert(db, tabela, rows) {
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

  if (!args.marca || !MARCAS[args.marca]) {
    console.error(`Uso: node import_executivo.js --marca amstel|volume_futuro --arquivo "<caminho.xlsx>" --data-referencia YYYY-MM-DD [--commit]`);
    process.exit(1);
  }
  if (!args.dataReferencia || !/^\d{4}-\d{2}-\d{2}$/.test(args.dataReferencia) || Number.isNaN(Date.parse(args.dataReferencia))) {
    console.error('Data de referência inválida. Use --data-referencia YYYY-MM-DD.');
    process.exit(1);
  }
  if (!args.arquivo) {
    console.error('Falta --arquivo "<caminho.xlsx>".');
    process.exit(1);
  }

  const marcaConfig = MARCAS[args.marca];
  const arquivoPath = path.resolve(process.cwd(), args.arquivo);
  const arquivoOrigem = path.basename(arquivoPath);

  console.log(`Marca: ${args.marca}`);
  console.log('Lendo', arquivoPath, '...');
  const wb = XLSX.readFile(arquivoPath, { cellDates: true });

  const wsGeral = wb.Sheets['Geral CRK'];
  if (!wsGeral) { console.error('Aba "Geral CRK" não encontrada no arquivo.'); process.exit(1); }
  const rowsGeral = lerPlanilhaAbsoluta(wsGeral);
  const geral = despivotarGeralCRK(rowsGeral, { dataReferencia: args.dataReferencia, marca: args.marca, arquivoOrigem });

  console.log('\n=== Geral CRK -> volumes_futuros_indicadores ===');
  console.log(`Blocos de categoria: ${geral.blocos.map((b) => b.categoria).join(', ')}`);
  console.log(`Vendedores únicos: ${geral.vendCodigoToNome.size}`);
  console.log(`Linhas geradas: ${geral.rows.length}`);
  console.log(`Supervisores identificados no rodapé (de-para): ${[...geral.supCodigoToNome.entries()].map(([c, n]) => `${c}=${n}`).join(', ') || '(nenhum)'}`);

  const wsEstrat = wb.Sheets[marcaConfig.sheetEstrategica];
  let estrat = { rows: [], codigosNaoTraduzidos: { sup: new Set(), vend: new Set() } };
  if (!wsEstrat) {
    console.warn(`⚠ Aba "${marcaConfig.sheetEstrategica}" não encontrada no arquivo — pulando ${marcaConfig.tabelaEstrategica}.`);
  } else {
    const rowsEstrat = lerPlanilhaAbsoluta(wsEstrat);
    estrat = despivotarEstrategica(rowsEstrat, marcaConfig, {
      dataReferencia: args.dataReferencia,
      arquivoOrigem,
      vendCodigoToNome: geral.vendCodigoToNome,
      supCodigoToNome: geral.supCodigoToNome,
    });
    console.log(`\n=== ${marcaConfig.sheetEstrategica} -> ${marcaConfig.tabelaEstrategica} ===`);
    console.log(`PDVs: ${estrat.rows.length}`);
    if (estrat.codigosNaoTraduzidos.sup.size) console.warn(`ATENÇÃO: código(s) de supervisor sem nome encontrado: ${[...estrat.codigosNaoTraduzidos.sup].join(', ')}`);
    if (estrat.codigosNaoTraduzidos.vend.size) console.warn(`ATENÇÃO: código(s) de vendedor sem nome encontrado: ${[...estrat.codigosNaoTraduzidos.vend].join(', ')}`);
  }

  if (geral.rows.length === 0) {
    console.error('\nAbortando: nenhuma linha gerada para Geral CRK. Confira o arquivo antes de continuar.');
    process.exit(1);
  }

  if (process.env.DEBUG_SAMPLE) {
    console.log('\nAmostra Geral CRK:', JSON.stringify(geral.rows.slice(0, 3), null, 2));
    console.log('\nAmostra Estratégica:', JSON.stringify(estrat.rows.slice(0, 3), null, 2));
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

  console.log(`\nApagando linhas existentes de volumes_futuros_indicadores para data_referencia=${args.dataReferencia} e marca=${args.marca}...`);
  await commitDelete(db, 'volumes_futuros_indicadores', { data_referencia: args.dataReferencia, marca: args.marca });
  await commitInsert(db, 'volumes_futuros_indicadores', geral.rows);

  if (estrat.rows.length) {
    console.log(`\nApagando linhas existentes de ${marcaConfig.tabelaEstrategica} para data_referencia=${args.dataReferencia}...`);
    await commitDelete(db, marcaConfig.tabelaEstrategica, { data_referencia: args.dataReferencia });
    await commitInsert(db, marcaConfig.tabelaEstrategica, estrat.rows);
  }

  console.log('\nConcluído.');
}

main().catch((err) => {
  console.error('Falhou:', err.message || err);
  process.exit(1);
});

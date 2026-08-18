// Lê a planilha de incentivo (ex: "Incentivo Caçador Heineken 600ml -
// Acompanhamento.xlsx") e grava a aba "Painel Ganho" na tabela "incentivos"
// do Supabase — mesma lógica de leitura usada pelo botão "Carregar Excel"
// no navegador (readIncentivoFromSheet / parseWorkbook em index.html),
// só que rodando aqui via linha de comando com a service_role key.
//
// Uso:
//   cd scripts
//   node import_incentivo.js --arquivo "../08 - Incentivo Caçador Heineken 600ml - Acompanhamento.xlsx"
//
// Por padrão roda em modo VALIDAÇÃO (dry-run): lê e imprime um resumo, e NÃO
// grava nada no banco. Só grava de verdade com --commit.
//
// Idempotência: ao gravar (--commit), apaga TODAS as linhas de "incentivos"
// antes de inserir de novo — mesmo comportamento do botão "Carregar Excel"
// (substitui tudo, não é por data, já que a tabela não tem data_referencia).

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseArgs(argv) {
  const args = { commit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arquivo') args.arquivo = argv[++i];
    else if (a === '--commit') args.commit = true;
  }
  return args;
}

function normHeader(v) { return String(v || '').trim().toLowerCase(); }

function colLetterToNum(ws, r, c) {
  const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
  const cell = ws[addr];
  return cell ? cell.v : null;
}

function detectColumns(ws, maxRow, maxCol, requiredSynonyms, optionalSynonyms) {
  optionalSynonyms = optionalSynonyms || {};
  for (let r = 1; r <= Math.min(maxRow, 20); r++) {
    const rowVals = [];
    for (let c = 1; c <= maxCol; c++) rowVals.push(normHeader(colLetterToNum(ws, r, c)));
    const cols = {};
    let ok = true;
    for (const key in requiredSynonyms) {
      const idx = rowVals.findIndex((v) => requiredSynonyms[key].includes(v));
      if (idx < 0) { ok = false; break; }
      cols[key] = idx + 1;
    }
    if (!ok) continue;
    for (const key in optionalSynonyms) {
      const idx = rowVals.findIndex((v) => optionalSynonyms[key].includes(v));
      cols[key] = idx >= 0 ? idx + 1 : null;
    }
    return { headerRow: r, cols };
  }
  return null;
}

// Idêntico ao readIncentivoFromSheet de index.html.
function readIncentivoFromSheet(ws) {
  const ref = ws['!ref'];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);
  const maxRow = range.e.r + 1, maxCol = range.e.c + 1;
  const cell = (r, c) => colLetterToNum(ws, r, c);

  let headerRow = null, colSetor = null, colVendedor = null, colPdv = null, colPremio = null, colSup = null;
  for (let r = 1; r <= Math.min(maxRow, 30); r++) {
    const rowVals = [];
    for (let c = 1; c <= maxCol; c++) rowVals.push(normHeader(cell(r, c)));
    const iSetor = rowVals.indexOf('setor');
    const iVend = rowVals.indexOf('vendedor');
    const iPdv = rowVals.findIndex((v) => v === "pdv's" || v === 'pdvs' || v === 'pdv');
    const iPremio = rowVals.findIndex((v) => v === 'premio' || v === 'prêmio');
    if (iSetor >= 0 && iVend >= 0 && iPdv >= 0 && iPremio >= 0) {
      headerRow = r; colSetor = iSetor + 1; colVendedor = iVend + 1; colPdv = iPdv + 1; colPremio = iPremio + 1;
      const iSup = rowVals.indexOf('supervisor');
      colSup = iSup >= 0 ? iSup + 1 : Math.max(1, colSetor - 1);
      break;
    }
  }
  if (!headerRow) return null;

  const vendors = [];
  let lastSup = null;
  let r = headerRow + 1;
  for (; r <= maxRow; r++) {
    const setor = cell(r, colSetor);
    const vend = cell(r, colVendedor);
    if (setor === null && vend === null) break;
    const supHere = cell(r, colSup);
    if (supHere) lastSup = String(supHere).trim();
    if (vend === null || vend === undefined || String(vend).trim() === '') continue;
    vendors.push({
      supervisor: lastSup,
      setor,
      vendedor: String(vend).trim(),
      pdvs: cell(r, colPdv),
      premio: Number(cell(r, colPremio)) || 0,
    });
  }

  let aggHeaderRow = null, colMesa = null, colAggSup = null, colAggPdv = null, colAggPremio = null;
  for (let rr = r; rr <= Math.min(maxRow, r + 15); rr++) {
    const rowVals = [];
    for (let c = 1; c <= maxCol; c++) rowVals.push(normHeader(cell(rr, c)));
    const iMesa = rowVals.indexOf('mesa');
    const iSup2 = rowVals.indexOf('supervisor');
    const iPdv2 = rowVals.findIndex((v) => v === "pdv's" || v === 'pdvs' || v === 'pdv');
    const iPremio2 = rowVals.findIndex((v) => v === 'premio' || v === 'prêmio');
    if (iMesa >= 0 && iSup2 >= 0 && iPdv2 >= 0 && iPremio2 >= 0) {
      aggHeaderRow = rr; colMesa = iMesa + 1; colAggSup = iSup2 + 1; colAggPdv = iPdv2 + 1; colAggPremio = iPremio2 + 1;
      break;
    }
  }
  const aggregate = [];
  if (aggHeaderRow) {
    for (let rr = aggHeaderRow + 1; rr <= maxRow; rr++) {
      const supName = cell(rr, colAggSup);
      if (supName === null || supName === undefined || String(supName).trim() === '') break;
      aggregate.push({
        mesa: cell(rr, colMesa),
        supervisor: String(supName).trim(),
        pdvs: cell(rr, colAggPdv),
        premio: Number(cell(rr, colAggPremio)) || 0,
      });
    }
  }

  if (vendors.length === 0) return null;
  return { vendors, aggregate };
}

// Idêntico ao readNameMapFromSheet de index.html (traduz código -> nome, se a
// planilha tiver uma aba assim; aqui os nomes já vêm por extenso, então na
// prática isso não muda nada, mas mantém o mesmo comportamento do site).
function readNameMapFromSheet(ws, map) {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const maxRow = range.e.r + 1, maxCol = range.e.c + 1;
  const hdr = detectColumns(ws, maxRow, maxCol,
    { colCod: ['codigo', 'código', 'cod'], colNome: ['nome', 'nome real', 'descricao', 'descrição'] }, {});
  if (!hdr) return;
  for (let r = hdr.headerRow + 1; r <= maxRow; r++) {
    const cod = colLetterToNum(ws, r, hdr.cols.colCod);
    const nome = colLetterToNum(ws, r, hdr.cols.colNome);
    if (cod === null || cod === undefined || !nome) continue;
    map.set(String(cod).trim(), String(nome).trim());
  }
}

// Idêntico ao trecho de incentivos dentro de parseWorkbook em index.html.
function montarIncentivos(incentivoBlocks, nameMap) {
  const displayName = (code) => nameMap.get(String(code).trim()) || code;
  const incentivos = [];

  incentivoBlocks.forEach((block) => {
    const bySupervisor = new Map();
    block.vendors.forEach((v) => {
      const supName = v.supervisor || 'SEM SUPERVISOR';
      if (!bySupervisor.has(supName)) bySupervisor.set(supName, []);
      bySupervisor.get(supName).push(v);
    });

    for (const [supName, vendors] of bySupervisor) {
      const supDisplay = displayName(supName);
      const sheetName = 'Fundamentos ' + supName;
      vendors.forEach((v) => {
        incentivos.push({
          supervisor_sheet_name: sheetName,
          supervisor_display_name: supDisplay,
          vendedor_nome: displayName(v.vendedor),
          is_aggregate: false,
          pdvs: v.pdvs,
          premio: v.premio,
        });
      });
    }

    const supNames = [...bySupervisor.keys()];
    block.aggregate.forEach((a, i) => {
      const isLast = i === block.aggregate.length - 1;
      if (isLast) {
        supNames.forEach((supName) => {
          incentivos.push({
            supervisor_sheet_name: 'Fundamentos ' + supName,
            supervisor_display_name: displayName(supName),
            vendedor_nome: 'EMPRESA (total)',
            is_aggregate: true,
            pdvs: a.pdvs,
            premio: a.premio,
          });
        });
        return;
      }
      const norm = (s) => String(s || '').normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').toUpperCase().trim();
      let matchedSupName = supNames.find((supName) => norm(displayName(supName)) === norm(a.supervisor));
      if (!matchedSupName) matchedSupName = a.supervisor;
      incentivos.push({
        supervisor_sheet_name: 'Fundamentos ' + matchedSupName,
        supervisor_display_name: displayName(matchedSupName),
        vendedor_nome: displayName(a.supervisor).toUpperCase() + ' (total)',
        is_aggregate: true,
        pdvs: a.pdvs,
        premio: a.premio,
      });
    });
  });

  return incentivos;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.arquivo) {
    console.error('Uso: node import_incentivo.js --arquivo "<planilha.xlsx>" [--commit]');
    process.exit(1);
  }

  const arquivoPath = path.resolve(process.cwd(), args.arquivo);
  console.log('Lendo', arquivoPath, '...');
  const wb = XLSX.readFile(arquivoPath, { cellDates: true });

  const incentivoBlocks = [];
  const nameMap = new Map();
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const inc = readIncentivoFromSheet(ws);
    if (inc) incentivoBlocks.push({ sheetName, ...inc });
    readNameMapFromSheet(ws, nameMap);
  }

  if (incentivoBlocks.length === 0) {
    console.error('Nenhuma aba reconhecida como "Painel Ganho" (precisa ter colunas Setor/Vendedor/PDV\'s/Premio).');
    process.exit(1);
  }

  const incentivos = montarIncentivos(incentivoBlocks, nameMap);

  console.log(`\nAbas de incentivo encontradas: ${incentivoBlocks.map((b) => b.sheetName).join(', ')}`);
  const porSupervisor = new Map();
  incentivos.forEach((r) => {
    const k = r.supervisor_sheet_name;
    if (!porSupervisor.has(k)) porSupervisor.set(k, { vendedores: 0, agregados: 0 });
    const e = porSupervisor.get(k);
    if (r.is_aggregate) e.agregados++; else e.vendedores++;
  });
  console.log(`Total de linhas geradas: ${incentivos.length}`);
  for (const [sup, e] of porSupervisor) {
    console.log(`  - ${sup}: ${e.vendedores} vendedor(es), ${e.agregados} linha(s) de total`);
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

  console.log('\nApagando linhas existentes de incentivos...');
  const { error: delErr } = await db.from('incentivos').delete().gt('id', 0);
  if (delErr) throw new Error(`Falha ao apagar incentivos: ${delErr.message}`);

  const { error: insErr } = await db.from('incentivos').insert(incentivos);
  if (insErr) throw new Error(`Falha ao inserir incentivos: ${insErr.message}`);

  console.log(`incentivos: ${incentivos.length}/${incentivos.length} linhas gravadas.`);
  console.log('\nConcluído.');
}

main().catch((err) => {
  console.error('Falhou:', err.message || err);
  process.exit(1);
});

// Lê a planilha "Base clientes sem compra" (aba "Clientes sem Compra") e
// grava em clientes_sem_compra. Os vendedores vêm identificados por código
// (colunas SUP/VD) — o script resolve pro nome automaticamente, consultando
// volume_indicadores (VD = mesmo "setor" das tabelas de indicadores).
//
// Uso:
//   cd scripts
//   node import_clientes_sem_compra.js --arquivo "../07 - Base clientes sem compra julho.xlsx" --data-referencia 2026-07-01
//   (confira o resumo; rode de novo com --commit pra gravar de verdade)
//
// Idempotência: --commit apaga antes todas as linhas da mesma data_referencia
// e insere o conjunto novo — rodar o mesmo arquivo duas vezes não duplica.

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = 500;
const SHEET_NAME = 'Clientes sem Compra';

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

function strOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function intOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
  return Number.isNaN(n) ? null : n;
}

// Monta setor -> {vendedor, supervisor} a partir de volume_indicadores. Em
// caso de o mesmo setor aparecer em datas diferentes, fica com a mais recente.
async function buildSetorLookup(db) {
  const { data, error } = await db.from('volume_indicadores')
    .select('setor,vendedor,supervisor,data_referencia')
    .order('data_referencia', { ascending: false });
  if (error) throw new Error('Falha ao ler volume_indicadores pra montar o de-para de código: ' + error.message);
  const lookup = new Map();
  for (const r of data || []) {
    if (!lookup.has(r.setor)) lookup.set(r.setor, { vendedor: r.vendedor, supervisor: r.supervisor });
  }
  return lookup;
}

function despivotarPlanilha(rows, { dataReferencia, arquivoOrigem, lookup }) {
  const header = (rows[0] || []).map(h => String(h || '').trim().toLowerCase());
  const idx = {
    sup: header.indexOf('sup'),
    vd: header.indexOf('vd'),
    pasta: header.indexOf('pasta'),
    cod: header.indexOf('cod'),
    fantasia: header.indexOf('fantasia'),
    razao: header.indexOf('razao social'),
    canal: header.indexOf('desc.canal'),
    municipio: header.indexOf('municipio'),
    dias: header.findIndex(h => h.startsWith('dias sem compra')),
  };
  const faltando = Object.entries(idx).filter(([, v]) => v < 0).map(([k]) => k);
  if (faltando.length) {
    throw new Error('Colunas não encontradas na planilha (verifique o cabeçalho da linha 1): ' + faltando.join(', '));
  }

  const outputRows = [];
  const stats = { totalLinhas: 0, resolvidos: 0, naoResolvidos: 0, setoresNaoResolvidos: new Set(), linhasSemFantasia: 0 };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const fantasia = strOrNull(row[idx.fantasia]);
    if (!fantasia) { stats.linhasSemFantasia++; continue; }

    const setor = strOrNull(row[idx.vd]);
    const match = setor ? lookup.get(setor) : null;
    if (match) stats.resolvidos++;
    else { stats.naoResolvidos++; if (setor) stats.setoresNaoResolvidos.add(setor); }

    outputRows.push({
      data_referencia: dataReferencia,
      supervisor: match ? match.supervisor : null,
      vendedor: match ? match.vendedor : null,
      setor: setor || String(row[idx.vd] ?? ''),
      codigo: strOrNull(row[idx.cod]),
      pasta: strOrNull(row[idx.pasta]),
      fantasia,
      razao_social: strOrNull(row[idx.razao]),
      canal: strOrNull(row[idx.canal]),
      municipio: strOrNull(row[idx.municipio]),
      dias_sem_comprar: intOrNull(row[idx.dias]),
      arquivo_origem: arquivoOrigem,
    });
    stats.totalLinhas++;
  }

  return { rows: outputRows, stats };
}

function imprimirResumo(resultado) {
  const { stats } = resultado;
  console.log('\n=== Clientes sem Compra ===');
  console.log(`Linhas válidas: ${stats.totalLinhas} (${stats.linhasSemFantasia} ignoradas por não ter Fantasia)`);
  console.log(`Vendedor resolvido por código: ${stats.resolvidos} | não resolvido: ${stats.naoResolvidos}`);
  if (stats.setoresNaoResolvidos.size) {
    console.log(`Códigos (VD) sem correspondência em volume_indicadores: ${[...stats.setoresNaoResolvidos].sort().join(', ')}`);
    console.log('(essas linhas ficam com supervisor/vendedor em branco — só admin vai ver elas)');
  }
  const porSupervisor = new Map();
  resultado.rows.forEach(r => {
    const key = r.supervisor || '(sem supervisor)';
    porSupervisor.set(key, (porSupervisor.get(key) || 0) + 1);
  });
  console.log('Linhas por supervisor:');
  [...porSupervisor.entries()].sort((a, b) => b[1] - a[1]).forEach(([sup, n]) => console.log(`  - ${sup}: ${n}`));
}

async function commitTabela(db, rows, dataReferencia) {
  console.log(`\nApagando linhas existentes de clientes_sem_compra para data_referencia=${dataReferencia}...`);
  const { error: delErr } = await db.from('clientes_sem_compra').delete().eq('data_referencia', dataReferencia);
  if (delErr) throw new Error(`Falha ao apagar: ${delErr.message}`);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await db.from('clientes_sem_compra').insert(batch);
    if (error) throw new Error(`Falha ao inserir lote: ${error.message}`);
    inserted += batch.length;
    console.log(`  clientes_sem_compra: ${inserted}/${rows.length} linhas gravadas.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.dataReferencia || !/^\d{4}-\d{2}-\d{2}$/.test(args.dataReferencia) || Number.isNaN(Date.parse(args.dataReferencia))) {
    console.error('Uso: node import_clientes_sem_compra.js --arquivo "<caminho.xlsx>" --data-referencia YYYY-MM-DD [--commit]');
    process.exit(1);
  }
  if (!args.arquivo) {
    console.error('Uso: node import_clientes_sem_compra.js --arquivo "<caminho.xlsx>" --data-referencia YYYY-MM-DD [--commit]');
    process.exit(1);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env (veja .env.example).');
    process.exit(1);
  }

  const arquivoPath = path.resolve(process.cwd(), args.arquivo);
  const arquivoOrigem = path.basename(arquivoPath);
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  console.log('Lendo', arquivoPath, '...');
  const wb = XLSX.readFile(arquivoPath, { cellDates: true });
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) {
    console.error(`Aba "${SHEET_NAME}" não encontrada no arquivo. Abas disponíveis: ${wb.SheetNames.join(', ')}`);
    process.exit(1);
  }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  console.log('Montando de-para de código de vendedor (setor) a partir de volume_indicadores...');
  const lookup = await buildSetorLookup(db);
  console.log(`${lookup.size} código(s) de vendedor conhecido(s).`);

  const resultado = despivotarPlanilha(rows, { dataReferencia: args.dataReferencia, arquivoOrigem, lookup });
  imprimirResumo(resultado);

  if (resultado.rows.length === 0) {
    console.error('\nAbortando: nenhuma linha gerada. Confira o arquivo antes de continuar.');
    process.exit(1);
  }

  if (!args.commit) {
    console.log('\n--- Modo validação (dry-run): nada foi gravado no Supabase. ---');
    console.log('Confira o resumo acima. Se bateu com o esperado, rode de novo com --commit pra gravar de verdade.');
    return;
  }

  await commitTabela(db, resultado.rows, args.dataReferencia);
  console.log('\nConcluído.');
}

main().catch((err) => {
  console.error('Falhou:', err.message || err);
  process.exit(1);
});

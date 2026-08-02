// Lê Base Clientes.xlsx e faz upsert em massa na tabela "clientes" do Supabase.
//
// Uso:
//   cd scripts
//   npm install
//   copy .env.example .env   (e preencha SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)
//   npm run import
//
// Pode rodar de novo sempre que a planilha for atualizada: o upsert é feito
// por "codigo" (coluna "Cód" da planilha), então clientes existentes só são
// atualizados, e clientes novos são inseridos. Nada é apagado.

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const XLSX_PATH = path.resolve(__dirname, process.env.XLSX_PATH || '../Base Clientes.xlsx');
const BATCH_SIZE = 500;

const DIA_VISITA_CONHECIDOS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

function normalizeDiaVisita(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const clean = String(raw)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .toUpperCase()
    .replace(/[^A-Z]/g, ''); // só letras
  const prefix = clean.slice(0, 3);
  return DIA_VISITA_CONHECIDOS.includes(prefix) ? prefix : (clean || null);
}

function parseIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function strOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env (veja .env.example).');
    process.exit(1);
  }

  console.log('Lendo', XLSX_PATH, '...');
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
  console.log(`${rawRows.length} linhas encontradas na aba "${sheetName}".`);

  const rows = [];
  const skipped = [];
  for (const r of rawRows) {
    const codigo = strOrNull(r['Cód']);
    const fantasia = strOrNull(r['Fantasia']);
    const vendedorCodigo = parseIntOrNull(r['Cod. Vend']);
    const vendedorNome = strOrNull(r['Vendedor']);
    const supervisorNome = strOrNull(r['Supervisor']);
    if (!codigo || !fantasia || vendedorCodigo === null || !vendedorNome || !supervisorNome) {
      skipped.push(r);
      continue;
    }
    rows.push({
      codigo,
      fantasia,
      cidade: strOrNull(r['Cidade']),
      canal: strOrNull(r['Canal']),
      pasta_cli: parseIntOrNull(r['Pasta Cli (Cód)']),
      dia_visita: normalizeDiaVisita(r['Dia Visita']),
      vendedor_codigo: vendedorCodigo,
      vendedor_nome: vendedorNome,
      supervisor_codigo: parseIntOrNull(r['Cod. Sup']),
      supervisor_nome: supervisorNome,
      updated_at: new Date().toISOString(),
    });
  }

  if (skipped.length) {
    console.warn(`${skipped.length} linha(s) ignorada(s) por falta de código/fantasia/vendedor/supervisor.`);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  return runBatches(db, rows);
}

async function runBatches(db, rows) {
  let upserted = 0;
  let errors = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await db.from('clientes').upsert(batch, { onConflict: 'codigo' });
    if (error) {
      errors += batch.length;
      console.error(`Lote ${i / BATCH_SIZE + 1}: erro ao gravar ${batch.length} linhas ->`, error.message);
    } else {
      upserted += batch.length;
      console.log(`Lote ${i / BATCH_SIZE + 1}: ${batch.length} linhas ok (${upserted}/${rows.length}).`);
    }
  }
  console.log('---');
  console.log(`Concluído: ${upserted} linhas gravadas, ${errors} com erro.`);
  if (errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Falhou:', err.message || err);
  process.exit(1);
});

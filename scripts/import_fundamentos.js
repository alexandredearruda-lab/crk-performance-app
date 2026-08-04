// Lê a planilha mensal "Fundamentos Comissão e Produtividade" (.xlsm) e faz o
// despivot das abas Volume, Coberturas e HEISHOP - ACOMP VENDAS pras tabelas
// volume_indicadores / cobertura_indicadores / heishop_indicadores no Supabase.
//
// Uso:
//   cd scripts
//   npm install
//   copy .env.example .env   (mesmas SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY do import_clientes.js)
//   node import_fundamentos.js --arquivo "../07 - Fundamentos Comissão e Produtividade - Julho.xlsm" --data-referencia 2026-07-01
//
// Por padrão roda em modo VALIDAÇÃO (dry-run): lê e despivota tudo, imprime um
// resumo, e NÃO grava nada no banco. Só grava de verdade quando você confere o
// resumo e roda de novo com --commit.
//
// Idempotência: ao gravar (--commit), o script apaga antes todas as linhas já
// existentes com a mesma data_referencia em cada tabela, e insere o conjunto
// novo. Rodar o mesmo arquivo duas vezes não duplica nada.
//
// A "Data:" de cada aba na planilha é uma fórmula (=TODAY()) e sempre mostra a
// data de hoje, não o mês real do arquivo — por isso data_referencia é sempre
// passada explicitamente por linha de comando, nunca lida da planilha.

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = 500;
const PRIMEIRA_COLUNA_BLOCO = 5; // coluna F (0-based: A=0)

const FIELD_DEFS = {
  padrao: [
    ['meta', 'num'],
    ['real', 'num'],
    ['percentual', 'num'],
    ['necessidade_dia', 'num'],
  ],
  faturamento_pedido: [
    ['fat_total', 'num'],
    ['fat_heishop', 'num'],
    ['percentual', 'num'],
    ['pedidos_heishop', 'int'],
  ],
  devolucao: [
    ['dev_faturamento', 'num'],
    ['dev_x_fat', 'num'],
  ],
};

const HEISHOP_CAMPOS_OPCIONAIS = [
  'meta', 'real', 'percentual', 'necessidade_dia',
  'fat_total', 'fat_heishop', 'pedidos_heishop',
  'dev_faturamento', 'dev_x_fat',
];

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

// Varre a linha de "tipo" (Meta/Real/%/Necessidade Dia, ou os rótulos
// especiais do HEISHOP) a partir da coluna F e identifica onde cada bloco de
// categoria começa. Não depende de saber quantos blocos existem de antemão —
// funciona pra 13 blocos (Volume), 22 (Coberturas) ou 7 heterogêneos (HEISHOP).
function detectarBlocos(linhaTipo) {
  const rotulosInicio = new Set(['meta', 'obj base abr', 'fat. total', 'dev. faturamento']);
  const blocos = [];
  let col = PRIMEIRA_COLUNA_BLOCO;
  const maxCol = linhaTipo.length;
  while (col < maxCol) {
    const raw = linhaTipo[col];
    if (raw === null || raw === undefined) { col++; continue; }
    const norm = String(raw).trim().toLowerCase();
    if (!rotulosInicio.has(norm)) { col++; continue; }
    const width = norm === 'dev. faturamento' ? 2 : 4;
    blocos.push({ startCol: col, tipoRotulo: norm, width });
    col += width;
  }
  return blocos;
}

function tipoBlocoDe(tipoRotulo) {
  if (tipoRotulo === 'fat. total') return 'faturamento_pedido';
  if (tipoRotulo === 'dev. faturamento') return 'devolucao';
  return 'padrao'; // 'meta' ou o sinônimo 'obj base abr'
}

// Lê o despivot de uma aba. `hetero=true` (HEISHOP) grava tipo_bloco e todos
// os campos opcionais (nulados quando não se aplicam); `hetero=false`
// (Volume/Coberturas) grava só meta/real/percentual/necessidade_dia.
function despivotarAba(rows, { dataReferencia, arquivoOrigem, hetero }) {
  const diasUteisVenda = intOrNull(rows[2] && rows[2][2]);
  const diasTrabalhados = intOrNull(rows[3] && rows[3][2]);
  const diasFaltantes = intOrNull(rows[4] && rows[4][2]);

  const linhaCategoriaCurta = rows[8] || [];
  const linhaCategoriaLonga = rows[9] || [];
  const linhaTipo = rows[10] || [];

  const blocos = detectarBlocos(linhaTipo).map((b, i) => {
    const tipoBloco = tipoBlocoDe(b.tipoRotulo);
    const curta = strOrNull(linhaCategoriaCurta[b.startCol + 1]);
    const longa = strOrNull(linhaCategoriaLonga[b.startCol]);
    let categoria;
    let categoriaDescricao;
    if (tipoBloco === 'devolucao') {
      // A planilha não dá nome de categoria pra esse bloco (confirmado com o
      // usuário) — usa rótulo fixo.
      categoria = 'DEVOLUCAO';
      categoriaDescricao = null;
    } else if (hetero && i > 0) {
      // Na aba HEISHOP, a linha de "nome curto" (row9) é resíduo copiado
      // célula a célula da aba Coberturas a partir do 2º bloco em diante
      // (confirmado: valores idênticos nas mesmas colunas nas duas abas,
      // mas sem relação com os blocos reais do HEISHOP a partir daqui). Só o
      // 1º bloco ("rgb mainstream") usa o nome curto de verdade.
      categoria = longa || curta;
      categoriaDescricao = longa;
    } else {
      categoria = curta || longa;
      categoriaDescricao = longa;
    }
    return { ...b, ordemBloco: i + 1, tipoBloco, categoria, categoriaDescricao };
  });

  const outputRows = [];
  const stats = {
    totalLinhasVendedor: 0,
    vendedores: new Set(),
    excluidos: { balcao: 0, crk: 0, supervisorSubtotal: 0 },
    linhasComTudoNulo: 0,
    categorias: new Map(), // "categoria (bloco N)" -> contagem de linhas
  };

  let supervisorAtual = null;
  const supervisoresConhecidos = new Set();

  for (let r = 11; r < rows.length; r++) { // linha 12 da planilha = índice 11
    const row = rows[r];
    const setorRaw = row[2];
    const vendedorRaw = row[3];
    const setorVazio = setorRaw === null || setorRaw === undefined || String(setorRaw).trim() === '';
    const vendedorVazio = vendedorRaw === null || vendedorRaw === undefined || String(vendedorRaw).trim() === '';

    if (setorVazio && vendedorVazio) break; // primeira linha totalmente vazia: fim do bloco de vendedores

    if (row[1] !== null && row[1] !== undefined && String(row[1]).trim() !== '') {
      supervisorAtual = String(row[1]).trim();
      supervisoresConhecidos.add(supervisorAtual.toUpperCase());
    }

    const vendedor = vendedorVazio ? null : String(vendedorRaw).trim();
    const vendedorUpper = vendedor ? vendedor.toUpperCase() : '';

    if (vendedorUpper === 'BALCÃO' || vendedorUpper === 'BALCAO') { stats.excluidos.balcao++; continue; }
    if (vendedorUpper === 'CRK') { stats.excluidos.crk++; continue; }
    if (vendedor && supervisoresConhecidos.has(vendedorUpper)) { stats.excluidos.supervisorSubtotal++; continue; }

    stats.totalLinhasVendedor++;
    stats.vendedores.add(vendedor);

    const setor = setorVazio ? null : String(setorRaw).trim();
    const pdvs = intOrNull(row[4]);

    for (const b of blocos) {
      const campos = FIELD_DEFS[b.tipoBloco];
      const valores = campos.map(([, tipo], i) => {
        const raw = row[b.startCol + i];
        return tipo === 'int' ? intOrNull(raw) : numOrNull(raw);
      });
      if (valores.every((v) => v === null)) stats.linhasComTudoNulo++;

      const linha = {
        data_referencia: dataReferencia,
        dias_uteis_venda: diasUteisVenda,
        dias_trabalhados: diasTrabalhados,
        dias_faltantes: diasFaltantes,
        supervisor: supervisorAtual,
        setor,
        vendedor,
        pdvs,
        categoria: b.categoria,
        categoria_descricao: b.categoriaDescricao,
        ordem_bloco: b.ordemBloco,
        arquivo_origem: arquivoOrigem,
      };

      if (hetero) {
        linha.tipo_bloco = b.tipoBloco;
        for (const campo of HEISHOP_CAMPOS_OPCIONAIS) linha[campo] = null;
      }
      campos.forEach(([nome], i) => { linha[nome] = valores[i]; });

      outputRows.push(linha);

      const chave = `${b.categoria} (bloco ${b.ordemBloco})`;
      stats.categorias.set(chave, (stats.categorias.get(chave) || 0) + 1);
    }
  }

  return { rows: outputRows, stats, blocos };
}

function imprimirResumo(nomeAba, tabela, resultado) {
  const { stats, blocos } = resultado;
  console.log(`\n=== ${nomeAba} -> ${tabela} ===`);
  console.log(`Blocos de categoria detectados: ${blocos.length}`);
  console.log(`Linhas de vendedor válidas: ${stats.totalLinhasVendedor}`);
  console.log(`Vendedores únicos: ${stats.vendedores.size}`);
  console.log(`Linhas geradas (vendedor x bloco): ${resultado.rows.length}`);
  console.log(`Excluídos -> BALCÃO/TELEVENDAS: ${stats.excluidos.balcao}, CRK: ${stats.excluidos.crk}, subtotal de supervisor: ${stats.excluidos.supervisorSubtotal}`);
  if (stats.linhasComTudoNulo > 0) {
    console.warn(`ATENÇÃO: ${stats.linhasComTudoNulo} linha(s) com todos os valores numéricos nulos (possível desalinhamento de coluna).`);
  }
  console.log('Categorias encontradas:');
  for (const [cat, count] of stats.categorias) {
    console.log(`  - ${cat}: ${count} linha(s)`);
  }
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
    console.error('Uso: node import_fundamentos.js --arquivo "<caminho.xlsm>" --data-referencia YYYY-MM-DD [--commit]');
    console.error('--data-referencia é obrigatório (a célula "Data:" da planilha é uma fórmula TODAY(), não dá pra usar ela).');
    process.exit(1);
  }
  if (!args.arquivo) {
    console.error('Uso: node import_fundamentos.js --arquivo "<caminho.xlsm>" --data-referencia YYYY-MM-DD [--commit]');
    process.exit(1);
  }

  const arquivoPath = path.resolve(process.cwd(), args.arquivo);
  const arquivoOrigem = path.basename(arquivoPath);

  console.log('Lendo', arquivoPath, '...');
  const wb = XLSX.readFile(arquivoPath, { cellDates: true });

  const ABAS = [
    { nome: 'Volume', tabela: 'volume_indicadores', hetero: false },
    { nome: 'Coberturas', tabela: 'cobertura_indicadores', hetero: false },
    { nome: 'HEISHOP - ACOMP VENDAS', tabela: 'heishop_indicadores', hetero: true },
  ];

  const resultados = [];
  for (const aba of ABAS) {
    const ws = wb.Sheets[aba.nome];
    if (!ws) {
      console.error(`Aba "${aba.nome}" não encontrada no arquivo.`);
      process.exit(1);
    }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const resultado = despivotarAba(rows, {
      dataReferencia: args.dataReferencia,
      arquivoOrigem,
      hetero: aba.hetero,
    });
    resultados.push({ ...aba, resultado });
    imprimirResumo(aba.nome, aba.tabela, resultado);
  }

  const semLinhas = resultados.filter((r) => r.resultado.rows.length === 0);
  if (semLinhas.length > 0) {
    console.error(`\nAbortando: nenhuma linha gerada para ${semLinhas.map((r) => r.nome).join(', ')}. Confira o arquivo antes de continuar.`);
    process.exit(1);
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
    await commitTabela(db, r.tabela, r.resultado.rows, args.dataReferencia);
  }
  console.log('\nConcluído.');
}

main().catch((err) => {
  console.error('Falhou:', err.message || err);
  process.exit(1);
});

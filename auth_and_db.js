/* =====================================================================
   CONFIGURAÇÃO — preencha com os dados do seu projeto Supabase
   (Supabase -> Project Settings -> API)
===================================================================== */
const SUPABASE_URL = 'https://fjfzeedzuzjcxpvxebjf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqZnplZWR6dXpqY3hwdnhlYmpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5ODk1NjIsImV4cCI6MjEwMDU2NTU2Mn0.vfLkBg-r6NuAXBgNcDjWyzQKVI34zVAJafTBjYkp7qQ';

let db = null;
let CURRENT_USER = null;
let CURRENT_ROLE = null;          // 'admin' | 'supervisor' | 'vendedor'
let CURRENT_SUP_SHEET = null;     // preenchido para supervisor e vendedor
let CURRENT_VENDEDOR_NOME = null; // preenchido só para vendedor
let CLIENTS = [];                 // lista de clientes sem comprar (já filtrada pelas permissões)
function todayStr(){
  return new Date().toISOString().slice(0,10); // AAAA-MM-DD
}

let COMMITMENTS = [];             // necessidade do dia definida pelos supervisores
let INCENTIVOS = [];               // prêmio/incentivo (aba "Painel Ganho")
let CLIENTES_MASTER = [];          // base de clientes importada de Base_Clientes.xlsx
let NECESSIDADE_DIA_ROWS = [];     // linhas de necessidade_dia do vendedor+dia selecionados no momento
let NECESSIDADE_SEMANA_ROWS = [];  // linhas de necessidade_dia da semana atual inteira (Seg-Sex), pro resumo
function canEditNecessidade(supervisorNome, vendedorNome){
  if(CURRENT_ROLE === 'admin') return true;
  if(CURRENT_ROLE === 'supervisor') return CURRENT_SUP_SHEET === 'Fundamentos ' + supervisorNome;
  if(CURRENT_ROLE === 'vendedor') return CURRENT_VENDEDOR_NOME === vendedorNome;
  return false;
}
let REALTIME_CHANNEL = null;
let NECESSIDADE_REALTIME_CHANNEL = null;
const POLL_FALLBACK_MS = 25000;

function isConfigured(){
  return SUPABASE_URL && !SUPABASE_URL.includes('COLE_AQUI') &&
         SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes('COLE_AQUI');
}

function showStatus(msg, isError){
  const bar = document.getElementById('diag-bar');
  if(!msg){ bar.style.display='none'; return; }
  bar.style.display = 'block';
  bar.style.background = isError ? '#fdf2ef' : '#eef6f0';
  bar.style.color = isError ? '#8a3a2a' : '#2e5d40';
  bar.style.borderBottomColor = isError ? '#e8c9c0' : '#c8e0cf';
  bar.textContent = msg;
}

function showLoginError(msg){
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

/* =====================================================================
   INICIALIZAÇÃO / LOGIN
===================================================================== */
async function initApp(){
  if(!isConfigured()){
    document.getElementById('login-config-warning').style.display = 'block';
    document.getElementById('login-form').style.display = 'none';
    return;
  }
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: { session } } = await db.auth.getSession();
  if(session && session.user){
    await onLoggedIn(session.user);
  }

  document.getElementById('login-form').addEventListener('submit', handleLoginSubmit);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
}

async function handleLoginSubmit(e){
  e.preventDefault();
  showLoginError('');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const submitBtn = document.getElementById('login-submit');
  submitBtn.disabled = true; submitBtn.textContent = 'Entrando…';
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  submitBtn.disabled = false; submitBtn.textContent = 'Entrar';
  if(error){ showLoginError('Não foi possível entrar: ' + error.message); return; }
  await onLoggedIn(data.user);
}

async function handleLogout(){
  if(REALTIME_CHANNEL) db.removeChannel(REALTIME_CHANNEL);
  if(NECESSIDADE_REALTIME_CHANNEL) db.removeChannel(NECESSIDADE_REALTIME_CHANNEL);
  await db.auth.signOut();
  location.reload();
}

async function onLoggedIn(user){
  CURRENT_USER = user;
  const { data: profile, error } = await db.from('profiles').select('*').eq('id', user.id).single();
  if(error || !profile){
    showLoginError('Login ok, mas este usuário ainda não tem perfil cadastrado. Peça para o administrador te cadastrar na tabela "profiles".');
    await db.auth.signOut();
    return;
  }
  CURRENT_ROLE = profile.role;
  CURRENT_SUP_SHEET = profile.supervisor_sheet_name;
  CURRENT_VENDEDOR_NOME = profile.vendedor_nome;

  const roleLabel = { admin:'administrador', supervisor:'supervisor', vendedor:'vendedor' }[CURRENT_ROLE] || CURRENT_ROLE;

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('user-badge').textContent = (profile.display_name || user.email) + ' · ' + roleLabel;
  document.getElementById('upload-controls').style.display = CURRENT_ROLE === 'admin' ? 'flex' : 'none';

  await loadDataFromDB();
  subscribeRealtime();
  setInterval(loadDataFromDB, POLL_FALLBACK_MS); // reforço, caso o realtime falhe
}

/* =====================================================================
   O Supabase limita cada consulta a 1000 linhas por padrão — pra tabelas
   maiores (ex: clientes, com 5000+ linhas) é preciso paginar com .range().
===================================================================== */
const SUPABASE_PAGE_SIZE = 1000;
async function fetchAllRows(table, queryBuilder){
  let all = [];
  let start = 0;
  while(true){
    let q = db.from(table).select('*');
    if(queryBuilder) q = queryBuilder(q);
    const { data, error } = await q.range(start, start + SUPABASE_PAGE_SIZE - 1);
    if(error) throw error;
    all = all.concat(data || []);
    if(!data || data.length < SUPABASE_PAGE_SIZE) break;
    start += SUPABASE_PAGE_SIZE;
  }
  return all;
}

/* =====================================================================
   LEITURA DOS DADOS (o banco já filtra pelo papel de cada um via RLS —
   admin vê tudo, supervisor vê o time dele, vendedor vê só a própria linha
   + os totais de comparação)
===================================================================== */
async function loadDataFromDB(){
  try{
    const { data: metaRow } = await db.from('meta').select('*').eq('id', 1).maybeSingle();
    const { data: vsRows, error: e1 } = await db.from('vendor_snapshots').select('*');
    if(e1) throw e1;
    const { data: clientRows, error: e2 } = await db.from('client_watchlist').select('*');
    if(e2) throw e2;
    let commitRows = [];
    try{
      const { data: cRows } = await db.from('daily_commitments').select('*').eq('data', todayStr());
      commitRows = cRows || [];
    }catch(e){ /* tabela pode não existir ainda — segue sem o recurso */ }
    let incentivoRows = [];
    try{
      const { data: iRows } = await db.from('incentivos').select('*');
      incentivoRows = iRows || [];
    }catch(e){ /* tabela pode não existir ainda — segue sem o recurso */ }
    let clienteRows = [];
    try{
      clienteRows = await fetchAllRows('clientes');
    }catch(e){ /* tabela pode não existir ainda — segue sem o recurso */ }
    let necessidadeSemanaRows = [];
    try{
      const monday = mondayOfCurrentWeek();
      const friday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 4);
      const mondayStr = monday.toISOString().slice(0,10);
      const fridayStr = friday.toISOString().slice(0,10);
      necessidadeSemanaRows = await fetchAllRows('necessidade_dia', q => q.gte('data', mondayStr).lte('data', fridayStr));
    }catch(e){ /* tabela pode não existir ainda — segue sem o recurso */ }

    const supervisors = reconstructSupervisors(vsRows || []);

    if(supervisors.length === 0){
      if(DATA){
        // provavelmente um instante passageiro no meio de um novo upload
        // (a planilha antiga já foi apagada, a nova ainda está sendo gravada).
        // Mantém a tela como está em vez de piscar "sem dados".
        return;
      }
      DATA = null;
      CLIENTS = [];
      showStatus(CURRENT_ROLE === 'admin'
        ? 'ℹ Nenhum dado ainda. Carregue o Excel do dia.'
        : 'ℹ O administrador ainda não carregou os dados de hoje.', false);
      render();
      return;
    }
    showStatus('', false);
    DATA = { meta: metaRow ? metaRow.payload : {}, supervisors };
    CLIENTS = clientRows || [];
    COMMITMENTS = commitRows;
    INCENTIVOS = incentivoRows;
    CLIENTES_MASTER = clienteRows;
    NECESSIDADE_SEMANA_ROWS = necessidadeSemanaRows;
    const SPECIAL_VIEWS = ['OVERVIEW','COMMITMENTS','INCENTIVO'];
    if(!ACTIVE_SUP || (!SPECIAL_VIEWS.includes(ACTIVE_SUP) && !DATA.supervisors.find(s => s.sheetName === ACTIVE_SUP))){
      ACTIVE_SUP = DATA.supervisors[0].sheetName;
    }
    render();
  }catch(e){
    console.error(e);
    showStatus('✗ Erro ao carregar dados: ' + (e.message || e), true);
  }
}

let REALTIME_DEBOUNCE_TIMER = null;
function scheduleReload(){
  // um upload gera várias mudanças na tabela em sequência (apaga tudo, insere
  // linha por linha) — espera tudo se acalmar antes de recarregar, pra não
  // recarregar a tela dezenas de vezes seguidas.
  clearTimeout(REALTIME_DEBOUNCE_TIMER);
  REALTIME_DEBOUNCE_TIMER = setTimeout(loadDataFromDB, 900);
}

function subscribeRealtime(){
  REALTIME_CHANNEL = db.channel('painel-mudancas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_snapshots' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'client_watchlist' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_commitments' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'incentivos' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meta' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, scheduleReload)
    .subscribe();
}

/* =====================================================================
   NECESSIDADE DO DIA POR CLIENTE — editável pelo admin, pelo supervisor do
   time e pelo próprio vendedor. Busca sob demanda (só quando um vendedor +
   dia é selecionado) e salva ao sair do campo.
===================================================================== */
async function loadNecessidadeDia(vendedorCodigo, dataStr){
  try{
    const { data, error } = await db.from('necessidade_dia').select('*')
      .eq('vendedor_codigo', vendedorCodigo).eq('data', dataStr);
    if(error) throw error;
    NECESSIDADE_DIA_ROWS = data || [];
  }catch(e){
    console.error(e);
    NECESSIDADE_DIA_ROWS = [];
    showStatus('✗ Não foi possível carregar a necessidade do dia: ' + (e.message || e) + '. Se a tabela ainda não existe, rode o arquivo schema_clientes_necessidade.sql no Supabase.', true);
  }
  render();
}

async function saveNecessidadeField(clienteId, vendedorCodigo, supervisorNome, vendedorNome, dataStr, field, valor){
  if(!canEditNecessidade(supervisorNome, vendedorNome)) return;
  if(field !== 'valor_desafio' && field !== 'valor_real') return;
  const num = valor === '' ? null : Number(String(valor).replace(',', '.'));
  if(valor !== '' && isNaN(num)) return;
  try{
    const payload = {
      vendedor_codigo: vendedorCodigo,
      cliente_id: clienteId,
      data: dataStr,
      updated_at: new Date().toISOString(),
      updated_by: CURRENT_USER.id
    };
    payload[field] = num;
    const existing = NECESSIDADE_DIA_ROWS.find(r => r.cliente_id === clienteId && r.vendedor_codigo === vendedorCodigo && r.data === dataStr);
    if(existing){
      const other = field === 'valor_desafio' ? 'valor_real' : 'valor_desafio';
      if(existing[other] !== null && existing[other] !== undefined) payload[other] = existing[other];
    }
    const { error } = await db.from('necessidade_dia').upsert(payload, { onConflict: 'vendedor_codigo,cliente_id,data' });
    if(error) throw error;
    if(existing) existing[field] = num;
    else NECESSIDADE_DIA_ROWS.push({ vendedor_codigo: vendedorCodigo, cliente_id: clienteId, data: dataStr, valor_desafio: field==='valor_desafio'?num:null, valor_real: field==='valor_real'?num:null });
    // espelha a mudança no cache da semana (resumo), pra atualizar na hora sem esperar o polling
    const existingSemana = NECESSIDADE_SEMANA_ROWS.find(r => r.cliente_id === clienteId && r.vendedor_codigo === vendedorCodigo && r.data === dataStr);
    if(existingSemana) existingSemana[field] = num;
    else NECESSIDADE_SEMANA_ROWS.push({ vendedor_codigo: vendedorCodigo, cliente_id: clienteId, data: dataStr, valor_desafio: field==='valor_desafio'?num:null, valor_real: field==='valor_real'?num:null });
    render();
  }catch(e){
    console.error(e);
    showStatus('✗ Não foi possível salvar: ' + (e.message || e) + '. Se a tabela ainda não existe, rode o arquivo schema_clientes_necessidade.sql no Supabase.', true);
  }
}

let NECESSIDADE_RELOAD_TIMER = null;
function subscribeNecessidadeRealtime(vendedorCodigo, dataStr){
  if(NECESSIDADE_REALTIME_CHANNEL){ db.removeChannel(NECESSIDADE_REALTIME_CHANNEL); NECESSIDADE_REALTIME_CHANNEL = null; }
  NECESSIDADE_REALTIME_CHANNEL = db.channel('necessidade-dia-' + vendedorCodigo + '-' + dataStr)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'necessidade_dia',
      filter: 'vendedor_codigo=eq.' + vendedorCodigo
    }, () => {
      clearTimeout(NECESSIDADE_RELOAD_TIMER);
      NECESSIDADE_RELOAD_TIMER = setTimeout(() => loadNecessidadeDia(vendedorCodigo, dataStr), 900);
    })
    .subscribe();
}

/* =====================================================================
   UPLOAD (somente admin) — reaproveita o parser existente (parseWorkbook),
   grava uma linha por vendedor + a lista de clientes sem comprar.
===================================================================== */
function handleFile(evt){
  const file = evt.target.files[0];
  if(!file) return;
  const status = document.getElementById('upload-status');
  status.textContent = 'Lendo ' + file.name + '…';
  const reader = new FileReader();
  reader.onload = async function(e){
    try{
      const wb = XLSX.read(e.target.result, {type:'array', cellDates:true});
      const parsed = parseWorkbook(wb);
      const nothingFound = parsed.supervisors.length === 0
        && (!parsed.incentivos || parsed.incentivos.length === 0)
        && (!parsed.clientRows || parsed.clientRows.length === 0)
        && (!parsed.dailyResults || parsed.dailyResults.length === 0);
      if(nothingFound){
        status.textContent = 'Nenhuma linha reconhecida (confira as colunas Supervisor/Vendedor/Categoria/Meta/Realizado, ou a aba "Painel Ganho").';
        return;
      }
      status.textContent = 'Enviando pro banco de dados…';

      if(parsed.supervisors.length > 0){

      // --- dados de meta/realizado, uma linha por vendedor ---
      // Apaga tudo antes de inserir de novo: garante que supervisores/vendedores
      // que não aparecem mais na planilha de hoje (ex: nome trocado, código antigo)
      // não fiquem "fantasmas" no painel.
      const { error: errDelSnap } = await db.from('vendor_snapshots').delete().gt('id', 0);
      if(errDelSnap) throw errDelSnap;

      const vendorRows = flattenToVendorRows(parsed.supervisors).map(r => ({
        ...r,
        updated_at: new Date().toISOString(),
        updated_by: CURRENT_USER.id
      }));
      const { error: errSnap } = await db.from('vendor_snapshots').insert(vendorRows);
      if(errSnap) throw errSnap;

      // --- meta global do dia ---
      const { error: errMeta } = await db.from('meta').upsert(
        { id: 1, payload: parsed.meta, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      );
      if(errMeta) throw errMeta;
      } // fim do bloco "só roda se achou dados de Meta/Realizado"

      // --- clientes sem comprar: substitui a lista do dia por supervisor ---
      if(parsed.clientRows && parsed.clientRows.length){
        const supSheetNames = [...new Set(parsed.clientRows.map(r => 'Fundamentos ' + r.supervisor))];
        const { error: errDel } = await db.from('client_watchlist').delete().in('supervisor_sheet_name', supSheetNames);
        if(errDel) throw errDel;

        const clientInsertRows = parsed.clientRows.map(r => ({
          supervisor_sheet_name: 'Fundamentos ' + r.supervisor,
          vendedor_nome: r.vendedor,
          codigo: r.codigo,
          cliente: r.cliente,
          canal: r.canal,
          dia_atendimento: r.diaAtendimento,
          dias_sem_comprar: r.diasSemComprar,
          updated_at: new Date().toISOString()
        }));
        const { error: errIns } = await db.from('client_watchlist').insert(clientInsertRows);
        if(errIns) throw errIns;
      }

      // --- resultado do desafio do dia (aba "Resultado Dia"): atualiza só o
      //     campo resultado, preservando a necessidade lançada pelos supervisores ---
      if(parsed.dailyResults && parsed.dailyResults.length){
        const resultRows = parsed.dailyResults.map(r => ({
          ...r,
          data: todayStr(),
          updated_at: new Date().toISOString(),
          updated_by: CURRENT_USER.id
        }));
        const { error: errRes } = await db.from('daily_commitments')
          .upsert(resultRows, { onConflict: 'supervisor_sheet_name,vendedor_nome,categoria,data' });
        if(errRes) throw errRes;
      }

      // --- incentivo/prêmio (aba "Painel Ganho"): substitui tudo, igual ao vendor_snapshots ---
      if(parsed.incentivos && parsed.incentivos.length){
        const { error: errDelInc } = await db.from('incentivos').delete().gt('id', 0);
        if(errDelInc) throw errDelInc;
        const incentivoRows = parsed.incentivos.map(r => ({
          ...r,
          updated_at: new Date().toISOString(),
          updated_by: CURRENT_USER.id
        }));
        const { error: errInc } = await db.from('incentivos').insert(incentivoRows);
        if(errInc) throw errInc;
      }

      status.textContent = 'Enviado às ' + new Date().toLocaleTimeString('pt-BR') + ' — todo mundo já está vendo.';
      await loadDataFromDB();
    }catch(err){
      console.error(err);
      status.textContent = 'Erro ao enviar: ' + (err.message || err);
    }
  };
  reader.readAsArrayBuffer(file);
}

window.addEventListener('DOMContentLoaded', initApp);

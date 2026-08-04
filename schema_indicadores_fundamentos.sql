-- ============================================================================
-- INDICADORES MENSAIS — importados da planilha "Fundamentos Comissão e
-- Produtividade" (.xlsm), abas Volume / Coberturas / HEISHOP - ACOMP VENDAS.
-- 3 tabelas separadas, formato longo/tidy (1 linha por vendedor + categoria +
-- data_referencia). Quem grava é scripts/import_fundamentos.js (service role,
-- ignora RLS). Cole este arquivo inteiro no SQL Editor do Supabase e rode UMA vez.
--
-- Decisões tomadas com o usuário antes de criar:
--   - Coluna A da planilha (código redundante com SETOR) é ignorada, não é
--     gravada em nenhuma tabela.
--   - Idempotência via "apaga tudo daquela data_referencia antes de reinserir"
--     (feito pelo script) — por isso NÃO há constraint de unicidade aqui.
--   - RLS segue o mesmo padrão de "clientes"/"necessidade_dia": admin lê tudo,
--     supervisor lê o time, vendedor lê o próprio. Só leitura pela app —
--     escrita é exclusiva do script de importação via service_role.
-- ============================================================================

-- =========================================
-- Tabela: volume_indicadores
-- =========================================
create table if not exists volume_indicadores (
  id bigint generated always as identity primary key,
  data_referencia date not null,
  dias_uteis_venda smallint,
  dias_trabalhados smallint,
  dias_faltantes smallint,
  supervisor text not null,
  setor text not null,
  vendedor text not null,
  pdvs integer,
  categoria text not null,           -- ex: 'rgb mainstream', 'craft', 'economy'
  categoria_descricao text,          -- ex: 'HL RGB + CHOPP MAINSTREAM'
  ordem_bloco smallint not null,     -- posição sequencial do bloco na planilha
  meta numeric(14,2),
  real numeric(14,2),
  percentual numeric(8,4),
  necessidade_dia numeric(14,2),
  criado_em timestamptz default now(),
  arquivo_origem text not null
);

create index if not exists idx_volume_data on volume_indicadores (data_referencia);
create index if not exists idx_volume_vendedor on volume_indicadores (vendedor);
create index if not exists idx_volume_categoria on volume_indicadores (categoria);

-- =========================================
-- Tabela: cobertura_indicadores
-- =========================================
create table if not exists cobertura_indicadores (
  id bigint generated always as identity primary key,
  data_referencia date not null,
  dias_uteis_venda smallint,
  dias_trabalhados smallint,
  dias_faltantes smallint,
  supervisor text not null,
  setor text not null,
  vendedor text not null,
  pdvs integer,
  categoria text not null,
  categoria_descricao text,
  ordem_bloco smallint not null,     -- essencial aqui: SKU x PDV HNK/AMSTEL/SPIN aparecem 2x cada
  meta numeric(14,2),                -- inclui o caso "OBJ BASE Abr" tratado como meta
  real numeric(14,2),
  percentual numeric(8,4),
  necessidade_dia numeric(14,2),
  criado_em timestamptz default now(),
  arquivo_origem text not null
);

create index if not exists idx_cobertura_data on cobertura_indicadores (data_referencia);
create index if not exists idx_cobertura_vendedor on cobertura_indicadores (vendedor);
create index if not exists idx_cobertura_categoria on cobertura_indicadores (categoria);

-- =========================================
-- Tabela: heishop_indicadores
-- =========================================
-- Estrutura heterogênea: campos genéricos acomodam tanto o bloco padrão
-- (Meta/Real/%/Necessidade Dia) quanto os blocos especiais (Fat. Total/Fat.
-- HEISHOP/PEDIDOS HEISHOP e DEV. FATURAMENTO/DEV X FAT). tipo_bloco diz qual
-- grupo de campos está preenchido em cada linha.
create table if not exists heishop_indicadores (
  id bigint generated always as identity primary key,
  data_referencia date not null,
  dias_uteis_venda smallint,
  dias_trabalhados smallint,
  dias_faltantes smallint,
  supervisor text not null,
  setor text not null,
  vendedor text not null,
  pdvs integer,
  categoria text not null,           -- ex: 'HEISHOP FATURAMENTO - PEDIDO', 'ACOMP. VENDAS FATURAMENTO'
  categoria_descricao text,
  ordem_bloco smallint not null,
  tipo_bloco text not null check (tipo_bloco in ('padrao', 'faturamento_pedido', 'devolucao')),
  -- campos do bloco padrão (Meta/Real/%/Necessidade Dia)
  meta numeric(14,2),
  real numeric(14,2),
  percentual numeric(8,4),
  necessidade_dia numeric(14,2),
  -- campos exclusivos do bloco "faturamento_pedido"
  fat_total numeric(14,2),
  fat_heishop numeric(14,2),
  pedidos_heishop integer,
  -- campos exclusivos do bloco "devolucao"
  dev_faturamento numeric(14,2),
  dev_x_fat numeric(8,4),
  criado_em timestamptz default now(),
  arquivo_origem text not null
);

create index if not exists idx_heishop_data on heishop_indicadores (data_referencia);
create index if not exists idx_heishop_vendedor on heishop_indicadores (vendedor);
create index if not exists idx_heishop_categoria on heishop_indicadores (categoria);

-- ---------------------------------------------------------------------------
-- RLS — mesmo padrão de "clientes"/"necessidade_dia": admin vê tudo,
-- supervisor vê o time, vendedor vê o próprio. Sem policy de insert/update/
-- delete de propósito: só o script de importação escreve, via service_role
-- (que ignora RLS).
-- ---------------------------------------------------------------------------
alter table volume_indicadores enable row level security;
alter table cobertura_indicadores enable row level security;
alter table heishop_indicadores enable row level security;

create policy "volume_indicadores: admin lê tudo" on volume_indicadores
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "volume_indicadores: supervisor lê o time" on volume_indicadores
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = 'Fundamentos ' || volume_indicadores.supervisor));
create policy "volume_indicadores: vendedor lê o próprio" on volume_indicadores
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = 'Fundamentos ' || volume_indicadores.supervisor
        and p.vendedor_nome = volume_indicadores.vendedor));

create policy "cobertura_indicadores: admin lê tudo" on cobertura_indicadores
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "cobertura_indicadores: supervisor lê o time" on cobertura_indicadores
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = 'Fundamentos ' || cobertura_indicadores.supervisor));
create policy "cobertura_indicadores: vendedor lê o próprio" on cobertura_indicadores
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = 'Fundamentos ' || cobertura_indicadores.supervisor
        and p.vendedor_nome = cobertura_indicadores.vendedor));

create policy "heishop_indicadores: admin lê tudo" on heishop_indicadores
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "heishop_indicadores: supervisor lê o time" on heishop_indicadores
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = 'Fundamentos ' || heishop_indicadores.supervisor));
create policy "heishop_indicadores: vendedor lê o próprio" on heishop_indicadores
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = 'Fundamentos ' || heishop_indicadores.supervisor
        and p.vendedor_nome = heishop_indicadores.vendedor));

-- ============================================================================
-- PRÓXIMO PASSO: rodar scripts/import_fundamentos.js (Node.js) pra carregar
-- os dados da planilha mensal dentro dessas 3 tabelas.
-- ============================================================================

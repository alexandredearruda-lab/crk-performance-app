-- ============================================================================
-- VOLUMES FUTUROS — importado de "08 - Acompanhamento Executiva Volumes
-- Futuros - 40 PDVS.xlsx" (abas "Geral CRK" e "Base Estratégica Amstel").
-- 2 tabelas:
--   - volumes_futuros_indicadores: resumo por vendedor (Meta/Real/%/Nec.Dia)
--     pra 3 indicadores (Cobertura SPIN, Volume Craft+SPIN, Volume NAB) —
--     mesmo formato longo/tidy de volume_indicadores/cobertura_indicadores.
--   - amstel_estrategico: checklist dos PDVs estratégicos (cobertura +
--     execução) da aba "Base Estratégica Amstel".
-- Quem grava é scripts/import_volumes_futuros.js (service role, ignora RLS).
--
-- ACESSO: só admin por enquanto (pedido explícito do usuário — "no momento
-- somente o adm terá acesso"). profiles.pode_ver_executivo dá o caminho pra
-- liberar gente específica depois, sem precisar de outra migração: quando
-- chegar a hora, um simples "update profiles set pode_ver_executivo = true
-- where id = '...'" libera a pessoa, sem mexer em RLS de novo.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode UMA vez.
-- ============================================================================

alter table profiles add column if not exists pode_ver_executivo boolean not null default false;

-- =========================================
-- Tabela: volumes_futuros_indicadores
-- =========================================
create table if not exists volumes_futuros_indicadores (
  id bigint generated always as identity primary key,
  data_referencia date not null,
  dias_uteis_venda smallint,
  dias_trabalhados smallint,
  dias_faltantes smallint,
  supervisor text not null,
  setor text not null,
  vendedor text not null,
  pdvs integer,
  categoria text not null,           -- 'COBERTURA SPIN' | 'VOLUME CRAFT + SPIN' | 'VOLUME NAB'
  ordem_bloco smallint not null,
  meta numeric(14,2),
  "real" numeric(14,2),
  percentual numeric(8,4),
  necessidade_dia numeric(14,2),
  criado_em timestamptz default now(),
  arquivo_origem text not null
);

create index if not exists idx_volfut_data on volumes_futuros_indicadores (data_referencia);
create index if not exists idx_volfut_vendedor on volumes_futuros_indicadores (vendedor);

-- =========================================
-- Tabela: amstel_estrategico (checklist dos 40 PDVs)
-- =========================================
create table if not exists amstel_estrategico (
  id bigint generated always as identity primary key,
  data_referencia date not null,
  numero smallint,
  supervisor_codigo int,
  supervisor_nome text,
  vendedor_codigo int,
  vendedor_nome text,
  pt smallint,
  cliente_codigo text not null,
  fantasia text not null,
  cidade text,
  canal text,
  matriz_nivel text,                 -- DIAMANTE / OURO / BRONZE / ...
  cob_spin smallint,                 -- 0/1 conforme a planilha
  cob_craft smallint,
  cob_fys_itubaina smallint,
  rota_forms text,
  geladeira_chopeira text,
  cardapio text,
  uniforme text,
  fachada_execucao text,
  contrato_acordo text,
  criado_em timestamptz default now(),
  arquivo_origem text not null
);

create index if not exists idx_amstel_data on amstel_estrategico (data_referencia);
create index if not exists idx_amstel_vendedor on amstel_estrategico (vendedor_nome);

-- ---------------------------------------------------------------------------
-- RLS — só admin ou quem tiver pode_ver_executivo=true. Só leitura pela app;
-- escrita é exclusiva do script de importação via service_role.
-- ---------------------------------------------------------------------------
alter table volumes_futuros_indicadores enable row level security;
alter table amstel_estrategico enable row level security;

create policy "volumes_futuros_indicadores: acesso executivo" on volumes_futuros_indicadores
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid()
      and (p.role = 'admin' or p.pode_ver_executivo = true)));

create policy "amstel_estrategico: acesso executivo" on amstel_estrategico
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid()
      and (p.role = 'admin' or p.pode_ver_executivo = true)));

-- ============================================================================
-- PRÓXIMO PASSO: rodar scripts/import_volumes_futuros.js (Node.js) pra
-- carregar os dados das abas "Geral CRK" e "Base Estratégica Amstel".
-- ============================================================================

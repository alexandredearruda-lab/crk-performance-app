-- ============================================================================
-- EXECUTIVOS — migração de "Volumes Futuros" (1 planilha) para "Executivos"
-- (2 planilhas: Amstel e Volume Futuro), cada uma com botão próprio na tela.
--
-- O que muda em relação a schema_volumes_futuros.sql:
--   1. volumes_futuros_indicadores ganha a coluna "marca" ('amstel' |
--      'volume_futuro'), pra guardar o resumo por vendedor das DUAS
--      planilhas na mesma tabela sem uma apagar a outra.
--   2. amstel_estrategico tinha as colunas ERRADAS (cob_spin/cob_craft/
--      cob_fys_itubaina — isso é da planilha "Volume Futuro", não da
--      "Amstel"). Essa migração corrige pra rgb_amstel/rgb_heineken/
--      onde_tem_hnk_tem_amstel/amstel_ow, que são as colunas reais da aba
--      "Base Estratégica Amstel".
--   3. Cria a tabela nova volumefuturo_estrategico (cob_spin/cob_craft/
--      cob_fys_itubaina — essas sim são as colunas reais da aba "Base
--      Estratégica volume futuro").
--   4. "pt" (ponto/frequência de visita) vira texto nas duas tabelas — na
--      planilha Amstel é um número (1,2,3...), na Volume Futuro é um texto
--      ("SEMANAL TERÇA-FEIRA"...), texto cobre os dois casos sem erro.
--
-- Quem grava é scripts/import_executivo.js (substitui import_volumes_
-- futuros.js), com --marca amstel ou --marca volume_futuro.
--
-- Pode rodar este arquivo mesmo já tendo rodado schema_volumes_futuros.sql
-- antes — os comandos abaixo são seguros de repetir (idempotentes).
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode UMA vez.
-- ============================================================================

alter table profiles add column if not exists pode_ver_executivo boolean not null default false;

-- =========================================
-- Tabela: volumes_futuros_indicadores (resumo por vendedor, as 2 marcas)
-- =========================================
create table if not exists volumes_futuros_indicadores (
  id bigint generated always as identity primary key,
  data_referencia date not null,
  marca text not null default 'amstel',
  dias_uteis_venda smallint,
  dias_trabalhados smallint,
  dias_faltantes smallint,
  supervisor text not null,
  setor text not null,
  vendedor text not null,
  pdvs integer,
  categoria text not null,           -- ex: 'COB. AMSTEL RGB' | 'COBERTURA SPIN' | ...
  ordem_bloco smallint not null,
  meta numeric(14,2),
  "real" numeric(14,2),
  percentual numeric(8,4),
  necessidade_dia numeric(14,2),
  criado_em timestamptz default now(),
  arquivo_origem text not null
);

alter table volumes_futuros_indicadores add column if not exists marca text not null default 'amstel';

-- Os dados que já estavam nessa tabela vieram do script antigo
-- (import_volumes_futuros.js), que tinha os índices de linha/coluna errados
-- (linha 1 e coluna A em branco não eram descontados — ver o comentário no
-- topo de scripts/import_executivo.js) e nenhuma marca de verdade. Mais
-- seguro apagar tudo e reimportar do zero com o script novo do que tentar
-- consertar linha a linha. Se preferir manter o histórico velho, comente a
-- linha abaixo antes de rodar.
truncate table volumes_futuros_indicadores;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'volumes_futuros_indicadores_marca_check'
  ) then
    alter table volumes_futuros_indicadores
      add constraint volumes_futuros_indicadores_marca_check
      check (marca in ('amstel', 'volume_futuro'));
  end if;
end $$;

create index if not exists idx_volfut_data on volumes_futuros_indicadores (data_referencia);
create index if not exists idx_volfut_data_marca on volumes_futuros_indicadores (data_referencia, marca);
create index if not exists idx_volfut_vendedor on volumes_futuros_indicadores (vendedor);

-- =========================================
-- Tabela: amstel_estrategico (checklist dos PDVs — aba "Base Estratégica
-- Amstel"). Corrige as colunas de flag, que estavam com nome/sentido errado.
-- =========================================
create table if not exists amstel_estrategico (
  id bigint generated always as identity primary key,
  data_referencia date not null,
  numero smallint,
  supervisor_codigo int,
  supervisor_nome text,
  vendedor_codigo int,
  vendedor_nome text,
  pt text,
  cliente_codigo text not null,
  fantasia text not null,
  cidade text,
  canal text,
  matriz_nivel text,                 -- DIAMANTE / OURO / BRONZE / ...
  rota_forms text,
  geladeira_chopeira text,
  cardapio text,
  uniforme text,
  fachada_execucao text,
  contrato_acordo text,
  criado_em timestamptz default now(),
  arquivo_origem text not null
);

-- Mesmo motivo do truncate acima: os dados antigos tinham as colunas de
-- cobertura trocadas (formato da planilha errada) e os índices de
-- linha/coluna deslocados. Apaga e deixa o próximo import recriar certo.
truncate table amstel_estrategico;

alter table amstel_estrategico drop column if exists cob_spin;
alter table amstel_estrategico drop column if exists cob_craft;
alter table amstel_estrategico drop column if exists cob_fys_itubaina;
alter table amstel_estrategico add column if not exists rgb_amstel smallint;
alter table amstel_estrategico add column if not exists rgb_heineken smallint;
alter table amstel_estrategico add column if not exists onde_tem_hnk_tem_amstel smallint;
alter table amstel_estrategico add column if not exists amstel_ow smallint;
alter table amstel_estrategico alter column pt type text using pt::text;

create index if not exists idx_amstel_data on amstel_estrategico (data_referencia);
create index if not exists idx_amstel_vendedor on amstel_estrategico (vendedor_nome);

-- =========================================
-- Tabela nova: volumefuturo_estrategico (checklist dos PDVs — aba "Base
-- Estratégica volume futuro").
-- =========================================
create table if not exists volumefuturo_estrategico (
  id bigint generated always as identity primary key,
  data_referencia date not null,
  numero smallint,
  supervisor_codigo int,
  supervisor_nome text,
  vendedor_codigo int,
  vendedor_nome text,
  pt text,
  cliente_codigo text not null,
  fantasia text not null,
  cidade text,
  canal text,
  matriz_nivel text,
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

create index if not exists idx_volfut_estrat_data on volumefuturo_estrategico (data_referencia);
create index if not exists idx_volfut_estrat_vendedor on volumefuturo_estrategico (vendedor_nome);

-- ---------------------------------------------------------------------------
-- RLS — só admin ou quem tiver pode_ver_executivo=true. Só leitura pela app;
-- escrita é exclusiva do script de importação via service_role.
-- ---------------------------------------------------------------------------
alter table volumes_futuros_indicadores enable row level security;
alter table amstel_estrategico enable row level security;
alter table volumefuturo_estrategico enable row level security;

drop policy if exists "volumes_futuros_indicadores: acesso executivo" on volumes_futuros_indicadores;
create policy "volumes_futuros_indicadores: acesso executivo" on volumes_futuros_indicadores
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid()
      and (p.role = 'admin' or p.pode_ver_executivo = true)));

drop policy if exists "amstel_estrategico: acesso executivo" on amstel_estrategico;
create policy "amstel_estrategico: acesso executivo" on amstel_estrategico
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid()
      and (p.role = 'admin' or p.pode_ver_executivo = true)));

drop policy if exists "volumefuturo_estrategico: acesso executivo" on volumefuturo_estrategico;
create policy "volumefuturo_estrategico: acesso executivo" on volumefuturo_estrategico
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid()
      and (p.role = 'admin' or p.pode_ver_executivo = true)));

-- ============================================================================
-- PRÓXIMO PASSO: rodar scripts/import_executivo.js (Node.js) com --marca
-- amstel e depois com --marca volume_futuro, pra carregar as duas planilhas.
-- Ou simplesmente dar 2 cliques nos atalhos "Atualizar Executivo Amstel.bat"
-- e "Atualizar Executivo Volume Futuro.bat" na pasta do projeto.
-- ============================================================================

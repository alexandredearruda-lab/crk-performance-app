-- ============================================================================
-- PAINEL DE PRODUTIVIDADE — schema v2 (3 níveis de acesso + clientes sem compra)
-- Se você já tinha rodado uma versão anterior deste schema, rode primeiro:
--   drop table if exists snapshots cascade;
--   drop table if exists vendor_snapshots cascade;
--   drop table if exists client_watchlist cascade;
--   drop table if exists profiles cascade;
--   drop table if exists meta cascade;
-- e depois cole e rode este arquivo inteiro.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PERFIS: liga cada login a um papel — admin / supervisor / vendedor
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','supervisor','vendedor')),
  supervisor_sheet_name text, -- obrigatório para supervisor e vendedor (ex: 'Fundamentos FELIPE')
  vendedor_nome text,         -- obrigatório só para vendedor (precisa bater com o nome na planilha)
  display_name text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- DADOS POR VENDEDOR: uma linha por vendedor (+ 2 linhas de totais por
-- supervisor: total do supervisor e total da empresa, marcadas com is_aggregate).
-- Isso permite que cada vendedor veja só a própria linha.
-- ---------------------------------------------------------------------------
create table if not exists vendor_snapshots (
  id bigint generated always as identity primary key,
  supervisor_sheet_name text not null,
  supervisor_display_name text not null,
  vendedor_nome text not null,       -- nome do vendedor, ou 'SUPERVISOR (total)' / 'EMPRESA (total)'
  is_aggregate boolean not null default false,
  pdvs int,
  metrics jsonb not null,            -- lista de {label, values:{Meta,Real,%, "Necessidade Dia"}, fieldsOrder}
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id),
  unique (supervisor_sheet_name, vendedor_nome)
);

-- ---------------------------------------------------------------------------
-- CLIENTES SEM COMPRA — lista por vendedor
-- ---------------------------------------------------------------------------
create table if not exists client_watchlist (
  id bigint generated always as identity primary key,
  supervisor_sheet_name text not null,
  vendedor_nome text not null,
  codigo text,
  cliente text not null,
  canal text,
  dia_atendimento text,
  dias_sem_comprar int,
  updated_at timestamptz default now(),
  unique (supervisor_sheet_name, vendedor_nome, cliente)
);

-- ---------------------------------------------------------------------------
-- METADADOS GLOBAIS DO DIA (Data / Dias Úteis / Trabalhados / Faltantes)
-- ---------------------------------------------------------------------------
create table if not exists meta (
  id int primary key default 1,
  payload jsonb not null,
  updated_at timestamptz default now(),
  constraint meta_singleton check (id = 1)
);

-- ---------------------------------------------------------------------------
-- SEGURANÇA (Row Level Security)
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table vendor_snapshots enable row level security;
alter table client_watchlist enable row level security;
alter table meta enable row level security;

-- profiles
create policy "profiles: usuário vê o próprio" on profiles
  for select using (id = auth.uid());
-- (não criamos uma política "admin vê todos" aqui de propósito: uma política em
-- "profiles" que consulta a própria tabela "profiles" causa recursão infinita
-- no Postgres. O app só precisa que cada um veja o próprio perfil.)

-- vendor_snapshots: leitura
create policy "vendor_snapshots: admin vê tudo" on vendor_snapshots
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "vendor_snapshots: supervisor vê o time dele" on vendor_snapshots
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = vendor_snapshots.supervisor_sheet_name
    )
  );

create policy "vendor_snapshots: vendedor vê a própria linha + totais" on vendor_snapshots
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = vendor_snapshots.supervisor_sheet_name
        and (vendor_snapshots.vendedor_nome = p.vendedor_nome or vendor_snapshots.is_aggregate = true)
    )
  );

-- vendor_snapshots: escrita (só admin)
create policy "vendor_snapshots: admin insere" on vendor_snapshots
  for insert with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "vendor_snapshots: admin atualiza" on vendor_snapshots
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "vendor_snapshots: admin apaga" on vendor_snapshots
  for delete using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- client_watchlist: leitura
create policy "clientes: admin vê tudo" on client_watchlist
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "clientes: supervisor vê o time dele" on client_watchlist
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = client_watchlist.supervisor_sheet_name
    )
  );

create policy "clientes: vendedor vê os próprios clientes" on client_watchlist
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = client_watchlist.supervisor_sheet_name
        and p.vendedor_nome = client_watchlist.vendedor_nome
    )
  );

-- client_watchlist: escrita (só admin)
create policy "clientes: admin insere" on client_watchlist
  for insert with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "clientes: admin atualiza" on client_watchlist
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "clientes: admin apaga" on client_watchlist
  for delete using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- meta
create policy "meta: qualquer logado lê" on meta
  for select using (auth.uid() is not null);
create policy "meta: admin insere" on meta
  for insert with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "meta: admin atualiza" on meta
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ============================================================================
-- PRÓXIMO PASSO (pelo painel do Supabase, não por SQL):
-- Authentication -> Users -> criar um login por pessoa (admin, cada supervisor,
-- cada vendedor). Depois, Table Editor -> profiles -> Insert row para cada um:
--
--   admin:      role='admin'
--   supervisor: role='supervisor', supervisor_sheet_name='Fundamentos FELIPE'
--   vendedor:   role='vendedor',  supervisor_sheet_name='Fundamentos FELIPE',
--               vendedor_nome='THIAGO RODRIGO'  (idêntico ao nome na planilha)
-- ============================================================================

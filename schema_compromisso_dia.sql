-- ============================================================================
-- ADIÇÃO: compromisso/necessidade do dia preenchido pelo SUPERVISOR
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode UMA vez.
-- (Não afeta as tabelas que já existem.)
--
-- Se você JÁ RODOU uma versão anterior deste arquivo, rode apenas estas
-- linhas em vez do arquivo todo:
--   alter table daily_commitments add column if not exists resultado numeric;
--   alter table daily_commitments add column if not exists categoria text not null default 'GERAL';
--   alter table daily_commitments add column if not exists data date not null default current_date;
--   alter table daily_commitments drop constraint if exists daily_commitments_supervisor_sheet_name_vendedor_nome_key;
--   alter table daily_commitments drop constraint if exists daily_commitments_unique;
--   alter table daily_commitments add constraint daily_commitments_unique unique (supervisor_sheet_name, vendedor_nome, categoria, data);
-- ============================================================================

create table if not exists daily_commitments (
  id bigint generated always as identity primary key,
  supervisor_sheet_name text not null,
  vendedor_nome text not null,
  categoria text not null default 'GERAL', -- o desafio pode ser aberto por categoria (TT, Premium, Craft...)
  data date not null default current_date, -- cada dia é uma linha própria — dá pra puxar o histórico depois
  valor numeric,                      -- a necessidade do dia definida pelo supervisor
  resultado numeric,                  -- o resultado do dia (preenchido depois)
  observacao text,                    -- espaço livre opcional (ex: foco do dia)
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id),
  unique (supervisor_sheet_name, vendedor_nome, categoria, data)
);

alter table daily_commitments enable row level security;

-- LEITURA: admin vê tudo; supervisor vê o time dele; vendedor vê o próprio
create policy "commit: admin lê tudo" on daily_commitments
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "commit: supervisor lê o time" on daily_commitments
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = daily_commitments.supervisor_sheet_name));

create policy "commit: vendedor lê o próprio" on daily_commitments
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = daily_commitments.supervisor_sheet_name
        and p.vendedor_nome = daily_commitments.vendedor_nome));

-- ESCRITA: admin em tudo; supervisor só no próprio time
create policy "commit: admin insere" on daily_commitments
  for insert with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "commit: admin atualiza" on daily_commitments
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "commit: admin apaga" on daily_commitments
  for delete using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "commit: supervisor insere no time" on daily_commitments
  for insert with check (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = daily_commitments.supervisor_sheet_name));

create policy "commit: supervisor atualiza no time" on daily_commitments
  for update using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = daily_commitments.supervisor_sheet_name));

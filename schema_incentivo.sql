-- ============================================================================
-- ADIÇÃO: Incentivo / Prêmio (aba "Painel Ganho")
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode UMA vez.
-- (Não afeta nenhuma tabela que já existe.)
-- ============================================================================

create table if not exists incentivos (
  id bigint generated always as identity primary key,
  supervisor_sheet_name text not null,
  supervisor_display_name text not null,
  vendedor_nome text not null,      -- nome do vendedor, ou 'SUPERVISOR (total)' / 'EMPRESA (total)'
  is_aggregate boolean not null default false,
  pdvs int,
  premio numeric,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id),
  unique (supervisor_sheet_name, vendedor_nome)
);

alter table incentivos enable row level security;

create policy "incentivos: admin vê tudo" on incentivos
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "incentivos: supervisor vê o time dele" on incentivos
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = incentivos.supervisor_sheet_name));

create policy "incentivos: vendedor vê a própria linha + totais" on incentivos
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = incentivos.supervisor_sheet_name
        and (incentivos.vendedor_nome = p.vendedor_nome or incentivos.is_aggregate = true)));

create policy "incentivos: admin insere" on incentivos
  for insert with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "incentivos: admin atualiza" on incentivos
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "incentivos: admin apaga" on incentivos
  for delete using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

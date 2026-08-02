-- ============================================================================
-- ADIÇÃO: base de clientes (importada de Base_Clientes.xlsx) + Necessidade do
-- Dia por cliente (Desafio/Real, por vendedor + dia da semana).
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode UMA vez.
-- (Não afeta nenhuma tabela que já existe — inclusive "daily_commitments"
-- continua funcionando do jeito que estava, só a tela que usa ela vai mudar.)
-- ============================================================================

create table if not exists clientes (
  id bigint generated always as identity primary key,
  codigo text not null unique,          -- "Cód" na planilha (ex: "0001-0012") — chave do upsert na importação
  fantasia text not null,
  cidade text,
  canal text,
  pasta_cli int,                        -- "Pasta Cli (Cód)"
  dia_visita text,                      -- normalizado pelo script de importação: SEG/TER/QUA/QUI/SEX
  vendedor_codigo int not null,
  vendedor_nome text not null,
  supervisor_codigo int,
  supervisor_nome text not null,
  updated_at timestamptz default now()
);

create table if not exists necessidade_dia (
  id bigint generated always as identity primary key,
  vendedor_codigo int not null,
  cliente_id bigint not null references clientes(id) on delete cascade,
  data date not null,
  valor_desafio numeric,                -- planejado
  valor_real numeric,                   -- vendido
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id),
  unique (vendedor_codigo, cliente_id, data)
);

alter table clientes enable row level security;
alter table necessidade_dia enable row level security;

-- ---------------------------------------------------------------------------
-- clientes: só leitura pela app. Quem escreve é o script de importação
-- (scripts/import_clientes.js), usando a service role key — que ignora RLS.
-- Por isso não existe policy de insert/update/delete aqui de propósito.
-- ---------------------------------------------------------------------------
create policy "clientes: admin lê tudo" on clientes
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "clientes: supervisor lê o time" on clientes
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = 'Fundamentos ' || clientes.supervisor_nome));

create policy "clientes: vendedor lê os próprios clientes" on clientes
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = 'Fundamentos ' || clientes.supervisor_nome
        and p.vendedor_nome = clientes.vendedor_nome));

-- ---------------------------------------------------------------------------
-- necessidade_dia: leitura com o mesmo escopo (via join em clientes); escrita
-- liberada pra admin, supervisor do time e o próprio vendedor.
-- ---------------------------------------------------------------------------
create policy "necessidade_dia: admin lê tudo" on necessidade_dia
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "necessidade_dia: supervisor lê o time" on necessidade_dia
  for select using (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia.cliente_id
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = 'Fundamentos ' || c.supervisor_nome));

create policy "necessidade_dia: vendedor lê o próprio" on necessidade_dia
  for select using (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia.cliente_id
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = 'Fundamentos ' || c.supervisor_nome
        and p.vendedor_nome = c.vendedor_nome));

create policy "necessidade_dia: admin insere" on necessidade_dia
  for insert with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "necessidade_dia: admin atualiza" on necessidade_dia
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "necessidade_dia: supervisor insere no time" on necessidade_dia
  for insert with check (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia.cliente_id
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = 'Fundamentos ' || c.supervisor_nome));
create policy "necessidade_dia: supervisor atualiza no time" on necessidade_dia
  for update using (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia.cliente_id
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = 'Fundamentos ' || c.supervisor_nome));

create policy "necessidade_dia: vendedor insere o próprio" on necessidade_dia
  for insert with check (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia.cliente_id
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = 'Fundamentos ' || c.supervisor_nome
        and p.vendedor_nome = c.vendedor_nome));
create policy "necessidade_dia: vendedor atualiza o próprio" on necessidade_dia
  for update using (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia.cliente_id
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = 'Fundamentos ' || c.supervisor_nome
        and p.vendedor_nome = c.vendedor_nome));

-- ============================================================================
-- PRÓXIMO PASSO: rodar scripts/import_clientes.js (Node.js) pra carregar os
-- dados de Base_Clientes.xlsx dentro da tabela "clientes".
-- ============================================================================

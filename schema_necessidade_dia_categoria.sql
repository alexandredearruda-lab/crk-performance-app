-- ============================================================================
-- ADIÇÃO: desafio de Necessidade do Dia por categoria + indicador (Volume ou
-- Cobertura), em paralelo à tabela "necessidade_dia" que já existe (genérica,
-- Desafio/Real por cliente/dia). Não mexe em "necessidade_dia" — os dois
-- modelos convivem: a tela de Necessidade do Dia continua mostrando o par
-- genérico Desafio/Real de sempre, e ganha blocos extras por categoria quando
-- o supervisor seleciona uma ou mais categorias pro dia.
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode UMA vez.
-- ============================================================================

create table if not exists necessidade_dia_categoria (
  id bigint generated always as identity primary key,
  vendedor_codigo int not null,
  cliente_id bigint not null references clientes(id) on delete cascade,
  data date not null,
  categoria text not null,              -- ex: 'rgb mainstream', 'craft' — mesmas da aba Indicadores
  tipo_indicador text not null check (tipo_indicador in ('volume', 'cobertura')),
  valor_desafio numeric,
  valor_real numeric,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id),
  unique (vendedor_codigo, cliente_id, data, categoria, tipo_indicador)
);

create index if not exists idx_necessidade_cat_vendedor_data
  on necessidade_dia_categoria (vendedor_codigo, data);

alter table necessidade_dia_categoria enable row level security;

-- ---------------------------------------------------------------------------
-- RLS — mesmo padrão de "necessidade_dia": leitura por admin (tudo),
-- supervisor (time, via join em clientes) e vendedor (o próprio); escrita
-- liberada pros mesmos três papéis, no mesmo escopo.
-- ---------------------------------------------------------------------------
create policy "necessidade_dia_categoria: admin lê tudo" on necessidade_dia_categoria
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "necessidade_dia_categoria: supervisor lê o time" on necessidade_dia_categoria
  for select using (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia_categoria.cliente_id
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = 'Fundamentos ' || c.supervisor_nome));

create policy "necessidade_dia_categoria: vendedor lê o próprio" on necessidade_dia_categoria
  for select using (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia_categoria.cliente_id
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = 'Fundamentos ' || c.supervisor_nome
        and p.vendedor_nome = c.vendedor_nome));

create policy "necessidade_dia_categoria: admin insere" on necessidade_dia_categoria
  for insert with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "necessidade_dia_categoria: admin atualiza" on necessidade_dia_categoria
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "necessidade_dia_categoria: supervisor insere no time" on necessidade_dia_categoria
  for insert with check (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia_categoria.cliente_id
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = 'Fundamentos ' || c.supervisor_nome));
create policy "necessidade_dia_categoria: supervisor atualiza no time" on necessidade_dia_categoria
  for update using (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia_categoria.cliente_id
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = 'Fundamentos ' || c.supervisor_nome));

create policy "necessidade_dia_categoria: vendedor insere o próprio" on necessidade_dia_categoria
  for insert with check (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia_categoria.cliente_id
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = 'Fundamentos ' || c.supervisor_nome
        and p.vendedor_nome = c.vendedor_nome));
create policy "necessidade_dia_categoria: vendedor atualiza o próprio" on necessidade_dia_categoria
  for update using (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia_categoria.cliente_id
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = 'Fundamentos ' || c.supervisor_nome
        and p.vendedor_nome = c.vendedor_nome));

-- ============================================================================
-- CLIENTES SEM COMPRA — importado da planilha "07 - Base clientes sem compra"
-- (aba "Clientes sem Compra"), via scripts/import_clientes_sem_compra.js.
-- Diferente do client_watchlist antigo (que vinha do upload manual de Excel,
-- por nome de Supervisor/Vendedor): aqui os vendedores vêm identificados por
-- código (SUP/VD, os mesmos "setor" da planilha Fundamentos), resolvidos pro
-- nome automaticamente contra volume_indicadores no momento da importação.
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode UMA vez.
-- ============================================================================

create table if not exists clientes_sem_compra (
  id bigint generated always as identity primary key,
  data_referencia date not null,
  supervisor text,              -- resolvido via código SUP -> nome (null se não achou correspondência)
  vendedor text,                 -- resolvido via código VD -> nome (VD = mesmo "setor" das tabelas de indicadores)
  setor text not null,           -- código VD bruto da planilha, pra rastrear mesmo sem resolver nome
  codigo text,                   -- "Cod" do cliente (formato 0000-0000, mesmo de clientes.codigo)
  pasta text,
  fantasia text not null,
  razao_social text,
  canal text,
  municipio text,
  dias_sem_comprar int,
  criado_em timestamptz default now(),
  arquivo_origem text not null,
  unique (data_referencia, setor, codigo)
);

create index if not exists idx_clientes_sem_compra_data on clientes_sem_compra (data_referencia);
create index if not exists idx_clientes_sem_compra_supervisor on clientes_sem_compra (supervisor);
create index if not exists idx_clientes_sem_compra_dias on clientes_sem_compra (dias_sem_comprar);

alter table clientes_sem_compra enable row level security;

-- ---------------------------------------------------------------------------
-- RLS — mesmo padrão de volume_indicadores/cobertura_indicadores/heishop_indicadores:
-- admin lê tudo, supervisor lê o time (por nome, direto na tabela — não via
-- join com "clientes", já que nem todo vendedor tem cadastro lá), vendedor lê
-- o próprio. Só leitura pela app — escrita é exclusiva do script de importação
-- via service_role.
-- ---------------------------------------------------------------------------
create policy "clientes_sem_compra: admin lê tudo" on clientes_sem_compra
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "clientes_sem_compra: supervisor lê o time" on clientes_sem_compra
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'supervisor'
        and p.supervisor_sheet_name = 'Fundamentos ' || clientes_sem_compra.supervisor));

create policy "clientes_sem_compra: vendedor lê o próprio" on clientes_sem_compra
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.supervisor_sheet_name = 'Fundamentos ' || clientes_sem_compra.supervisor
        and p.vendedor_nome = clientes_sem_compra.vendedor));

-- ============================================================================
-- PRÓXIMO PASSO: rodar scripts/import_clientes_sem_compra.js pra carregar os
-- dados da planilha mensal dentro dessa tabela.
-- ============================================================================

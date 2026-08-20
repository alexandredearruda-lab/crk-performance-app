-- ============================================================================
-- CORREÇÃO: liga "clientes" / "necessidade_dia" / "necessidade_dia_categoria"
-- ao vendedor por CÓDIGO em vez de por NOME.
--
-- Por quê: "profiles.vendedor_nome" já é usado pelas tabelas de Indicadores/
-- Incentivo/Compromisso (volume_indicadores, cobertura_indicadores,
-- heishop_indicadores, incentivos, vendor_snapshots, daily_commitments,
-- client_watchlist, clientes_sem_compra) com o NOME COMPLETO da planilha
-- Fundamentos (ex: "FABIO LUIZ SOBOTTKA"). Mas a base de clientes
-- (Base_Clientes.xlsx) usa o NOME CURTO do ERP (ex: "FABIO") na coluna
-- "Vendedor". Não dá pra profiles.vendedor_nome bater com as duas
-- convenções ao mesmo tempo — trocar o nome pra bater com uma quebra a
-- outra (foi o que aconteceu com o Fabio: corrigir a Necessidade do Dia
-- quebrou a aba Indicadores).
--
-- O código de vendedor ("Cod. Vend" na Base_Clientes.xlsx, "setor" nas
-- tabelas de Fundamentos) é o mesmo dos dois lados — por isso ele resolve
-- o problema de vez.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode UMA vez.
-- ============================================================================

alter table profiles add column if not exists vendedor_codigo text;

-- ---------------------------------------------------------------------------
-- clientes: troca "vendedor lê os próprios clientes" pra usar código.
-- (a policy de supervisor continua por nome de supervisor — essa não tem
-- o problema de duas convenções, então fica como está.)
-- ---------------------------------------------------------------------------
drop policy if exists "clientes: vendedor lê os próprios clientes" on clientes;

create policy "clientes: vendedor lê os próprios clientes" on clientes
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.vendedor_codigo = clientes.vendedor_codigo));

-- ---------------------------------------------------------------------------
-- necessidade_dia: mesma troca nas 3 policies de vendedor.
-- ---------------------------------------------------------------------------
drop policy if exists "necessidade_dia: vendedor lê o próprio" on necessidade_dia;
drop policy if exists "necessidade_dia: vendedor insere o próprio" on necessidade_dia;
drop policy if exists "necessidade_dia: vendedor atualiza o próprio" on necessidade_dia;

create policy "necessidade_dia: vendedor lê o próprio" on necessidade_dia
  for select using (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia.cliente_id
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.vendedor_codigo = c.vendedor_codigo));
create policy "necessidade_dia: vendedor insere o próprio" on necessidade_dia
  for insert with check (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia.cliente_id
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.vendedor_codigo = c.vendedor_codigo));
create policy "necessidade_dia: vendedor atualiza o próprio" on necessidade_dia
  for update using (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia.cliente_id
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.vendedor_codigo = c.vendedor_codigo));

-- ---------------------------------------------------------------------------
-- necessidade_dia_categoria: mesma troca nas 3 policies de vendedor.
-- ---------------------------------------------------------------------------
drop policy if exists "necessidade_dia_categoria: vendedor lê o próprio" on necessidade_dia_categoria;
drop policy if exists "necessidade_dia_categoria: vendedor insere o próprio" on necessidade_dia_categoria;
drop policy if exists "necessidade_dia_categoria: vendedor atualiza o próprio" on necessidade_dia_categoria;

create policy "necessidade_dia_categoria: vendedor lê o próprio" on necessidade_dia_categoria
  for select using (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia_categoria.cliente_id
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.vendedor_codigo = c.vendedor_codigo));
create policy "necessidade_dia_categoria: vendedor insere o próprio" on necessidade_dia_categoria
  for insert with check (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia_categoria.cliente_id
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.vendedor_codigo = c.vendedor_codigo));
create policy "necessidade_dia_categoria: vendedor atualiza o próprio" on necessidade_dia_categoria
  for update using (
    exists (select 1 from profiles p join clientes c on c.id = necessidade_dia_categoria.cliente_id
      where p.id = auth.uid() and p.role = 'vendedor'
        and p.vendedor_codigo = c.vendedor_codigo));

-- ============================================================================
-- PRÓXIMO PASSO: preencher profiles.vendedor_codigo de cada vendedor com o
-- "Cod. Vend" dele na Base_Clientes.xlsx (ex: update profiles set
-- vendedor_codigo = '123' where id = '...'). profiles.vendedor_nome continua
-- necessário do jeito que está (nome completo) — não mexe nele.
-- ============================================================================

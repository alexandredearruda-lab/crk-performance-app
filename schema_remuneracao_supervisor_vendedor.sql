-- ============================================================================
-- Estende o acesso à Remuneração pra supervisor (vê o próprio time + a
-- própria remuneração) e vendedor (vê só a própria remuneração) — hoje só
-- admin/pode_ver_remuneracao enxergava algo.
--
-- Reaproveita profiles.vendedor_nome pra identificar "a própria linha" de
-- qualquer papel (vendedor OU supervisor/GV): esse campo já guarda o nome
-- completo da pessoa igual aparece nas planilhas Fundamentos, e o nome na
-- coluna "VENDEDOR" da planilha de Comissão usa exatamente essa mesma
-- convenção pra QUALQUER papel na linha (vendedor, supervisor ou GV) — só
-- nunca foi preenchido pra conta de supervisor até agora, porque não tinha
-- necessidade. Depois de rodar isso, atualize o profiles.vendedor_nome de
-- cada supervisor com o nome completo dele (o mesmo texto que aparece na
-- coluna "VENDEDOR" no bloco "Supervisor/GV" da planilha de Comissão).
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode UMA vez.
-- ============================================================================

drop policy if exists "remuneracao_resumo: acesso restrito" on remuneracao_resumo;
drop policy if exists "remuneracao_categoria: acesso restrito" on remuneracao_categoria;

create policy "remuneracao_resumo: admin/liberado lê tudo" on remuneracao_resumo
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid()
      and (p.role = 'admin' or p.pode_ver_remuneracao = true)));

create policy "remuneracao_resumo: supervisor lê o time e a própria linha" on remuneracao_resumo
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'supervisor'
        and (p.supervisor_sheet_name = 'Fundamentos ' || remuneracao_resumo.supervisor
             or remuneracao_resumo.pessoa = p.vendedor_nome)));

create policy "remuneracao_resumo: vendedor lê a própria linha" on remuneracao_resumo
  for select using (
    exists (select 1 from profiles p
      where p.id = auth.uid() and p.role = 'vendedor'
        and remuneracao_resumo.pessoa = p.vendedor_nome));

create policy "remuneracao_categoria: admin/liberado lê tudo" on remuneracao_categoria
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid()
      and (p.role = 'admin' or p.pode_ver_remuneracao = true)));

create policy "remuneracao_categoria: supervisor lê o time e a própria" on remuneracao_categoria
  for select using (
    exists (
      select 1 from remuneracao_resumo rr, profiles p
      where p.id = auth.uid() and p.role = 'supervisor'
        and rr.data_referencia = remuneracao_categoria.data_referencia
        and rr.canal = remuneracao_categoria.canal
        and rr.setor = remuneracao_categoria.setor
        and rr.pessoa = remuneracao_categoria.pessoa
        and (p.supervisor_sheet_name = 'Fundamentos ' || rr.supervisor or rr.pessoa = p.vendedor_nome)));

create policy "remuneracao_categoria: vendedor lê a própria" on remuneracao_categoria
  for select using (
    exists (
      select 1 from remuneracao_resumo rr, profiles p
      where p.id = auth.uid() and p.role = 'vendedor'
        and rr.data_referencia = remuneracao_categoria.data_referencia
        and rr.canal = remuneracao_categoria.canal
        and rr.setor = remuneracao_categoria.setor
        and rr.pessoa = remuneracao_categoria.pessoa
        and rr.pessoa = p.vendedor_nome));

-- ============================================================================
-- PRÓXIMO PASSO: pra cada conta de SUPERVISOR já cadastrada, preencher
-- profiles.vendedor_nome com o nome completo dela (igual aparece na coluna
-- "VENDEDOR" do bloco "Supervisor/GV" da planilha de Comissão), senão a
-- própria remuneração do supervisor não aparece pra ele mesmo (só a do
-- time). Contas de vendedor já devem ter isso preenchido.
-- Exemplo: update profiles set vendedor_nome = 'FLAVIA APARECIDA CASADEI'
-- where id = '...' (conta da supervisora Flávia).
-- ============================================================================

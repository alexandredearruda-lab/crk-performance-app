-- ============================================================================
-- Tela de admin pra liberar acesso a Volumes Futuros / Remuneração sem
-- precisar rodar SQL a cada pessoa nova.
--
-- Hoje "profiles" só tem uma policy (usuário vê o próprio perfil) — de
-- propósito não existia uma "admin vê/edita todos", porque uma policy em
-- "profiles" que consulta a própria tabela "profiles" trava o Postgres em
-- recursão infinita. A saída padrão é uma função "security definer" (ignora
-- RLS só ali dentro, de forma controlada) que confirma se quem está logado
-- é admin, sem re-disparar a policy.
--
-- Supervisor/vendedor continuam vendo só o próprio perfil: pra eles
-- is_admin() é false, e só sobra a policy "usuário vê o próprio".
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode. Pode rodar de
-- novo sem problema (recria a função e as policies).
-- ============================================================================

create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

revoke execute on function is_admin() from public, anon;
grant execute on function is_admin() to authenticated;

drop policy if exists "profiles: admin lê tudo" on profiles;
create policy "profiles: admin lê tudo" on profiles
  for select using (is_admin());

drop policy if exists "profiles: admin atualiza" on profiles;
create policy "profiles: admin atualiza" on profiles
  for update using (is_admin()) with check (is_admin());

-- ============================================================================
-- Conferência (opcional) — deve listar as 3 policies de profiles:
--   select policyname, cmd from pg_policies where tablename = 'profiles';
--
-- Depois de rodar isso, a aba "Administração" (só admin) já consegue listar
-- todo mundo e ligar/desligar pode_ver_executivo / pode_ver_remuneracao
-- direto pela tela, sem precisar de mais nenhum SQL manual.
-- ============================================================================

-- ============================================================================
-- "TOTAL DA MESA" pro vendedor — soma do time da supervisora, sem expor o
-- desempenho individual de cada colega.
--
-- Por quê uma função em vez de simplesmente abrir mais o RLS: o RLS de
-- volume_indicadores/cobertura_indicadores/heishop_indicadores já deixa
-- supervisor e admin verem linha a linha do time inteiro — de propósito não
-- deixa o vendedor ver as linhas dos colegas (só a própria). Pra dar pro
-- vendedor o TOTAL do time sem abrir mão dessa privacidade, uma função
-- "security definer" soma no banco (então ignora RLS só ali dentro, de
-- forma controlada) e devolve só o agregado — nunca uma linha por vendedor.
-- A função descobre o time do próprio usuário logado (via profiles), não
-- aceita nome de supervisor como parâmetro — não dá pra pedir o total de
-- um time que não é o seu.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode UMA vez.
-- ============================================================================

create or replace function volume_indicadores_mesa_total(p_data_referencia date)
returns table(
  ordem_bloco smallint, categoria text, categoria_descricao text,
  meta numeric, "real" numeric, percentual numeric, necessidade_dia numeric,
  pdvs bigint, num_vendedores bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sup_sheet text;
  v_sup_nome text;
begin
  select supervisor_sheet_name into v_sup_sheet from profiles where id = auth.uid();
  if v_sup_sheet is null or v_sup_sheet = '' then return; end if;
  v_sup_nome := regexp_replace(v_sup_sheet, '^Fundamentos ', '');

  return query
    select vi.ordem_bloco, vi.categoria, max(vi.categoria_descricao),
           sum(vi.meta), sum(vi.real),
           case when sum(vi.meta) > 0 then sum(vi.real) / sum(vi.meta) else null end,
           sum(vi.necessidade_dia),
           sum(vi.pdvs)::bigint, count(distinct vi.vendedor)::bigint
    from volume_indicadores vi
    where vi.supervisor = v_sup_nome and vi.data_referencia = p_data_referencia
    group by vi.ordem_bloco, vi.categoria;
end;
$$;

create or replace function cobertura_indicadores_mesa_total(p_data_referencia date)
returns table(
  ordem_bloco smallint, categoria text, categoria_descricao text,
  meta numeric, "real" numeric, percentual numeric, necessidade_dia numeric,
  pdvs bigint, num_vendedores bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sup_sheet text;
  v_sup_nome text;
begin
  select supervisor_sheet_name into v_sup_sheet from profiles where id = auth.uid();
  if v_sup_sheet is null or v_sup_sheet = '' then return; end if;
  v_sup_nome := regexp_replace(v_sup_sheet, '^Fundamentos ', '');

  return query
    select ci.ordem_bloco, ci.categoria, max(ci.categoria_descricao),
           sum(ci.meta), sum(ci.real),
           case when sum(ci.meta) > 0 then sum(ci.real) / sum(ci.meta) else null end,
           sum(ci.necessidade_dia),
           sum(ci.pdvs)::bigint, count(distinct ci.vendedor)::bigint
    from cobertura_indicadores ci
    where ci.supervisor = v_sup_nome and ci.data_referencia = p_data_referencia
    group by ci.ordem_bloco, ci.categoria;
end;
$$;

-- HEISHOP tem 3 "formatos" de linha (tipo_bloco) — padrao (Meta/Real),
-- faturamento_pedido (Fat.Total/Fat.HEISHOP/Pedidos) e devolucao
-- (Dev.Faturamento). Soma cada campo por tipo; "%" de faturamento_pedido
-- vem de Fat.HEISHOP÷Fat.Total, não de Real÷Meta (que ficam nulos nesse
-- tipo de linha); devolução não tem uma razão agregada que faça sentido
-- (mesmo critério já usado no resto do app) — fica nulo mesmo.
create or replace function heishop_indicadores_mesa_total(p_data_referencia date)
returns table(
  ordem_bloco smallint, categoria text, categoria_descricao text, tipo_bloco text,
  meta numeric, "real" numeric, percentual numeric, necessidade_dia numeric,
  fat_total numeric, fat_heishop numeric, pedidos_heishop bigint,
  dev_faturamento numeric, dev_x_fat numeric,
  pdvs bigint, num_vendedores bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sup_sheet text;
  v_sup_nome text;
begin
  select supervisor_sheet_name into v_sup_sheet from profiles where id = auth.uid();
  if v_sup_sheet is null or v_sup_sheet = '' then return; end if;
  v_sup_nome := regexp_replace(v_sup_sheet, '^Fundamentos ', '');

  return query
    select hi.ordem_bloco, hi.categoria, max(hi.categoria_descricao), max(hi.tipo_bloco),
           sum(hi.meta), sum(hi.real),
           case
             when max(hi.tipo_bloco) = 'padrao' and sum(hi.meta) > 0 then sum(hi.real) / sum(hi.meta)
             when max(hi.tipo_bloco) = 'faturamento_pedido' and sum(hi.fat_total) > 0 then sum(hi.fat_heishop) / sum(hi.fat_total)
             else null
           end,
           sum(hi.necessidade_dia),
           sum(hi.fat_total), sum(hi.fat_heishop), sum(hi.pedidos_heishop)::bigint,
           sum(hi.dev_faturamento), null::numeric,
           sum(hi.pdvs)::bigint, count(distinct hi.vendedor)::bigint
    from heishop_indicadores hi
    where hi.supervisor = v_sup_nome and hi.data_referencia = p_data_referencia
    group by hi.ordem_bloco, hi.categoria;
end;
$$;

-- Postgres concede EXECUTE em função nova pra PUBLIC por padrão — revoga
-- isso primeiro (senão até um visitante não-logado, via role "anon" do
-- Supabase, conseguiria chamar) e libera só pra quem já fez login.
revoke execute on function volume_indicadores_mesa_total(date) from public;
revoke execute on function cobertura_indicadores_mesa_total(date) from public;
revoke execute on function heishop_indicadores_mesa_total(date) from public;

grant execute on function volume_indicadores_mesa_total(date) to authenticated;
grant execute on function cobertura_indicadores_mesa_total(date) to authenticated;
grant execute on function heishop_indicadores_mesa_total(date) to authenticated;

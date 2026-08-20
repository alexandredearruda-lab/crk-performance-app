-- ============================================================================
-- REMUNERAÇÃO — importado de "Comissão e Produtividade - MM.AAAA.xlsm" (abas
-- "Painel de Pagamentos AS" e "Painel de Pagamentos MF"). Dado de
-- salário/comissão — o mais sensível do painel, por isso um controle de
-- acesso PRÓPRIO (pode_ver_remuneracao), separado do pode_ver_executivo de
-- Volumes Futuros: ver a estratégia de contas não deveria dar acesso
-- automático a quanto cada um ganha, e vice-versa.
--
-- 2 tabelas:
--   - remuneracao_resumo: 1 linha por pessoa (vendedor/supervisor/GV) — Fixo,
--     Comissão, Produtividade, Total, Pedágio, Dias Úteis/Trabalhados.
--   - remuneracao_categoria: formato longo/tidy, 1 linha por pessoa x
--     categoria de performance (~25 categorias — HL Premium, Cobertura SPIN,
--     Giro de Refrigeração etc.) com o % Real e o R$ que ela gerou de
--     comissão. Categorias diferem entre AS e MF (canais diferentes).
--
-- CPF não é importado de propósito (não precisa pra decisão de negócio, e
-- reduz a exposição de dado sensível).
--
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode UMA vez.
-- ============================================================================

alter table profiles add column if not exists pode_ver_remuneracao boolean not null default false;

create table if not exists remuneracao_resumo (
  id bigint generated always as identity primary key,
  data_referencia date not null,
  canal text not null,              -- 'AS' | 'MF'
  papel text not null,              -- 'Vendedor' | 'Supervisor/GV'
  supervisor text,
  codigo_interno text,              -- "CÓD" da planilha — id de folha de pagamento, não confundir com "setor"
  setor text,                       -- código do vendedor/supervisor, mesma convenção do resto do app
  pessoa text not null,             -- nome da pessoa (vendedor, supervisor ou GV, conforme "papel")
  dias_uteis smallint,
  dias_trab smallint,
  fixo numeric(14,2),
  comissao numeric(14,2),
  produtividade numeric(14,2),
  total numeric(14,2),
  pedagio numeric(14,2),
  criado_em timestamptz default now(),
  arquivo_origem text not null
);

create table if not exists remuneracao_categoria (
  id bigint generated always as identity primary key,
  data_referencia date not null,
  canal text not null,
  papel text not null,
  setor text,
  pessoa text not null,
  categoria text not null,
  ordem_bloco smallint not null,
  real_pct numeric(10,4),
  valor_r numeric(14,2),
  criado_em timestamptz default now(),
  arquivo_origem text not null
);

create index if not exists idx_remun_resumo_data on remuneracao_resumo (data_referencia);
create index if not exists idx_remun_resumo_pessoa on remuneracao_resumo (pessoa);
create index if not exists idx_remun_cat_data on remuneracao_categoria (data_referencia);
create index if not exists idx_remun_cat_pessoa on remuneracao_categoria (pessoa);

alter table remuneracao_resumo enable row level security;
alter table remuneracao_categoria enable row level security;

create policy "remuneracao_resumo: acesso restrito" on remuneracao_resumo
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid()
      and (p.role = 'admin' or p.pode_ver_remuneracao = true)));

create policy "remuneracao_categoria: acesso restrito" on remuneracao_categoria
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid()
      and (p.role = 'admin' or p.pode_ver_remuneracao = true)));

-- ============================================================================
-- PRÓXIMO PASSO: rodar scripts/import_remuneracao.js (Node.js) pra carregar
-- os dados das abas "Painel de Pagamentos AS" e "Painel de Pagamentos MF".
-- ============================================================================

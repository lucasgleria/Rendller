-- Batimento contra a pausa do plano Free (substitui o ping() no workflow manter-supabase.yml).
-- O ping() (select 1) rodou a cada 3 dias e o projeto foi pausado mesmo assim em 11/2026: uma consulta que não
-- toca em tabela não parece contar como atividade. O batimento grava de verdade numa linha única, sem dado do
-- usuário. A tabela fica no schema `private`, fora da Data API; só a função (security definer) escreve nela.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.batimento (
  id smallint primary key check (id = 1),
  em timestamptz not null,
  contagem bigint not null
);

revoke all on table private.batimento from public, anon, authenticated;

create or replace function public.batimento()
returns timestamptz
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.batimento as b (id, em, contagem)
  values (1, now(), 1)
  on conflict (id) do update set em = now(), contagem = b.contagem + 1
  returning b.em
$$;

revoke execute on function public.batimento() from public, authenticated;
grant execute on function public.batimento() to anon;

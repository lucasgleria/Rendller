-- Cofre cifrado da conta (ADR-0002 e ADR-0003).
-- O servidor guarda só o envelope AES-GCM (iv + cifrado); a chave nasce da frase-senha no navegador.
-- Uma linha por conta, protegida por RLS com auth.uid(). O controle de versão (gravar_cofre) impede que
-- duas gravações simultâneas se sobrescrevam, como o ETag do cofre antigo.

create table if not exists public.cofres (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  versao integer not null check (versao > 0),
  iv text not null check (length(iv) <= 64),
  cifrado text not null check (length(cifrado) <= 4000000),
  atualizado_em timestamptz not null default now()
);

alter table public.cofres enable row level security;

-- Ninguém sem sessão acessa a tabela. Projetos novos não expõem tabelas à Data API por padrão:
-- o acesso de quem está logado é concedido explicitamente, e a RLS limita à própria linha.
revoke all on table public.cofres from anon, public;
grant select, insert, update, delete on table public.cofres to authenticated;

create policy "cofres: dono lê" on public.cofres
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "cofres: dono cria" on public.cofres
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "cofres: dono altera" on public.cofres
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "cofres: dono apaga" on public.cofres
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Grava o envelope sobre a versão `base` que o aparelho conhece.
-- base = 0: cria (insert ... on conflict do nothing). base > 0: atualiza só se a versão atual for `base`.
-- Se nada mudou, devolve a versão atual (0 se não há linha) com conflito = true. Cada caso é uma única
-- instrução, então duas gravações simultâneas nunca se sobrescrevem.
create or replace function public.gravar_cofre(base integer, p_iv text, p_cifrado text)
returns table (versao integer, conflito boolean)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  nova integer;
begin
  if uid is null then
    raise exception 'sem sessão' using errcode = '42501';
  end if;
  if base is null or base < 0 then
    raise exception 'base inválida' using errcode = '22023';
  end if;

  if base = 0 then
    insert into public.cofres as c (user_id, versao, iv, cifrado, atualizado_em)
    values (uid, 1, p_iv, p_cifrado, now())
    on conflict (user_id) do nothing
    returning c.versao into nova;
  else
    update public.cofres as c
       set versao = base + 1, iv = p_iv, cifrado = p_cifrado, atualizado_em = now()
     where c.user_id = uid and c.versao = base
    returning c.versao into nova;
  end if;

  if nova is not null then
    return query select nova, false;
  else
    return query select coalesce((select c.versao from public.cofres as c where c.user_id = uid), 0), true;
  end if;
end;
$$;

revoke execute on function public.gravar_cofre(integer, text, text) from public, anon;
grant execute on function public.gravar_cofre(integer, text, text) to authenticated;

-- Consulta leve para manter o projeto ativo (Fase 6). Não lê dado nenhum.
create or replace function public.ping()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$ select 1 $$;

grant execute on function public.ping() to anon, authenticated;

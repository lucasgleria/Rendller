-- Verificação manual da migração 20261101000000_cofres.sql (Passo 2 do plano), no SQL Editor do Supabase.
-- Rode DEPOIS de aplicar a migração. Tudo roda numa transação desfeita no fim (rollback): nada fica gravado.
--
-- Antes de rodar, troque:
--   <UUID_A> pelo id da SUA conta (Authentication → Users → copie o "User UID");
--   <UUID_B> por qualquer outro uuid (ex.: 00000000-0000-0000-0000-000000000002); ele só lê.
--
-- Rode um bloco por vez e compare com o "esperado".

-- Bloco 1: gravações como a conta A ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<UUID_A>","role":"authenticated"}';

select * from public.gravar_cofre(0, 'iv-teste', 'cifrado-1');
-- esperado: versao = 1, conflito = false

select * from public.gravar_cofre(0, 'iv-teste', 'cifrado-2');
-- esperado: versao = 1, conflito = true   (já existe; nada é sobrescrito)

select * from public.gravar_cofre(1, 'iv-teste', 'cifrado-3');
-- esperado: versao = 2, conflito = false

select * from public.gravar_cofre(1, 'iv-teste', 'cifrado-4');
-- esperado: versao = 2, conflito = true   (base atrasada)

select * from public.gravar_cofre(9, 'iv-teste', 'cifrado-5');
-- esperado: versao = 2, conflito = true   (base maior que a atual)

select versao, cifrado from public.cofres;
-- esperado: 1 linha, versao = 2, cifrado = 'cifrado-3'

-- a conta B não enxerga a linha da conta A
set local request.jwt.claims = '{"sub":"<UUID_B>","role":"authenticated"}';
select count(*) from public.cofres;
-- esperado: 0

delete from public.cofres;
-- esperado: DELETE 0 (a RLS não deixa B apagar a linha de A)

rollback;

-- Bloco 2: sem sessão (papel anon) -----------------------------------------------------------------
begin;
set local role anon;
select * from public.cofres;
-- esperado: ERROR 42501 permission denied for table cofres
rollback;

-- Bloco 3: anon não grava ------------------------------------------------------------------------
begin;
set local role anon;
select * from public.gravar_cofre(0, 'iv', 'x');
-- esperado: ERROR 42501 permission denied for function gravar_cofre
rollback;

-- Bloco 4: ping funciona sem sessão --------------------------------------------------------------
begin;
set local role anon;
select public.ping();
-- esperado: 1
rollback;

-- Bloco 5: conferir RLS e grants -----------------------------------------------------------------
select relrowsecurity from pg_class where oid = 'public.cofres'::regclass;
-- esperado: true

select grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'cofres' and grantee in ('anon', 'authenticated')
 order by grantee, privilege_type;
-- esperado: só authenticated com DELETE, INSERT, SELECT, UPDATE; nenhuma linha de anon

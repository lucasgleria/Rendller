-- Verificação manual da migração 20261101000000_cofres.sql (Passo 2 do plano), no SQL Editor do Supabase.
--
-- COMO LER O RESULTADO: só vale o "OK: …" ou "FALHOU: …" de cada bloco (aba de mensagens/notices).
--   * Cada bloco é um único `do $$ … $$`. Se ele mostrar "OK: <nome>", passou.
--   * Se aparecer um erro "FALHOU: <o que deu errado>", aquele caso falhou; pare e avise.
--   * Qualquer outro erro (ex.: sintaxe, uuid inválido) também é falha da verificação.
--
-- ANTES DE RODAR, troque em todo o arquivo (Localizar e substituir):
--   <UUID_A> pelo id da SUA conta, que PRECISA existir em auth.users
--            (Authentication → Users → copie o "User UID");
--   <UUID_B> por qualquer outro uuid, ex.: 00000000-0000-0000-0000-00000000000b.
--            B NÃO precisa existir: ele só lê, tenta alterar a linha de A e chama gravar_cofre com base 1
--            (caminho de update, que não insere). O insert de B usa o user_id de A, que existe, então a chave
--            estrangeira não interfere: quem barra é a RLS (42501).
--
-- SEM LIXO: cada bloco faz tudo dentro de um sub-bloco que termina levantando a exceção controlada
-- 'RB001'; o tratador dela desfaz o sub-bloco inteiro (linhas gravadas e `set_config` de papel e claims) e só
-- então o bloco escreve o "OK". Um "FALHOU" também aborta o bloco e desfaz tudo. Nada fica na tabela.
-- O papel e o usuário são trocados com set_config('role', …, true) e set_config('request.jwt.claims', …, true),
-- que valem só dentro da transação/sub-bloco.

-- Bloco 1: A cria, repete e grava sobre a versão 1 (passa pelo trigger de versão) --------------------------
do $$
declare
  v record;
begin
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', '{"sub":"<UUID_A>","role":"authenticated"}', true);

    select * into v from public.gravar_cofre(0, 'iv-a', 'cifrado-1');
    if v.versao <> 1 or v.conflito then raise exception 'FALHOU: criar deveria dar (1,false), deu (%,%)', v.versao, v.conflito; end if;

    select * into v from public.gravar_cofre(0, 'iv-a', 'cifrado-2');
    if v.versao <> 1 or not v.conflito then raise exception 'FALHOU: repetir deveria dar (1,true), deu (%,%)', v.versao, v.conflito; end if;

    select * into v from public.gravar_cofre(1, 'iv-a', 'cifrado-3');
    if v.versao <> 2 or v.conflito then raise exception 'FALHOU: gravar sobre a 1 deveria dar (2,false), deu (%,%)', v.versao, v.conflito; end if;

    select * into v from public.gravar_cofre(1, 'iv-a', 'cifrado-4');
    if v.versao <> 2 or not v.conflito then raise exception 'FALHOU: base atrasada deveria dar (2,true), deu (%,%)', v.versao, v.conflito; end if;

    select * into v from public.gravar_cofre(9, 'iv-a', 'cifrado-5');
    if v.versao <> 2 or not v.conflito then raise exception 'FALHOU: base maior deveria dar (2,true), deu (%,%)', v.versao, v.conflito; end if;

    select versao, cifrado into v from public.cofres where user_id = '<UUID_A>';
    if v.versao <> 2 or v.cifrado <> 'cifrado-3' then raise exception 'FALHOU: a linha de A deveria estar em (2, cifrado-3), está em (%, %)', v.versao, v.cifrado; end if;

    raise exception using errcode = 'RB001', message = 'desfazer';
  exception when sqlstate 'RB001' then
    null; -- tudo desfeito
  end;
  raise notice 'OK: bloco 1 (A cria, conflito, versão 2)';
end
$$;

-- Bloco 2: B não vê, não insere, não altera e não grava por cima da linha de A -----------------------------
do $$
declare
  v record;
  n integer;
begin
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', '{"sub":"<UUID_A>","role":"authenticated"}', true);
    perform public.gravar_cofre(0, 'iv-a', 'cifrado-1');
    perform public.gravar_cofre(1, 'iv-a', 'cifrado-2'); -- A fica na versão 2

    perform set_config('request.jwt.claims', '{"sub":"<UUID_B>","role":"authenticated"}', true);

    select count(*) into n from public.cofres;
    if n <> 0 then raise exception 'FALHOU: B enxerga % linha(s)', n; end if;

    begin
      insert into public.cofres (user_id, versao, iv, cifrado) values ('<UUID_A>', 1, 'iv-b', 'invasor');
      raise exception 'FALHOU: B conseguiu inserir com o user_id de A';
    exception when insufficient_privilege then
      null; -- 42501, como esperado
    end;

    update public.cofres set cifrado = 'invasor', user_id = '<UUID_B>', versao = versao + 1 where user_id = '<UUID_A>';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FALHOU: B alterou % linha(s) de A', n; end if;

    delete from public.cofres where user_id = '<UUID_A>';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FALHOU: B apagou % linha(s) de A', n; end if;

    select * into v from public.gravar_cofre(1, 'iv-b', 'invasor');
    if v.versao <> 0 or not v.conflito then raise exception 'FALHOU: gravar_cofre(1) de B deveria dar (0,true), deu (%,%)', v.versao, v.conflito; end if;

    perform set_config('request.jwt.claims', '{"sub":"<UUID_A>","role":"authenticated"}', true);
    select versao, cifrado into v from public.cofres where user_id = '<UUID_A>';
    if v.versao is distinct from 2 or v.cifrado is distinct from 'cifrado-2' then
      raise exception 'FALHOU: a linha de A deveria estar intacta em (2, cifrado-2), está em (%, %)', v.versao, v.cifrado;
    end if;

    raise exception using errcode = 'RB001', message = 'desfazer';
  exception when sqlstate 'RB001' then
    null;
  end;
  raise notice 'OK: bloco 2 (RLS isola B da linha de A)';
end
$$;

-- Bloco 3: update direto fora da sequência falha no trigger -------------------------------------------------
do $$
begin
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', '{"sub":"<UUID_A>","role":"authenticated"}', true);
    perform public.gravar_cofre(0, 'iv-a', 'cifrado-1');

    begin
      update public.cofres set versao = 999 where user_id = '<UUID_A>';
      raise exception 'FALHOU: update direto com versao = 999 passou';
    exception when check_violation then
      null; -- 23514 do trigger, como esperado
    end;

    begin
      update public.cofres set versao = versao + 1, user_id = '<UUID_B>' where user_id = '<UUID_A>';
      raise exception 'FALHOU: trocar o dono da linha passou';
    exception when insufficient_privilege then
      null; -- 42501 (trigger ou RLS), como esperado
    end;

    raise exception using errcode = 'RB001', message = 'desfazer';
  exception when sqlstate 'RB001' then
    null;
  end;
  raise notice 'OK: bloco 3 (trigger de versão e de dono)';
end
$$;

-- Bloco 4: sem sessão (anon) não acessa a tabela nem gravar_cofre ------------------------------------------
do $$
begin
  begin
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);

    begin
      perform count(*) from public.cofres;
      raise exception 'FALHOU: anon leu a tabela cofres';
    exception when insufficient_privilege then
      null;
    end;

    begin
      perform public.gravar_cofre(0, 'iv', 'x');
      raise exception 'FALHOU: anon chamou gravar_cofre';
    exception when insufficient_privilege then
      null;
    end;

    raise exception using errcode = 'RB001', message = 'desfazer';
  exception when sqlstate 'RB001' then
    null;
  end;
  raise notice 'OK: bloco 4 (anon sem acesso)';
end
$$;

-- Bloco 5: anon chama ping() -------------------------------------------------------------------------------
do $$
declare
  r integer;
begin
  begin
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    r := public.ping();
    if r is distinct from 1 then raise exception 'FALHOU: ping() devolveu %', r; end if;
    raise exception using errcode = 'RB001', message = 'desfazer';
  exception when sqlstate 'RB001' then
    null;
  end;
  raise notice 'OK: bloco 5 (ping para anon)';
end
$$;

-- Bloco 6: RLS ligada, grants e trigger no lugar (só leitura do catálogo) ----------------------------------
do $$
declare
  n integer;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.cofres'::regclass) then
    raise exception 'FALHOU: RLS desligada em public.cofres';
  end if;
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'cofres' and grantee = 'anon';
  if n <> 0 then raise exception 'FALHOU: anon tem % privilégio(s) em cofres', n; end if;
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'cofres' and grantee = 'authenticated'
     and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  if n <> 4 then raise exception 'FALHOU: authenticated deveria ter SELECT, INSERT, UPDATE e DELETE (tem %)', n; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.cofres'::regclass and tgname = 'cofres_versao_sequencial') then
    raise exception 'FALHOU: trigger cofres_versao_sequencial ausente';
  end if;
  raise notice 'OK: bloco 6 (RLS, grants e trigger)';
end
$$;

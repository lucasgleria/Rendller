# Conta no Supabase: configuração manual

Roteiro único para ligar a conta do Rendller (ADR-0002 e ADR-0003). O app só mostra "Entrar com conta" quando o build tem `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. A conta só identifica; a frase-senha cifra a carteira no navegador, e o Supabase guarda só conteúdo ilegível.

## 1. Projeto

1. Em supabase.com, crie um projeto no plano **Free**, região **South America (São Paulo)**.
2. Guarde a senha do banco num gerenciador de senhas. O app não usa essa senha.

## 2. Auth

1. Em **Authentication → Sign In / Providers → Email**, deixe o provedor de e-mail ligado.
2. Na mesma tela, **desligue "Allow new users to sign up"**. O app é de um usuário só, não tem tela de cadastro, e isso protege a cota.
3. Em **Authentication → Users → Add user → Create new user**, crie a sua conta com e-mail e senha e marque **Auto Confirm User**. Copie o **User UID**, que será usado na verificação.
4. Em **Authentication → URL Configuration**, configure:
   - **Site URL:** `https://rendller.netlify.app`;
   - **Redirect URLs:** `https://rendller.netlify.app/**` e `http://localhost:5173/**`.

## 3. E-mail de recuperação de senha

Em **Authentication → Emails → Templates → Reset password**, troque o link do corpo por:

```
{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=recovery
```

Por que trocar: o app confirma o link com `verifyOtp` e limpa a URL em seguida, então nenhum token fica no histórico do navegador. O link padrão poria os tokens no fragmento da URL.

**Se o plano Free bloquear a edição do template:** projetos novos com o SMTP padrão podem não permitir templates personalizados (changelog de 03/06/2026). Nesse caso há duas saídas:
- configurar um SMTP próprio em **Authentication → Emails → SMTP Settings** e então editar o template;
- não usar "Esqueci a senha" no app e trocar a senha da conta pelo painel (**Authentication → Users → … → Reset password** ou editar o usuário).

O SMTP padrão manda poucos e-mails por hora e só para membros da equipe do projeto.

## 4. Banco

1. Em **SQL Editor**, cole e rode `supabase/migrations/20261101000000_cofres.sql`. Ele pode ser reaplicado sem erro.
2. Abra `supabase/verificacao.sql` e troque:
   - `<UUID_A>` pelo User UID da sua conta;
   - `<UUID_B>` por qualquer outro uuid, por exemplo `00000000-0000-0000-0000-00000000000b`.
3. Rode o arquivo inteiro. **Só vale se aparecerem os 6 "OK: …"** e nenhum "FALHOU: …" ou outro erro. A verificação não deixa dados na tabela.

## 5. Chaves e variáveis

1. Em **Settings → API Keys**, copie a **Project URL** e a **publishable key** (`sb_publishable_…`). Nunca use a secret key nem a `service_role` no app.
2. No Netlify, em **Site configuration → Environment variables**, crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` e faça um novo deploy.
3. Para desenvolver, copie `.env.example` para `.env.local` (que não é commitado), preencha e rode `npm run dev`.

## 6. Conferência

Faça a conferência em **perfis de navegador limpos**, sem dados nem sincronização antiga:
1. Entre com a conta e digite uma frase-senha.
2. Edite num perfil e veja a mudança no outro.
3. Edite nos dois sem internet e veja a tela de conflito.
4. Teste uma frase errada: deve aparecer "Frase-senha diferente da usada nesta conta".
5. Teste "Esqueci a senha da conta":
   - o link abre o app com a URL limpa e a tela de nova senha;
   - o mesmo link aberto de novo mostra "Link de recuperação vencido ou já usado; peça outro".

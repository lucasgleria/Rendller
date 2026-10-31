---
status: accepted
data: 2026-10-31
---

# Criptografia de ponta a ponta continua: a conta identifica, a frase-senha cifra

Com a conta no Supabase, a carteira continua cifrada no navegador (AES-GCM) antes de sair do aparelho. O Supabase guarda só conteúdo ilegível. A **senha da conta** serve apenas para entrar e autorizar o acesso à linha da conta. A **frase-senha** continua sendo a origem da chave e nunca sai do navegador. A chave é derivada assim: PBKDF2 da frase-senha, com sal ligado ao id da conta, seguido de HKDF. O id da conta também entra como dado autenticado no AES-GCM.

## Considered Options

- **Dados em claro no banco, protegidos só por login e RLS:** permitiria recuperar a carteira pela conta e fazer consultas no servidor, mas o provedor passaria a poder ler a carteira. Foi rejeitado.
- **Derivar a chave da própria senha da conta:** rejeitado. O Supabase recebe essa senha no login, então a cifra deixaria de ser de ponta a ponta.

## Consequences

- O usuário tem **dois segredos**: a senha da conta (recuperável por e-mail) e a frase-senha (sem recuperação). Esquecer a frase-senha significa perder os dados da nuvem; o backup `.json` continua necessário.
- A frase-senha pode ser a mesma do cofre antigo. Mesmo assim, a chave muda, porque o sal agora inclui o id da conta. Um conteúdo cifrado por uma conta não decifra em outra.
- O CLAUDE.md continua valendo: nunca pedir, registrar nem enviar a frase-senha ou a chave derivada.

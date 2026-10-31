---
status: accepted
data: 2026-10-31
---

# Conta com Supabase Auth e dados no Postgres do Supabase (plano Free)

Para ter os mesmos dados em qualquer aparelho com **login por conta** e **custo zero**, o Rendller passa a usar o **Supabase Auth** (e-mail e senha) e guardar o conteúdo cifrado da carteira numa tabela do **Postgres do Supabase**. O acesso é protegido por Row Level Security (cada linha só é visível pela conta dona dela). O site continua publicado no Netlify. Foi escolha do usuário, preferindo um login maduro e um banco relacional a ficar tudo dentro do Netlify.

## Considered Options

- **Netlify Identity + Blobs:** tudo no plano atual, sem conta em terceiro e sem pausa por inatividade. O Identity voltou a ser suportado em 19/02/2026. Contra: o teto de 300 créditos/mês do Netlify Free pausa o site inteiro quando acaba.
- **Manter o cofre por frase-senha e adicionar passkeys (PRF):** grátis e sem conta, mas o suporte ainda é desigual. No Windows, por exemplo, só funciona com a atualização de fev/2026.

## Consequences

Fatos do plano Free pesquisados em 31/10/2026 (podem mudar; confira em supabase.com/pricing):

- **Pausa:** o projeto pausa depois de 7 dias de pouca atividade e pode ser restaurado pelo painel em até 1 ano. Mitigação: um workflow agendado no GitHub Actions faz uma consulta leve a cada 3 dias. O app continua funcionando com o `localStorage` enquanto o projeto estiver pausado.
- **Backup:** o Free não tem backup automático. O backup `.json` do app continua sendo a garantia.
- **E-mail embutido:** 2 e-mails por hora, entregues só para membros da equipe do projeto. Serve para um único usuário que é dono do projeto. Mais usuários exigiriam SMTP próprio.
- **Passkeys do Supabase:** em beta e só para contas já existentes, por isso ficam fora por ora.
- A URL do projeto e a chave publicável entram no build como variáveis `VITE_*`. Elas são públicas por desenho, e a proteção vem da RLS.
- O cofre antigo (`/api/cofre` no Netlify Blobs) é mantido só para leitura durante a migração e desligado numa fase própria, depois da confirmação do usuário.

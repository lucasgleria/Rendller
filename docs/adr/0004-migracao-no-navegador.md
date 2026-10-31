---
status: accepted
data: 2026-10-31
---

# Migração para a conta feita no navegador, sem apagar nada

Os dados atuais saem de três lugares: `localStorage`, backups `.json` e o cofre antigo no Netlify. Eles são migrados **pelo próprio app, no navegador**, quando o usuário entra na conta pela primeira vez num aparelho. Antes de gravar na conta, o app baixa um backup `.json` automático e guarda uma cópia local. Depois converte tudo para `Dados` versão 2. O **cofre antigo não é apagado**: só é desligado neste aparelho, e o usuário o apaga à mão quando quiser. Escolhemos o navegador porque só ele tem a chave do cofre antigo e a frase-senha. Um script no servidor não conseguiria ler nada sem quebrar a criptografia de ponta a ponta (ADR-0003).

## Considered Options

- **Só por backup `.json` manual:** mais simples, mas depende de o usuário lembrar de exportar e ignora o cofre antigo.

## Consequences

- A leitura de `Dados` versão 1 (`localStorage`, backups e conteúdo do cofre antigo) é permanente. `migrarDados()` aceita v1 e v2 para sempre.
- Se a conta já tiver dados diferentes dos dados locais, a migração não sobrescreve nada: abre a mesma escolha de conflito da sincronização atual.
- Um aparelho com a versão antiga do app que receba dados v2 recusa a leitura em vez de sobrescrever.

# Contribuições

**Não estamos aceitando pull requests.** Este repositório é compartilhado como uma contribuição, no
estado em que se encontra ("as is"). Não há intenção nem compromisso de oferecer suporte, responder
dúvidas, corrigir problemas ou fazer melhorias; qualquer atualização acontece apenas por nossa própria
liberalidade, quando e se quisermos.

Você é bem-vindo para usar, estudar e adaptar o Corgi para uso não comercial, dentro da
[licença](LICENSE), no seu próprio fork.

*We are not accepting pull requests. This repository is shared as a contribution, as is, with no
intention or commitment to provide support, fixes or improvements; any update happens solely at our
own discretion. You are welcome to use and adapt it for noncommercial purposes under the
[license](LICENSE), in your own fork.*

## Se você for adaptar no seu fork

1. Node 24 LTS e pnpm 11.19.0.
2. `pnpm install --frozen-lockfile`, depois `pnpm corgi:setup` (cria o `.env`).
3. `pnpm dev` e, em outro terminal, `pnpm dev:web` (e `pnpm dev:browser` para o navegador do assistente).
4. Nunca commite `.env`, `.openmuse`, perfis do navegador, credenciais ou documentos pessoais.

Antes de publicar suas mudanças:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build:server
pnpm build:web
(cd apps/worker && npx tsc --noEmit)
```

Os testes usam só dados locais: sem rede, sem contas reais. Cada pasta importante tem um `AGENTS.md`
com as regras dela; comece pelo [AGENTS.md](AGENTS.md) da raiz.

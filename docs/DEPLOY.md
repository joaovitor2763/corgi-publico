# Deploy: Corgi numa VPS (recomendado) ou num Mac mini + iPhone

## Recomendado: uma VPS (ex.: Hostinger, DigitalOcean)

Os valores abaixo são o formato; os seus ficam no seu `~/.ssh/config` e na sua tailnet.

| | |
| --- | --- |
| URL (só na sua tailnet) | `https://<nome-da-máquina>.<sua-tailnet>.ts.net` (Tailscale Serve) |
| SSH | `ssh corgi-vps` (alias em `~/.ssh/config`, via Tailscale; senha desligada, só chave). Outro nome: `CORGI_SSH=meu-host deploy/vps/remote.sh …` |
| Serviços | `corgi-server`, `corgi-worker`, `corgi-backup.timer` (systemd, usuário `corgi`) |
| Código | `/home/corgi/corgi`, puxado do GitHub com chave de deploy só leitura |
| Backups | todo dia 03:30 em `/home/corgi/backups` (14 últimos) |

**Fluxo de trabalho:** o Corgi do seu Mac é só para testes (`TASK_WORKER_ENABLED=false`: rotinas e
ideias não rodam em dobro). Testou, fez commit e push → `deploy/vps/remote.sh update`.
`deploy/vps/remote.sh status` mostra serviços, saúde e logs. Setup do zero: `deploy/vps/setup.sh`
(Ubuntu 24.04, como root, ver `deploy/vps/AGENTS.md`).

**No celular sem o app nativo:** Tailscale ligado → Safari → a URL acima → cole a chave de acesso
(`OPENMUSE_ACCESS_KEY` do `.env` da VPS) → Compartilhar → Adicionar à Tela de Início.

---

# Alternativa: Mac mini + iPhone

Corgi roda 24h num Mac mini em casa e você usa pelo iPhone de qualquer lugar, por uma rede
privada (Tailscale). Nada fica exposto na internet.

```
iPhone (app Corgi ou atalho web)  ──Tailscale (HTTPS, só seus aparelhos)──▶  Mac mini
                                                                             ├─ tailscale serve :443 → 127.0.0.1:8787
                                                                             ├─ servidor Corgi (API + app web, launchd)
                                                                             ├─ worker do navegador (Chromium, launchd)
                                                                             └─ backup diário 03:30 → ~/CorgiBackups
```

Por que o Mac mini: IP residencial brasileiro (lojas como iFood e Mercado Livre bloqueiam menos
que IP de datacenter), custo zero e o Xcode ali mesmo para o app nativo.

## 1. No Mac mini (uma vez, ~15 min)

1. **Tailscale**: instale em https://tailscale.com/download/mac, faça login. No
   [painel de DNS](https://login.tailscale.com/admin/dns) ative **MagicDNS** e **HTTPS Certificates**.
2. **Login automático** (Ajustes → Usuários e Grupos): os serviços rodam na sua sessão de usuário
   e sobem sozinhos depois de uma queda de energia.
3. **Código e configuração**:
   ```sh
   git clone <url-do-seu-repositório> ~/corgi
   cd ~/corgi
   # copie o .env do seu outro Mac (chaves IMPOSSIBL_API_KEY, COMPOSIO_API_KEY, AGENT_BACKEND=pi...)
   deploy/macmini/setup.sh
   ```
   O `setup.sh` instala dependências e o Chromium, completa o `.env` sem sobrescrever o que existe
   (gera `OPENMUSE_ACCESS_KEY` e `WORKER_TOKEN` se faltarem, fixa `HOST=127.0.0.1` e
   `PUBLIC_API_URL=https://<mac-mini>.<tailnet>.ts.net`), compila, instala os serviços `launchd`,
   desliga o repouso (pede sua senha), liga o `tailscale serve` e mostra a URL e a chave.

   Seus dados do outro Mac (memórias, tarefas, regras) ficam em `.openmuse/`. Para levar junto,
   copie essa pasta antes de rodar o setup; sem isso, o Corgi começa vazio e você reconecta os apps.

## 2. No iPhone

- Instale **Tailscale** (App Store) e entre com a mesma conta.
- **Atalho web** (1 minuto): abra a URL no Safari → Compartilhar → **Adicionar à Tela de Início**.
  Abre em tela cheia com o ícone do Corgi. Digite a chave de acesso uma vez; ela fica salva.
- **App nativo** (opcional): conecte o iPhone ao Mac mini (cabo ou mesma rede, Modo de
  Desenvolvedor ligado) e rode:
  ```sh
  APPLE_TEAM_ID=<seu-time> deploy/macmini/ios.sh https://<mac-mini>.<tailnet>.ts.net
  ```
  O time aparece no Xcode (Settings → Accounts). Time pago: o app dura 1 ano; Personal Team
  (gratuito): 7 dias. A URL é só o valor inicial: o **servidor pode ser trocado na tela de login**
  (Mac de teste hoje, Mac mini ou VPS amanhã) sem recompilar. Chave e servidor ficam no Keychain.

## Dia a dia

| Quero… | Comando (no Mac mini, em `~/corgi`) |
| --- | --- |
| Ver se está tudo no ar | `deploy/macmini/status.sh` |
| Atualizar para o último código | `deploy/macmini/update.sh` |
| Fazer backup agora | `deploy/macmini/backup.sh` |
| Ver logs | `tail -f ~/Library/Logs/Corgi/server.log` |
| Trocar a chave de acesso | editar `OPENMUSE_ACCESS_KEY` no `.env` e `update.sh` |

Restaurar um backup: pare os serviços (`launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.corgi.server.plist`),
`tar -xzf ~/CorgiBackups/corgi-<data>.tgz -C ~/corgi` e rode `update.sh`.

## Segurança

- O servidor escuta só em `127.0.0.1`; quem chega de fora é o `tailscale serve`, só para aparelhos
  da sua tailnet, com HTTPS.
- Mesmo assim, `OPENMUSE_ACCESS_KEY` é exigida (em qualquer modo, desde que configurada). Sem
  chave, o modo local se recusa a sair do loopback.
- Os backups incluem o `.env` (suas chaves): ficam com permissão `600` em `~/CorgiBackups`. Se
  mover para iCloud ou outro disco, trate como segredo.
- Não use `tailscale funnel` (isso publicaria o Corgi na internet).

## Limites conhecidos

- Sem notificação push: rotinas rodam no Mac mini, e o resultado aparece quando você abre o app.
- Queda de luz ou internet em casa deixa o Corgi fora do ar até voltar (o Mac religa sozinho).
- Lojas podem pedir verificação anti-robô; use **Take control** no app para passar.

# Notifications on the phone (Web Push)

Corgi calls the person on their phone when something needs them, with the home-screen web app
(no native app, no Apple developer account).

## Requirements

- iPhone/iPad on iOS 16.4+, Corgi **added to the Home Screen** (Safari › Compartilhar ›
  Adicionar à Tela de Início) and opened from its icon.
- Permission is asked only on a tap: Menu › **Notificações** › Ativar (or the invitation card
  at the top of Atividade).
- Delivery goes server → Apple's push service → phone: it works without Tailscale. Opening
  the notification loads the app from the server, so Tailscale must be on (as always).

## What calls the person

Every **new** notification the server records becomes a push (`AgentService.notify` →
`push/push.ts` `pushFor`), one kind at a time, each switchable in the Notificações screen:

| Kind | When | Tap opens |
| --- | --- | --- |
| Aprovações | A task prepared a change that waits on Permitir | The task's conversation, with the card |
| Perguntas | A task needs an answer | The task's conversation |
| Tarefas concluídas | A background task finished | The task's conversation |
| Problemas | A task could not finish | The task |

The same task's newer news replaces its older notification (`tag`). The app icon shows how
many things wait on the person (questions and reviews), set by the push and by the app.

## How it works

- `apps/server/src/push/push.ts`: `PushService` makes the VAPID keys on first use and keeps them
  in the store (`system/push-vapid`), keeps each device's subscription (`push-subscriptions`),
  the person's choices (`agent-settings/push`), and forgets a device the phone dropped (404/410).
- `apps/server/src/push/routes.ts`: `GET /api/push` (key, choices, devices, waiting count),
  `POST /subscribe`, `/unsubscribe`, `PUT /prefs`, `POST /test`.
- `apps/mobile/public/sw.js`: the service worker shows the push, sets the icon badge and, on a
  tap, focuses the app and tells it what to open (or opens `/?open=task:…`).
- `apps/mobile/src/shared/push.web.ts`: state (needs install / off / on / blocked), turning it
  on (permission on a tap → subscribe with the server key), and opening what a tap points to.
- UI: `features/settings/push-sheet.tsx` (the screen) and `push-invite.tsx` (the card).

## Testing

`tests/push.test.ts` covers subscribing, sending with the waiting count, choices and dropped
devices. On the phone: Notificações › Enviar um teste.

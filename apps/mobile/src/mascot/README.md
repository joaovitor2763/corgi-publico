# Regi — the mascot

Regi is drawn from pre-rendered 2D clips (`assets/regi/`, made offline by `tools/mascot`).

- `RegiClipPlayer.tsx`: plays a clip (enter, idle beats, laptop while working) from `regi-clips.ts`.
- `agent-avatar.tsx`: the header avatar (round frame), picks the expression from the live status
  (`RegiSprite.tsx` `useRegiMood`, poses in `regi-poses.ts`).
- `RegiHero.tsx`: the large Regi on an empty chat. `RegiGallery.tsx`: every mood, on web `/regi`.

The 3D playground (three.js) was removed; the art pipeline in `tools/mascot` still has the model.

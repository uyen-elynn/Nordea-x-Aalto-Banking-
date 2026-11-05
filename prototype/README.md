# Information flow prototype

A clickable prototype that shows how a customer's information travels, and how updates come back:

```
You → Abel (your agent) → Context Cabinet → Nordea's agent → Kalle (private banker)
                              ↑                                     │
                              └──── suggested updates: Accept / Edit / Delete ┘
```

It uses the main app's design (same styles, fonts, header, cards and chat) but has its own
scripted data, so it needs no AI key, no database and no server. It does not change any file
of the main app.

## Run it

From the project folder (after `npm install`):

```bash
npx vite --config prototype/vite.config.ts
```

Then open http://localhost:3001. The main app (`npm run dev`, port 3000) can run at the same time.

## What you can try

The dark panel beside the phone runs the story step by step:

1. **Tell Abel by voice.** Lauri says the flat deposit goes up to 35 000 €. Abel proposes the change and asks: save and share with Nordea, save only for me, edit first, or don't save.
2. **Look in the Context Cabinet.** Items are grouped into "Shared with Nordea" and "Only you". Tap one to see its path, change sharing, edit or delete it, and see who used it.
3. **Kalle prepares the meeting.** Nordea's agent writes pre-meeting notes from shared items only. Each read is logged on the item.
4. **Meeting: a sudden question.** Kalle needs a private item to answer. Lauri chooses: this meeting only, share from now on, or not now.
5. **After the meeting.** Notes drafted by the AI recorder and checked by Kalle arrive for Accept / Edit / Delete.
6. **Nordea's agent suggests an update.** It waits for Lauri like any other update.

Colours follow the main app: green means from the customer, orange means from the Nordea side.

## Files

- `FlowApp.tsx`: screens, scripted data and the story steps
- `proto.css`: the few styles the main app doesn't have (flow trace, meeting screen, edit sheet)
- `vite.config.ts`, `index.html`, `main.tsx`: a separate entry that reuses `../src/index.css` and `../public`

Build a static copy with `npx vite build --config prototype/vite.config.ts` (output in `dist-prototype/`).

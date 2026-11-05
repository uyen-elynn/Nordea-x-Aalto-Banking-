# Information flow: customer → Nordea's agent → adviser, and back

This branch adds the flow on top of the full app:

```
You → Abel (your agent) → Context Cabinet → Nordea's agent → Kalle (private banker)
          ↑                                                        │
          └──── updates from Kalle, Nordea's agent or the AI recorder: Accept / Edit / Delete
```

## Run it

Same as the main app: `npm run dev`, then open http://localhost:3000. The adviser screen shows
next to the phone (hide it with **Hide adviser screen** at the top). No AI key is needed for the
flow itself: it uses the cabinet and scripted adviser steps.

## Demo story (Lauri and Kalle)

1. **Adviser screen → Demo controls → "Lauri keeps the travel goal private".** The Japan trip
   becomes "Only you".
2. **Prepare with Nordea's agent.** It writes pre-meeting notes from shared items only. Kalle sees
   how many items are private, never their titles. Each read appears in Lauri's app under
   **Abel knows → item → Who used it**.
3. **Start meeting.** Lauri's phone opens the meeting. Kalle asks to see "travel or honeymoon
   budget". Lauri chooses: this meeting only, share from now on, or not now.
4. **End meeting.** Items shown for that meeting only are hidden again. The AI recorder drafts
   notes; Kalle corrects and ticks them, then sends them.
5. **Run agent check.** Nordea's agent suggests a salary update.
6. On the phone, updates wait under **From Kalle and Nordea** (Home and Abel knows). Lauri
   accepts, edits or deletes each one. Kalle's screen shows the result.
7. **Reset the story** starts again (the cabinet keeps accepted items; reload the demo data with
   `python scripts/load_data.py seed/demo --target file --clear` for a clean start).

## Where it lives

| File | What |
|---|---|
| `src/server/adviserFlow.ts` | `/api/flow/*`: sharing, suggestions, meeting, recorder draft. Adviser reads go through the access gateway and its log. |
| `src/components/FlowParts.tsx` | Customer side: path strip, share toggle, "Who used it", updates, meeting screen, "Where your information goes" page |
| `src/components/AdviserDesk.tsx` | Kalle's screen |
| `src/services/flowApi.ts`, `src/flow.css` | Client calls and styles |

Small hooks in `App.tsx`, `HomePage.tsx`, `Pages.tsx`, `Chat.tsx`, `main.tsx` and `server.ts`.

**Sharing per item** uses the cabinet's own fields: shared = not private and
`readableBy.adviser` is not false. **Suggestions and the meeting** are demo state in server
memory: they reset when the server restarts. Accepted suggestions become real cabinet entries.

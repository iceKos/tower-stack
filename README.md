# Tower Stack

Tower Stack is a one-button browser game with solo play and 2–6 player rooms.

Use Node.js 22 or later. Run these commands in this directory and open `http://127.0.0.1:5181`.

```sh
npm ci
npm start
```

The main tower, crane, and effects render in 3D with Three.js. The game uses its Canvas 2D renderer if WebGL is unavailable. Opening `index.html` directly runs the solo game in 2D.

Press **Start**, then press **Drop**, **Space**, or **Enter** when the sliding floor lines up with the tower. The floor keeps only the portion that overlaps the story below it. A near-perfect drop keeps the whole floor. A miss or the timer ends the round. Play three rounds and add up the floors you placed. Your best match total is saved in the browser when storage is available.

Each match moves from the daytime city site to a sunset harbor, then to a riverside skyline at night. Solo and party matches use the same scene order.

The music and sound effects start with the first round. Use the speaker button to mute both. The preference is saved in the browser when storage is available.

## Rooms

Open http://127.0.0.1:5181 in two tabs, select **Play with friends**, and create a room in one tab. Join from the other tab using the five-character room code. The host starts when at least two players are connected. The match advances to the next round after everyone finishes or time runs out.

The room server binds to loopback by default. To test from other devices on the same trusted network, run `HOST=0.0.0.0 node server.mjs` and share the host computer's LAN address using port 5181.

Rooms are kept in server memory. In room-code matches, the browser sends each placed floor's outline, the count, and round completion via HTTP. The server streams the roster, countdown, tower previews, and standings via Server-Sent Events. Each preview shows up to the latest 18 stories.

After a network interruption, the game reconnects and sends locally queued placements in order. Reloading the match tab automatically restores its seat. In a new tab on the same browser, open **Play with friends** and select the saved **Resume** option. The round clock keeps running. The server leaves up to 12 seconds after the timer reaches zero for saved progress to arrive, then closes the round. Longer interruptions resume at the current round or results. Room recovery requires the room server to stay up.

## Deploy for Naka Lite testing

Create a Render **Web Service** for this repository. Use Node.js 22, build command `npm ci`, start command `npm start`, and health check path `/healthz`. Set `HOST=0.0.0.0` and let Render provide `PORT`.

| Environment variable | Value |
| --- | --- |
| `PLATFORM` | `naka` |
| `NAKA_API_URL` | `https://naka-lite-api.naka.bot/api` for staging |
| `NAKA_SERVER_KEY` | Tower Stack's own Game server key from Naka Lite Admin |
| `NODE_VERSION` | `22` |
| `NAKA_PENDING_FILE` | Optional path for unsent results. Defaults to `.naka-pending.json`. |

In Naka Lite Admin set the **Game address** to the Render HTTPS URL and set **Players min / max** to **2 / 6**. To test a match, start a party in the platform and launch from the lobby with 2–6 accounts. The game verifies each launch, uses platform display names, and starts after the full roster connects. If the full party does not join within 90 seconds, it closes without submitting a result.

The ranked match uses a single HTTP request per drop. The falling floor starts from the last displayed position. The server checks whether that animation frame is within 500 ms of receipt, computes floor overlap from the accepted time, and sends live tower previews over SSE. A disconnected player can resume their seat while the server remains running. The clock keeps running and ranked drops need a connection.

Score is the total number of floors placed across three rounds. Higher totals place first, ties share a rank, and players who leave are placed below finishers. The server sends both rank and score for every roster member, including departures. The game shows the scores in its standings and Naka Lite controls its own result card and rewards.

Unsent results are written to disk and retried after temporary failures. Render Free is suitable for staging with a single instance. A restart clears active rooms, and recovering unsent results across deploys requires a persistent disk with `NAKA_PENDING_FILE` pointed at it.

Run `npm run check` and `npm test` to check the JavaScript and exercise rooms against a local mock of the Naka Lite API.

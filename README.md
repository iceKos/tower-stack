# Tower Stack

Tower Stack is a one-button browser game with solo play and 2–6 player rooms.

Open `index.html` in a browser, or run this command in this directory and open `http://127.0.0.1:5180`.

```sh
python3 -m http.server 5180 --bind 127.0.0.1
```

Press **Start**, then press **Drop**, **Space**, or **Enter** when the sliding floor lines up with the tower. The floor keeps only the portion that overlaps the story below it. A near-perfect drop keeps the whole floor. A miss or the timer ends the round. Play three rounds and add up the floors you placed. Your best match total is saved in the browser when storage is available.

Each match moves from the daytime city site to a sunset harbor, then to a riverside skyline at night. Solo and party matches use the same scene order.

The music and sound effects start with the first round. Use the speaker button to mute both. The preference is saved in the browser when storage is available.

## Rooms

Run the room server with Node.js 22 or later.

```sh
node server.mjs
```

Open http://127.0.0.1:5181 in two tabs, select **Play with friends**, and create a room in one tab. Join from the other tab using the five-character room code. The host starts when at least two players are connected. The match advances to the next round after everyone finishes or time runs out.

The room server binds to loopback by default. To test from other devices on the same trusted network, run `HOST=0.0.0.0 node server.mjs` and share the host computer's LAN address using port 5181.

Rooms are kept in server memory. The browser runs the tower animation and sends each placed floor's outline, the count, and round completion via HTTP. The server streams the roster, countdown, tower previews, and standings via Server-Sent Events. Each preview shows up to the latest 18 stories. This prototype uses client-reported counts. Rewards and Naka Lite integration require server-side drop validation.

After a network interruption, the game reconnects and sends locally queued placements in order. Reloading the match tab automatically restores its seat. In a new tab on the same browser, open **Play with friends** and select the saved **Resume** option. The round clock keeps running. The server leaves up to 12 seconds after the timer reaches zero for saved progress to arrive, then closes the round. Longer interruptions resume at the current round or results. Room recovery requires the room server to stay up.

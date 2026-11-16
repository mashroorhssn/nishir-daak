# নিশির ডাক · Nishir Daak

A mobile-first multiplayer card-battler RPG for the browser, set in a haunted night forest of Bengali folklore.
2–4 players (friends or bots). You are a wanderer; bind spirits, fight your friends' spirits, and fill your
lantern with fireflies. First to the goal finds the way out.

It is an original game: its rules, card abilities, artwork (hand-drawn SVG) and sounds (synthesised) were made
for this project. The spirits themselves — Rakkhosh, Khokkosh, Petni, Betal, Nishi and friends — come from
traditional folklore.

## Play on your own Wi-Fi (quickest)

Needs Node.js 18 or newer. No install step.

```
cd nishir-daak
npm start
```

The terminal prints two addresses. Open the **LAN** one (for example `http://192.168.0.120:8080`) on every phone
that is on the same Wi-Fi. One person taps **Light a lantern**, the others type the 4-letter room code or open
the **Invite** link. If Windows asks about the firewall, allow Node on private networks.

Use `PORT=3000 npm start` (PowerShell: `$env:PORT=3000; npm start`) for another port.

## Play over the internet (Netlify)

The site is static files plus one serverless function that stores rooms in Netlify Blobs.
A drag-and-drop upload is not enough because of the function, so deploy with the CLI or from Git:

```
cd nishir-daak
npm install
npx netlify-cli login
npx netlify-cli deploy --prod        # choose "create & configure a new site" the first time
```

Or push this folder to GitHub and import it in Netlify; `netlify.toml` already has the settings
(publish `public`, functions in `netlify/functions`, no build command).

Then share the site URL. On Netlify the game polls about once a second instead of holding a connection open,
so moves appear with up to a second of delay.

To try the Netlify version locally: `npx netlify-cli dev` and open `http://localhost:8888`.

## How to play

- Each turn your **Flame** grows by one (up to 7) and refills, and you draw a card.
- Tap a card to read it, then **Summon** a spirit (4 slots) or **Cast** a charm. Glowing units are valid targets.
- Tap one of your spirits, then a glowing enemy, to attack. Spirits that fight hurt each other.
- Use your wanderer's skill once a turn for 2 Flame.
- Destroying an enemy spirit gives 1 firefly (2 for spirits costing 5+). Knocking out a wanderer gives 3;
  they come back on their next turn.
- At 3 and 7 fireflies your wanderer levels up.
- If nobody reaches the goal before dawn, the fullest lantern wins.

The full rules and every card are in the game under **How to play & bestiary**.

## Project layout

```
public/               the client (no build step)
  index.html
  css/style.css
  js/app.js           screens, rendering, input, event animations
  js/fx.js            visual effects        js/sfx.js   synthesised sound
  js/art.js           SVG portraits         js/net.js   polling client
  js/cards.js         card data + targeting rules (shared with the server)
engine/
  engine.mjs          the rules (authoritative, pure functions over JSON state)
  bot.mjs             bot players
  api.mjs             create / join / poll / act over a storage interface
  protocol.md         client/server protocol
server.mjs            local server: static files + long-poll API, rooms in memory
netlify/functions/api.mjs   same API on Netlify, rooms in Netlify Blobs
test/sim.mjs          rule scenarios + hundreds of bot games  (npm test)
test/http.mjs         smoke test against a running server     (node test/http.mjs <url>)
```

To change balance, edit the numbers in `public/js/cards.js` and run `npm test` to see game length and win rates.

## Notes

- Rooms on the local server live in memory and disappear when the server stops.
- A player who closes the tab is played by a bot after 30 seconds and takes over again when they return.
- Reloading the page brings you back into your room.

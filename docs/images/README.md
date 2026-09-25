# README media

`gatehouse.gif` is cut from the five full-frame PNGs beside it (`inbox`,
`portfolio`, `run-escalation`, `run-record`, `metrics`, in that order);
`run-escalation-detail.png` is a crop of `run-escalation.png`. Keep the PNGs:
they are the GIF's sources.

**Recipe.** Serve the cockpit read-only over this repository, with no
orchestrator running (nothing dispatches, nothing is billed). The source id
the slugs carry is the checkout directory's name, so capture from a checkout
named `gateline` — from a worktree, add a detached one at such a path and
point `--repo` at it:

```sh
cd packages && node cli/src/main.ts ui --repo .. --no-open --port 4312
```

Capture each screen at a 1728×963 viewport with the "orchestrator not
running" alert hidden (`main [role="alert"] { display: none }`).
`packages/web/scripts/capture-readme.mjs` does this with Playwright's
Chromium, awaiting each page on the element that proves it rendered rather
than on a timer — a bare headless screenshot races the SPA:

```sh
cd packages && node web/scripts/capture-readme.mjs http://127.0.0.1:4312 /tmp/shots
```

The script discovers the source id from `GET /api/health` at capture time;
pass it as a third argument if the server has multiple sources and you need
a specific one:

```sh
cd packages && node web/scripts/capture-readme.mjs http://127.0.0.1:4312 /tmp/shots gateline
```

Scale each frame to 1280 wide; `run-escalation-detail.png` is
`crop=802:624:330:0` of the scaled escalation frame. Pad every frame to
1280×720 on the page ground `#ffffff` (the token `--color-ground` in
`packages/web/src/styles.css`) before cutting the GIF — frames of unequal
size silently collapse to one — then:

```sh
ffmpeg -framerate 1/3.5 -start_number 1 -i seq/%02d.png \
  -vf "scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse" \
  -loop 0 gatehouse.gif
```

The README discloses that the alert is hidden in these captures.

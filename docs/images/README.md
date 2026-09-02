# README media

`gatehouse.gif` is cut from the five full-frame PNGs beside it (`inbox`,
`portfolio`, `run-escalation`, `run-record`, `metrics`, in that order);
`run-escalation-detail.png` is a crop of `run-escalation.png`. Keep the PNGs:
they are the GIF's sources.

**Recipe.** Serve the cockpit read-only over this repository, with no
orchestrator running (nothing dispatches, nothing is billed):

```sh
cd packages && node cli/src/main.ts ui --repo .. --no-open --port 4312
```

Capture each screen in a real browser at a 1728×963 viewport (the SPA races a
headless screenshot), hide the "orchestrator not running" alert
(`main [role="alert"] { display: none }`), and scale to 1280 wide. Pad every
frame to 1280×720 on the page ground `#faf7f2` before cutting the GIF — frames
of unequal size silently collapse to one — then:

```sh
ffmpeg -framerate 1/3.5 -start_number 1 -i seq/%02d.png \
  -vf "scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse" \
  -loop 0 gatehouse.gif
```

The README discloses that the alert is hidden in these captures.

# iOS install screenshots

Three plain iPhone screenshots, dropped in this folder with these exact names.
Take them on a real iPhone in Safari, on this app. **Do not annotate them** —
the highlight ring is drawn in code (`client/src/components/IosInstallGuide.jsx`),
so plain screenshots are what's wanted and retaking them on a new iOS version
needs no image editing.

| File            | What to capture                                                        |
| --------------- | ---------------------------------------------------------------------- |
| `1-share.png`   | The app open in Safari, **bottom toolbar visible** (scroll up first — Safari hides the toolbar when you scroll down). The Share button is the middle icon. |
| `2-add.png`     | The Share sheet open, scrolled so the **"Ana Ekrana Ekle"** row is visible. |
| `3-confirm.png` | The "Ana Ekrana Ekle" confirmation screen, with the **"Ekle"** button top-right. |

Portrait, full screen, no cropping. PNG. Any iPhone size works.

## Adjusting the highlight rings

Each step in `IosInstallGuide.jsx` has a `ring: { left, top, width, height }`
in **percentages of the screenshot**. If a ring sits slightly off after you add
real screenshots, nudge those four numbers — no other change is needed. The
defaults assume a standard iPhone portrait screenshot.

Until the files exist the guide falls back to a plain text step list, so
nothing breaks in the meantime.

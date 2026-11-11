# FinPilot brand spec v1.0

Source boards: the exported `.dc.html` (Application, Color, Type, Lockups, Mark).
Where this file and a board disagree, the board wins. Report the conflict.

## Idea
Calm, exact, candid, warm. Deep pine ink, warm paper, one point of light.
The brand shows its work, because the product does.

## Tokens
All values live in `tokens.css` as `--fp-*` variables. Components use the
semantic roles (`--fp-bg`, `--fp-text`, `--fp-accent`, ...), not raw hex.

| Name | Hex | Role |
| --- | --- | --- |
| Pine | #0B1F1A | Ink, dark surfaces, the mark |
| Fir | #12332B | Raised surface on pine |
| Moss | #1D4A3D | Rules on pine |
| Paper | #F6F3EC | Page background |
| Linen | #ECE7DB | Raised surface on paper |
| Mist | #9DB3AA | Quiet text on pine |
| Stone | #55645E | Quiet text on paper |
| Signal | #5BE3BE | Accent on dark only |
| Signal Deep | #0A7A5E | Accent on light (links, data, dot) |
| Clay | #BE3C27 | Negative, alert |
| Ochre | #E0A83A | Caution fill, with pine text |

Supporting neutrals: card #FBF9F4, card border #E4DED0, divider #D9D3C4,
input border #CFC8B6, body text #2A3B36.

Contrast as paired: Paper on Pine 15.5:1, Signal on Pine 10.8:1, Mist on Pine 7.7:1,
Stone on Paper 5.6:1, Signal Deep on Paper 4.8:1. Do not use Ochre as text on light.

## Type
- Instrument Serif: headlines and hero figures only. Regular and italic. One italic word per headline.
- Manrope 400-800: all interface text and the wordmark. 500 body, 600 buttons, 700 headings.
- JetBrains Mono: IDs, SQL, eyebrows, anything the user may verify.
- Scale: Display XL 62/1.02, Display 42/1.08, H1 30/1.2 (700), H2 21/1.3 (700),
  Body 16/1.6 (500), Label 12 (700, +8%, uppercase), Data 14/1.4 mono (500).

## Rules
1. Signal is a light, not a paint: about 8% of any screen. The dot, active states, chart endpoints. Never large fills.
2. Financial figures: tabular-nums, right-aligned, true minus (U+2212), consistent decimals.
3. The signal dot marks values the user has confirmed. Unconfirmed values must look different.
4. Text-to-SQL answers show the read-only query in a mono code block on pine.
5. Sentence case everywhere except mono eyebrows and uppercase labels.
6. No gradients, decorative shadows or emoji. Flat fills, 1px borders.
7. AA contrast minimum. Real buttons, links, labels and inputs. Touch targets 44px.

## Logo
- Files in `assets/`: mark-on-light, mark-on-dark, mark-mono-pine, app-icon (also the favicon).
- Never redraw or retype the mark. Import the SVG.
- Wordmark is live text: Manrope 700, letter-spacing -0.035em, class `.fp-wordmark`.
- Lockup: mark height ~0.94 x wordmark font-size, gap ~0.275em, vertically centered.
- Clear space: half the mark's height on every side. Minimums: mark 16px, lockup 96px wide.
- On Pine: Paper mark with Signal dot. On Paper: Pine mark with Signal Deep dot. On Signal: all Pine.

## Component patterns (from Application.dc.html)
- Sidebar: 232px, Pine. Items 44px high, radius 10, 600 14px. Inactive Mist. Active: Fir background, Paper text, 7px Signal dot.
- Page heading: Instrument Serif ~46px with one italic Signal Deep word. Mono eyebrow above it.
- Primary button: Pine fill, Paper text, 44px, radius 12, 700 14px. Secondary: transparent, 1px Pine border, 40px, radius 10.
- Card: #FBF9F4, 1px #E4DED0, radius 16, padding 20-24.
- KPI card: uppercase label, Instrument Serif value ~42px, 13px/600 helper line.
- Chart: Signal Deep 2.5px line, round joins, flat area fill at 9% opacity, gridlines #E4DED0, endpoint dot r6 with a 22% halo r12.
- Status chip: pill, uppercase 12px/700. Needs review = Ochre fill with Pine text.
- Input: 48px, 1px #CFC8B6, Paper fill, radius 12.
- Chat panel: 380px, Linen. User bubble Pine/Paper, radius 16 16 4 16. Assistant bubble Paper with 1px #D9D3C4, radius 16 16 16 4. Query block Pine, radius 12, mono 12.5px, keywords in Signal. Source chips: pill, 1px #CFC8B6, Stone 12px/600. Confirmed line: Signal Deep dot plus 13px/600 text.

## Reskin QA checklist
- No raw hex values in component code; everything via `--fp-*`.
- No leftover default fonts, blue links or gray-scale UI colors.
- All figures tabular and right-aligned; negatives use the true minus.
- Run a contrast check on every text/background pair.
- Behavior and data flow are unchanged. This is a visual pass only.

# Design notes

Keep these when changing the UI, so it stays coherent as it grows.

## Who uses this

The warehouse team, sales, accounts and procurement — **people without a tech
background**, often on a phone. Every screen is judged by one question: can
someone who has never seen it before understand what an order needs, right now?

Simple beats clever. Plain words beat jargon. One obvious next action beats five
options.

## Language

Never show a code or an enum. Always the plain phrase.

| Say | Not |
|---|---|
| Not started / In our warehouse / Ready to send | `to_be_ordered`, `at_warehouse` |
| Fully paid / Balance pending / Not paid | `paid`, `unpaid` |
| "8d in this step" | "days_in_status: 8" |
| Delivery challan | DC record |

## Tokens (`tailwind.config.js`)

**Surfaces** — `canvas` (page), `surface` (cards), `raised` (inset panels).
**Text** — `ink` / `muted` / `faint`. **Lines** — `line` / `lineStrong`.

**Brand** — `brand` indigo (`brandSoft` tint). Used for the active state, primary
buttons, links, focus rings.

**Status colours** — each has a solid + a soft tint, used as filled pills:

| Tone | Meaning | Colour |
|---|---|---|
| `good` | done, paid, ready | green |
| `warn` | partial, ageing, needs a nudge | amber |
| `bad` | not paid, on hold, nothing sent | red |
| `info` | in transit, sent to customer | blue |
| `accent` | ordered from vendor (procurement) | violet |
| `teal` | landed in our warehouse | teal |
| `neutral` | not started, inactive | slate |

Every status shows **a soft-tinted pill with an icon** (`src/lib/statusUi.tsx`) —
never colour alone, never a bare word. Icons come from `lucide-react`.

**Shape** — rounded corners (`rounded-lg` cards, `rounded-pill` chips/tabs),
gentle shadows (`shadow-card`, `shadow-raised`, `shadow-pop` for the panel). Cards,
not hairline rows. Generous padding; big touch targets.

**Type** — IBM Plex Sans; IBM Plex Mono (`.num`) for money, quantities, order
numbers, ages.

## Patterns

1. **The order card carries the whole story** — customer, a payment bar, a
   status badge with an icon, and "Nd in this step". Nothing to decode, tap
   anywhere to open.
2. **Filters are friendly chips** — "All", "Needs attention", then only the
   statuses that actually have orders. No wall of empty tiles.
3. **The panel leads with the next action** — "Record a payment" for money roles,
   the step buttons / "Create delivery challan" for dispatch roles. Read-only
   users see a plain sentence saying so.
4. **Four tabs, no more** — Payments · Delivery · Items · Details. History lives
   inside Details.
5. **Colour-code the work** — pending line items are red → amber → green so the
   warehouse can see at a glance what still has to go out.
6. **Motion answers a change** — the only unprompted animation is the 1.6s flash
   on a row that just changed from a live Zoho update. `prefers-reduced-motion`
   is respected.
7. **Confirm before writing money** — the payment form has a review step; nothing
   is recorded on a single click.

## Avoid

All-caps tracked-out labels; dense hairline tables; more than one accent colour
in a heading; icons where a word is clearer; showing a raw status code anywhere.

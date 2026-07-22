import { describe, it, expect } from "vitest";
import css from "./App.css?raw";

/**
 * Colour-contrast guard for the theme tokens.
 *
 * The app ships two themes and its secondary text is all driven by a handful of CSS custom properties,
 * so a single token tweak can quietly push a whole surface under the WCAG AA floor. This parses the
 * real `App.css`, resolves each theme's tokens, and checks the pairs that actually meet on screen.
 *
 * It caught the footer: `.appfooter` stacked `opacity: .75` on top of `--muted`, which computed to
 * 2.95:1 (light) / 4.03:1 (dark) for a 0.72rem line — well under the 4.5:1 needed for text that size.
 */

/** WCAG AA for normal-size text. (Large text — 18.66px bold / 24px — would be 3:1; nothing here is.) */
const AA_NORMAL = 4.5;

/** `#rgb` / `#rrggbb` to 0–255 channels. */
function parseHex(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Relative luminance per WCAG 2.x. */
function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two opaque colours, 1–21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `fg` at `alpha` over `bg` — what an `opacity` on a text element actually renders as. */
function blend(fg: string, bg: string, alpha: number): string {
  const f = parseHex(fg);
  const b = parseHex(bg);
  const ch = (i: number) =>
    Math.round(f[i] * alpha + b[i] * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

/**
 * The declarations of the first rule whose selector matches `selector`, as `prop → value`. Good enough
 * for this stylesheet: flat rules, no nesting inside the blocks we read.
 */
function ruleOf(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, `selector ${selector} not found in App.css`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const decl of body.split(";")) {
    const [prop, ...rest] = decl.split(":");
    if (!prop || rest.length === 0) continue;
    out[prop.trim()] = rest.join(":").trim();
  }
  return out;
}

/** The colour tokens of one theme: the surfaces text sits on, and the text colours themselves. */
interface Theme {
  name: string;
  /** The page background (`:root`'s `background`). */
  page: string;
  /** The card surface (`--card`) — most content sits on this. */
  card: string;
  /** The default body text colour (`:root`'s `color`). */
  text: string;
  muted: string;
  accent: string;
  up: string;
  down: string;
}

function themeFrom(selector: string, name: string): Theme {
  const r = ruleOf(selector);
  return {
    name,
    page: r["background"],
    card: r["--card"],
    text: r["color"],
    muted: r["--muted"],
    accent: r["--accent"],
    up: r["--up"],
    down: r["--down"],
  };
}

const THEMES: Theme[] = [
  themeFrom(":root {", "light"),
  themeFrom(':root[data-theme="dark"] {', "dark"),
];

describe("theme colour contrast", () => {
  it("reads both themes' tokens out of App.css", () => {
    for (const theme of THEMES) {
      for (const [key, value] of Object.entries(theme)) {
        expect(value, `${theme.name}.${key}`).toMatch(key === "name" ? /./ : /^#[0-9a-f]{3,6}$/i);
      }
    }
  });

  for (const theme of THEMES) {
    describe(theme.name, () => {
      // Every foreground token, against both surfaces it can land on.
      for (const surface of ["page", "card"] as const) {
        for (const fg of ["text", "muted", "accent", "up", "down"] as const) {
          it(`${fg} on the ${surface} meets AA`, () => {
            expect(contrast(theme[fg], theme[surface])).toBeGreaterThanOrEqual(AA_NORMAL);
          });
        }
      }

      it("the version footer meets AA at whatever opacity it carries", () => {
        // `.appfooter` is `.muted` text on the page. Any `opacity` there composites against the page
        // before it's read, so it has to be part of the check rather than assumed harmless.
        const opacity = Number(ruleOf(".appfooter {")["opacity"] ?? "1");
        const rendered = blend(theme.muted, theme.page, opacity);
        expect(contrast(rendered, theme.page)).toBeGreaterThanOrEqual(AA_NORMAL);
      });
    });
  }
});

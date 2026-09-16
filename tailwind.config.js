/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces
        canvas: "#F6F7FB", // page background — cool, airy neutral
        surface: "#FFFFFF",
        raised: "#FAFBFD", // subtle inset panels

        // Text + lines
        ink: "#0F172A",
        muted: "#64748B",
        faint: "#94A3B8",
        line: "#E7EAF0",
        lineStrong: "#CBD5E1",

        // Brand — blurple, closer to the "confident fintech SaaS" reference
        brand: "#635BFF",
        brandSoft: "#F0EFFF",

        // Semantic — each has a solid + a soft tint for pills
        good: "#15803D",
        goodSoft: "#DCFCE7",
        warn: "#B45309",
        warnSoft: "#FEF3C7",
        bad: "#B91C1C",
        badSoft: "#FEE2E2",
        info: "#1D4ED8",
        infoSoft: "#DBEAFE",
        accent: "#7C3AED",
        accentSoft: "#F3E8FF",
        teal: "#0F766E",
        tealSoft: "#CCFBF1",
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        // Numbers/codes render in Inter with tabular figures (see .num); this
        // stack is only a fallback for genuinely monospaced surfaces (print).
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        micro: ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        sm: "8px",
        DEFAULT: "12px",
        lg: "16px",
        xl: "24px",
        pill: "9999px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.03), 0 2px 6px rgba(15,23,42,0.05)",
        raised: "0 4px 16px rgba(15,23,42,0.08)",
        pop: "0 16px 48px rgba(15,23,42,0.18)",
      },
    },
  },
  plugins: [],
};

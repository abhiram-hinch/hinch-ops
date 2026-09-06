/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces
        canvas: "#F1F5F9", // page background
        surface: "#FFFFFF",
        raised: "#F8FAFC", // subtle inset panels

        // Text + lines
        ink: "#0F172A",
        muted: "#64748B",
        faint: "#94A3B8",
        line: "#E2E8F0",
        lineStrong: "#CBD5E1",

        // Brand
        brand: "#4F46E5",
        brandSoft: "#EEF2FF",

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
        sm: "6px",
        DEFAULT: "10px",
        lg: "14px",
        xl: "20px",
        pill: "9999px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)",
        raised: "0 2px 8px rgba(15,23,42,0.08)",
        pop: "0 12px 40px rgba(15,23,42,0.16)",
      },
    },
  },
  plugins: [],
};

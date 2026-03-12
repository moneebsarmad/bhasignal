import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        "4xl": "2rem"
      },
      boxShadow: {
        hush: "0 20px 60px rgba(15, 23, 42, 0.08)",
        card: "0 12px 32px rgba(15, 23, 42, 0.08)"
      },
      fontFamily: {
        sans: ['"Public Sans"', '"Avenir Next"', '"Segoe UI"', "Helvetica Neue", "sans-serif"],
        display: ['"Iowan Old Style"', '"Palatino Linotype"', '"Book Antiqua"', "Georgia", "serif"],
        mono: ['"SFMono-Regular"', "Consolas", '"Liberation Mono"', "monospace"]
      },
      maxWidth: {
        shell: "96rem"
      }
    }
  },
  plugins: []
};

export default config;

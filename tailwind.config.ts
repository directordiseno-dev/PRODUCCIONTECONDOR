import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tecondor: {
          magenta: "#BE1E72",
          magentaDark: "#8E1557",
          magentaLight: "#FCE4F0",
          purple: "#6B3F8A",
          ink: "#1F1F1F",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;

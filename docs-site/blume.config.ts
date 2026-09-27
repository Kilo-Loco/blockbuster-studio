import { defineConfig } from "blume";

export default defineConfig({
  title: "Blockbuster Studio",
  description: "Your own AI film studio on one rented GPU: deploy it, make images and video, and turn a script into a film.",
  theme: {
    accent: "#f5a524",
    mode: "system",
  },
  deployment: {
    site: "https://docs.blockbuster.studio",
  },
  github: {
    owner: "Kilo-Loco",
    repo: "blockbuster-studio",
    dir: "docs-site",
  },
});

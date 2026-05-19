import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Swing Workspace",
    short_name: "Swing",
    description:
      "Personal swing-trading decision engine — daily digest, thesis tracking, invalidation alerts.",
    start_url: "/scanner",
    display: "standalone",
    background_color: "#f7f3ee",
    theme_color: "#1e6f5c",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}

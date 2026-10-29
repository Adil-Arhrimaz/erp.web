import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ParaPilot",
    short_name: "ParaPilot",
    description: "Caisse, stock, achats et TVA pour la parapharmacie",
    start_url: "/",
    display: "standalone",
    background_color: "#fbfdfc",
    theme_color: "#0f8a74",
    icons: [{ src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}

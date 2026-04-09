import type { PluginDescriptor } from "emdash";

export function emDashRatingPlugin(): PluginDescriptor {
  return {
    id: "emdash-rating",
    version: "1.0.0",
    format: "standard",
    entrypoint: "emdash-rating/sandbox",
    capabilities: ["page:inject"],

    storage: {
      // One document per vote
      votes: {
        indexes: [
          "postSlug",
          "stars",
          "votedAt",
          "ip",
          ["postSlug", "votedAt"],
          ["postSlug", "stars"],
          ["postSlug", "ip"],
        ],
      },
      // Aggregated per-post stats (updated on each vote for fast reads)
      stats: {
        indexes: ["postSlug", "totalVotes", "averageRating", "updatedAt"],
      },
    },

    adminPages: [
      { path: "/dashboard", label: "EmDash Rating", icon: "Star" },
    ],

    adminWidgets: [
      { id: "rating-overview", title: "EmDash Rating Overview", size: "full" },
    ],
  };
}


import { definePlugin } from "emdash";
const DEFAULT_SETTINGS = {
  starColor: "#f59e0b",
  starSize: "md",
  successText: "Thanks for your rating!",
  allowAnonymous: true,
  preventDuplicateByIp: true,
  schemaEnabled: true,
  schemaType: "BlogPosting"
};
function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
function safeIp(request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
}
async function getSettings(ctx) {
  const keys = [
    "starColor",
    "starSize",
    "successText",
    "allowAnonymous",
    "preventDuplicateByIp",
    "schemaEnabled",
    "schemaType"
  ];
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of keys) {
    const val = await ctx.kv.get(`settings:${key}`);
    if (val !== null) settings[key] = val;
  }
  return settings;
}
async function rebuildStats(postSlug, votes, stats) {
  const distribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let totalStars = 0;
  let totalVotes = 0;
  let cursor;
  do {
    const page = await votes.query({
      where: { postSlug },
      orderBy: { votedAt: "asc" },
      limit: 200,
      cursor
    });
    for (const item of page.items) {
      const s = String(item.data.stars);
      distribution[s] = (distribution[s] ?? 0) + 1;
      totalStars += item.data.stars;
      totalVotes++;
    }
    cursor = page.cursor;
  } while (cursor);
  const averageRating = totalVotes > 0 ? Math.round(totalStars / totalVotes * 10) / 10 : 0;
  const stat = {
    postSlug,
    totalVotes,
    totalStars,
    averageRating,
    distribution,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await stats.put(postSlug, stat);
  return stat;
}
var sandbox_entry_default = definePlugin({
  hooks: {
    "plugin:install": {
      handler: async (_event, ctx) => {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
          await ctx.kv.set(`settings:${key}`, value);
        }
        ctx.log.info("EmDash Rating installed");
      }
    },
    "plugin:activate": {
      handler: async (_event, ctx) => {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
          const existing = await ctx.kv.get(`settings:${key}`);
          if (existing === null) await ctx.kv.set(`settings:${key}`, value);
        }
        ctx.log.info("EmDash Rating activated");
      }
    }
  },
  routes: {
    // ── Public: fetch settings + stats for a post ──────────────────────────
    "public/post": {
      public: true,
      handler: async (routeCtx, ctx) => {
        const url = new URL(routeCtx.request.url);
        const postSlug = url.searchParams.get("slug") ?? "";
        if (!postSlug) return { error: "slug required" };
        const settings = await getSettings(ctx);
        const stats = ctx.storage.stats;
        const stat = await stats.get(postSlug);
        return {
          settings: {
            starColor: settings.starColor,
            starSize: settings.starSize,
            successText: settings.successText,
            schemaEnabled: settings.schemaEnabled,
            schemaType: settings.schemaType
          },
          stats: stat ?? {
            postSlug,
            totalVotes: 0,
            totalStars: 0,
            averageRating: 0,
            distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          }
        };
      }
    },
    // ── Public: submit a vote ──────────────────────────────────────────────
    "public/vote": {
      public: true,
      handler: async (routeCtx, ctx) => {
        const body = routeCtx.input ?? {};
        const postSlug = body.postSlug ?? "";
        const stars = Number(body.stars);
        if (!postSlug) return { error: "slug required" };
        if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
          return { error: "stars must be 1\u20135" };
        }
        const settings = await getSettings(ctx);
        const votes = ctx.storage.votes;
        const stats = ctx.storage.stats;
        const ip = safeIp(routeCtx.request);
        if (settings.preventDuplicateByIp) {
          const existing = await votes.query({
            where: { postSlug, ip },
            limit: 1
          });
          if (existing.items.length > 0) {
            return { error: "already_voted", message: "You have already rated this post." };
          }
        }
        const vote = {
          postSlug,
          stars,
          ip,
          userAgent: routeCtx.request.headers.get("user-agent") ?? "",
          votedAt: (/* @__PURE__ */ new Date()).toISOString(),
          edited: false
        };
        await votes.put(uid(), vote);
        const stat = await rebuildStats(postSlug, votes, stats);
        return {
          success: true,
          message: settings.successText,
          stats: stat
        };
      }
    },
    // ── Admin: list all votes (paginated, filterable by postSlug) ──────────
    "votes": {
      handler: async (routeCtx, ctx) => {
        const url = new URL(routeCtx.request.url);
        const postSlug = url.searchParams.get("postSlug") ?? void 0;
        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
        const cursor = url.searchParams.get("cursor") ?? void 0;
        const votes = ctx.storage.votes;
        const result = await votes.query({
          where: postSlug ? { postSlug } : void 0,
          orderBy: { votedAt: "desc" },
          limit,
          cursor
        });
        return {
          items: result.items.map((v) => ({ id: v.id, ...v.data })),
          cursor: result.cursor,
          hasMore: result.hasMore,
          total: await votes.count(postSlug ? { postSlug } : void 0)
        };
      }
    },
    // ── Admin: get per-post stats list ────────────────────────────────────
    "stats": {
      handler: async (routeCtx, ctx) => {
        const url = new URL(routeCtx.request.url);
        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
        const cursor = url.searchParams.get("cursor") ?? void 0;
        const stats = ctx.storage.stats;
        const result = await stats.query({
          orderBy: { totalVotes: "desc" },
          limit,
          cursor
        });
        return {
          items: result.items.map((s) => ({ id: s.id, ...s.data })),
          cursor: result.cursor,
          hasMore: result.hasMore
        };
      }
    },
    // ── Admin: edit a vote (manual adjustment) ────────────────────────────
    "votes/edit": {
      handler: async (routeCtx, ctx) => {
        const body = routeCtx.input ?? {};
        if (!body.id) return { error: "id required" };
        const stars = Number(body.stars);
        if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
          return { error: "stars must be 1\u20135" };
        }
        const votes = ctx.storage.votes;
        const stats = ctx.storage.stats;
        const existing = await votes.get(body.id);
        if (!existing) return { error: "vote not found" };
        await votes.put(body.id, { ...existing, stars, edited: true });
        await rebuildStats(existing.postSlug, votes, stats);
        return { success: true };
      }
    },
    // ── Admin: delete a vote ──────────────────────────────────────────────
    "votes/delete": {
      handler: async (routeCtx, ctx) => {
        const body = routeCtx.input ?? {};
        if (!body.id) return { error: "id required" };
        const votes = ctx.storage.votes;
        const stats = ctx.storage.stats;
        const existing = await votes.get(body.id);
        if (!existing) return { error: "vote not found" };
        await votes.delete(body.id);
        await rebuildStats(existing.postSlug, votes, stats);
        return { success: true };
      }
    },
    // ── Admin: export all votes as CSV ────────────────────────────────────
    "export": {
      handler: async (_routeCtx, ctx) => {
        const votes = ctx.storage.votes;
        const rows = ["id,postSlug,stars,ip,userAgent,votedAt,edited"];
        let cursor;
        do {
          const page = await votes.query({
            orderBy: { votedAt: "desc" },
            limit: 200,
            cursor
          });
          for (const v of page.items) {
            const d = v.data;
            const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
            rows.push([
              esc(v.id),
              esc(d.postSlug),
              d.stars,
              esc(d.ip),
              esc(d.userAgent),
              esc(d.votedAt),
              d.edited
            ].join(","));
          }
          cursor = page.cursor;
        } while (cursor);
        return new Response(rows.join("\n"), {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="ratings-${Date.now()}.csv"`
          }
        });
      }
    },
    // ── Admin: import votes from CSV ──────────────────────────────────────
    "import": {
      handler: async (routeCtx, ctx) => {
        const text = String(routeCtx.input ?? "");
        const lines = text.trim().split("\n");
        const dataLines = lines.slice(1);
        const votes = ctx.storage.votes;
        const stats = ctx.storage.stats;
        let imported = 0;
        let skipped = 0;
        const affectedSlugs = /* @__PURE__ */ new Set();
        for (const line of dataLines) {
          const cols = line.match(/("(?:[^"]|"")*"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) ?? [];
          const unquote = (s) => s.replace(/^"|"$/g, "").replace(/""/g, '"');
          const [id, postSlug, starsRaw, ip, userAgent, votedAt] = cols.map(unquote);
          const stars = parseInt(starsRaw ?? "", 10);
          if (!postSlug || !stars || stars < 1 || stars > 5) {
            skipped++;
            continue;
          }
          const voteId = id && id !== "" ? id : uid();
          await votes.put(voteId, {
            postSlug,
            stars,
            ip: ip ?? "imported",
            userAgent: userAgent ?? "",
            votedAt: votedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
            edited: false
          });
          affectedSlugs.add(postSlug);
          imported++;
        }
        for (const slug of affectedSlugs) {
          await rebuildStats(slug, votes, stats);
        }
        return { success: true, imported, skipped };
      }
    },
    // ── Admin: get/save plugin settings ───────────────────────────────────
    "settings": {
      public: true,
      handler: async (routeCtx, ctx) => {
        if (routeCtx.input && typeof routeCtx.input === "object") {
          const body = routeCtx.input;
          const allowed = [
            "starColor",
            "starSize",
            "successText",
            "allowAnonymous",
            "preventDuplicateByIp",
            "schemaEnabled",
            "schemaType"
          ];
          for (const key of allowed) {
            if (key in body) await ctx.kv.set(`settings:${key}`, body[key]);
          }
          return { success: true };
        }
        return getSettings(ctx);
      }
    },
    // ── Admin: Block Kit handler ──────────────────────────────────────────
    "admin": {
      handler: async (routeCtx, ctx) => {
        const interaction = routeCtx.input;
        const votes = ctx.storage.votes;
        const stats = ctx.storage.stats;
        function tabBar(active) {
          return {
            type: "actions",
            block_id: "tab-bar",
            elements: [
              {
                type: "button",
                action_id: "tab_ratings",
                label: active === "ratings" ? "\u25CF Ratings" : "Ratings",
                style: active === "ratings" ? "primary" : "secondary"
              },
              {
                type: "button",
                action_id: "tab_categories",
                label: active === "categories" ? "\u25CF Categories" : "Categories",
                style: active === "categories" ? "primary" : "secondary"
              },
              {
                type: "button",
                action_id: "tab_settings",
                label: active === "settings" ? "\u25CF Settings" : "Settings",
                style: active === "settings" ? "primary" : "secondary"
              }
            ]
          };
        }
        if (interaction.type === "page_load" && interaction.page === "widget:rating-overview") {
          const totalVotes = await votes.count();
          const statsResult = await stats.query({ orderBy: { totalVotes: "desc" }, limit: 5 });
          const topPosts = statsResult.items.map((s) => ({
            post: s.data.postSlug,
            votes: String(s.data.totalVotes),
            average: String(s.data.averageRating)
          }));
          return {
            blocks: [
              {
                type: "stats",
                items: [
                  { label: "Total Votes", value: String(totalVotes) },
                  { label: "Posts Rated", value: String(statsResult.items.length) }
                ]
              },
              { type: "divider" },
              topPosts.length > 0 ? {
                type: "table",
                page_action_id: "noop",
                empty_text: "No votes yet",
                columns: [
                  { key: "post", label: "Post Slug" },
                  { key: "votes", label: "Votes", format: "number" },
                  { key: "average", label: "Avg", format: "number" }
                ],
                rows: topPosts
              } : {
                type: "context",
                text: "No votes yet \u2014 ratings will appear here once visitors start rating posts."
              }
            ]
          };
        }
        async function ratingsTab(banner) {
          const result = await votes.query({ orderBy: { votedAt: "desc" }, limit: 50 });
          const totalVotes = await votes.count();
          const rows = result.items.map((v) => ({
            id: v.id,
            postSlug: v.data.postSlug,
            stars: String(v.data.stars),
            ip: v.data.ip,
            votedAt: v.data.votedAt,
            edited: v.data.edited ? "Yes" : "\u2014"
          }));
          return {
            blocks: [
              { type: "header", text: "EmDash Rating" },
              tabBar("ratings"),
              { type: "divider" },
              ...banner ? [{ type: "banner", title: banner.title, variant: banner.variant }] : [],
              {
                type: "stats",
                items: [{ label: "Total Votes", value: String(totalVotes) }]
              },
              {
                type: "actions",
                elements: [
                  { type: "button", action_id: "export_csv", label: "Export CSV", style: "secondary" }
                ]
              },
              {
                type: "table",
                block_id: "votes-table",
                page_action_id: "load_votes_page",
                next_cursor: result.cursor,
                empty_text: "No votes yet",
                columns: [
                  { key: "postSlug", label: "Post" },
                  { key: "stars", label: "Stars", format: "number" },
                  { key: "ip", label: "IP" },
                  { key: "votedAt", label: "Date", format: "relative_time" },
                  { key: "edited", label: "Edited" }
                ],
                rows
              }
            ]
          };
        }
        async function categoriesTab() {
          const allStats = await stats.query({ orderBy: { totalVotes: "desc" }, limit: 200 });
          const catMap = {};
          for (const s of allStats.items) {
            const parts = s.data.postSlug.split("/");
            const cat = parts.length > 1 ? parts[0] : "uncategorized";
            if (!catMap[cat]) catMap[cat] = { votes: 0, totalStars: 0, posts: 0 };
            catMap[cat].votes += s.data.totalVotes;
            catMap[cat].totalStars += s.data.totalStars;
            catMap[cat].posts++;
          }
          const catRows = Object.entries(catMap).map(([cat, data]) => ({
            category: cat,
            posts: String(data.posts),
            votes: String(data.votes),
            average: data.votes > 0 ? String(Math.round(data.totalStars / data.votes * 10) / 10) : "0"
          }));
          return {
            blocks: [
              { type: "header", text: "EmDash Rating" },
              tabBar("categories"),
              { type: "divider" },
              {
                type: "context",
                text: 'Categories are inferred from the post slug prefix (e.g. "dental-tips/scaling" \u2192 "dental-tips").'
              },
              catRows.length > 0 ? {
                type: "table",
                page_action_id: "noop",
                empty_text: "No ratings yet",
                columns: [
                  { key: "category", label: "Category" },
                  { key: "posts", label: "Posts", format: "number" },
                  { key: "votes", label: "Votes", format: "number" },
                  { key: "average", label: "Avg", format: "number" }
                ],
                rows: catRows
              } : {
                type: "banner",
                title: "No ratings yet",
                description: "Votes will appear here once visitors start rating posts.",
                variant: "default"
              }
            ]
          };
        }
        function starPreviewSvg(color, size) {
          const px = { sm: 24, md: 34, lg: 46, xl: 58 };
          const s = px[size] ?? 34;
          const pad = 4;
          const totalW = (s + pad) * 5;
          const totalH = s + 8;
          const r = s / 2;
          function starPath(cx, cy, outer, inner) {
            const points = [];
            for (let i = 0; i < 10; i++) {
              const angle = Math.PI / 5 * i - Math.PI / 2;
              const radius = i % 2 === 0 ? outer : inner;
              points.push(`${(cx + Math.cos(angle) * radius).toFixed(2)},${(cy + Math.sin(angle) * radius).toFixed(2)}`);
            }
            return `<polygon points="${points.join(" ")}" fill="${color}" stroke="${color}" stroke-width="1"/>`;
          }
          const stars = Array.from({ length: 5 }, (_, i) => {
            const cx = i * (s + pad) + r + 2;
            const cy = r + 4;
            return starPath(cx, cy, r * 0.9, r * 0.38);
          }).join("");
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">${stars}</svg>`;
          return `data:image/svg+xml;base64,${btoa(svg)}`;
        }
        async function settingsTab(saved = false, previewColor, previewSize) {
          const s = await getSettings(ctx);
          const displayColor = previewColor ?? s.starColor;
          const displaySize = previewSize ?? s.starSize;
          const sizeLabel = { sm: "Small (24px)", md: "Medium (34px)", lg: "Large (46px)", xl: "Extra Large (58px)" };
          const palette = [
            { label: "Amber", color: "#f59e0b" },
            { label: "Gold", color: "#eab308" },
            { label: "Orange", color: "#f97316" },
            { label: "Red", color: "#ef4444" },
            { label: "Pink", color: "#ec4899" },
            { label: "Purple", color: "#a855f7" },
            { label: "Blue", color: "#3b82f6" },
            { label: "Teal", color: "#14b8a6" },
            { label: "Green", color: "#22c55e" },
            { label: "Slate", color: "#64748b" }
          ];
          const colorSwatches = palette.map((p) => ({
            type: "button",
            action_id: "preview_color",
            label: `${displayColor === p.color ? "\u2713 " : ""}${p.label}`,
            value: p.color,
            style: displayColor === p.color ? "primary" : "secondary"
          }));
          const sizeButtons = ["sm", "md", "lg", "xl"].map((sz) => ({
            type: "button",
            action_id: "preview_size",
            label: `${displaySize === sz ? "\u25CF " : ""}${sizeLabel[sz]}`,
            value: sz,
            style: displaySize === sz ? "primary" : "secondary"
          }));
          return {
            blocks: [
              { type: "header", text: "EmDash Rating" },
              tabBar("settings"),
              { type: "divider" },
              ...saved ? [{ type: "banner", title: "Settings saved", variant: "default" }] : [],
              // ── Live Preview ─────────────────────────────────────────────
              { type: "header", text: "Live Preview" },
              {
                type: "image",
                url: starPreviewSvg(displayColor, displaySize),
                alt: "Star rating preview",
                title: `${displayColor} \xB7 ${sizeLabel[displaySize] ?? displaySize}`
              },
              // ── Colour palette ───────────────────────────────────────────
              { type: "header", text: "Star Colour" },
              {
                type: "context",
                text: `Active: ${displayColor}  \u2014 click a colour to preview instantly, then Save.`
              },
              { type: "actions", elements: colorSwatches },
              {
                type: "context",
                text: "Need a different colour? Enter a hex code below and click Apply."
              },
              {
                type: "form",
                block_id: "custom-color-form",
                fields: [
                  {
                    type: "text_input",
                    action_id: "custom_color",
                    label: "Custom hex colour",
                    initial_value: displayColor,
                    placeholder: "#f59e0b"
                  }
                ],
                submit: { label: "Apply", action_id: "preview_custom_color" }
              },
              // ── Size picker ───────────────────────────────────────────────
              { type: "header", text: "Star Size" },
              { type: "actions", elements: sizeButtons },
              { type: "divider" },
              // ── Full settings form ───────────────────────────────────────
              { type: "header", text: "Other Settings" },
              {
                type: "form",
                block_id: "rating-settings",
                fields: [
                  {
                    type: "text_input",
                    action_id: "successText",
                    label: "Message shown after voting",
                    initial_value: s.successText
                  },
                  {
                    type: "toggle",
                    action_id: "preventDuplicateByIp",
                    label: "Prevent duplicate votes by IP",
                    description: "Blocks multiple votes from the same IP address per post",
                    initial_value: s.preventDuplicateByIp
                  },
                  {
                    type: "toggle",
                    action_id: "schemaEnabled",
                    label: "Enable Schema.org structured data",
                    description: "Injects AggregateRating JSON-LD for rich search snippets",
                    initial_value: s.schemaEnabled
                  },
                  {
                    type: "select",
                    action_id: "schemaType",
                    label: "Schema.org type",
                    initial_value: s.schemaType,
                    options: [
                      { label: "BlogPosting", value: "BlogPosting" },
                      { label: "Article", value: "Article" },
                      { label: "LocalBusiness", value: "LocalBusiness" },
                      { label: "Product", value: "Product" },
                      { label: "Recipe", value: "Recipe" }
                    ]
                  }
                ],
                submit: { label: "Save All Settings", action_id: "save_settings" }
              },
              { type: "divider" },
              { type: "header", text: "Import / Export" },
              {
                type: "section",
                text: "Export all votes as a CSV file, or import from a previously exported CSV."
              },
              {
                type: "actions",
                elements: [
                  { type: "button", action_id: "export_csv", label: "Export CSV", style: "secondary" }
                ]
              },
              {
                type: "form",
                block_id: "import-form",
                fields: [
                  {
                    type: "text_input",
                    action_id: "csv_data",
                    label: "Paste CSV data to import",
                    multiline: true,
                    placeholder: "id,postSlug,stars,ip,userAgent,votedAt,edited"
                  }
                ],
                submit: { label: "Import Votes", action_id: "import_csv" }
              }
            ]
          };
        }
        if (interaction.type === "page_load" && interaction.page === "/dashboard") {
          return ratingsTab();
        }
        if (interaction.type === "block_action" && interaction.action_id === "tab_ratings") {
          return ratingsTab();
        }
        if (interaction.type === "block_action" && interaction.action_id === "tab_categories") {
          return categoriesTab();
        }
        if (interaction.type === "block_action" && interaction.action_id === "tab_settings") {
          return settingsTab();
        }
        if (interaction.type === "block_action" && interaction.action_id === "load_votes_page") {
          const cursor = interaction.value;
          const result = await votes.query({ orderBy: { votedAt: "desc" }, limit: 50, cursor });
          const rows = result.items.map((v) => ({
            id: v.id,
            postSlug: v.data.postSlug,
            stars: String(v.data.stars),
            ip: v.data.ip,
            votedAt: v.data.votedAt,
            edited: v.data.edited ? "Yes" : "\u2014"
          }));
          return {
            blocks: [{
              type: "table",
              block_id: "votes-table",
              page_action_id: "load_votes_page",
              next_cursor: result.cursor,
              empty_text: "No votes yet",
              columns: [
                { key: "postSlug", label: "Post" },
                { key: "stars", label: "Stars", format: "number" },
                { key: "ip", label: "IP" },
                { key: "votedAt", label: "Date", format: "relative_time" },
                { key: "edited", label: "Edited" }
              ],
              rows
            }]
          };
        }
        if (interaction.type === "block_action" && interaction.action_id === "export_csv") {
          const allVotes = ctx.storage.votes;
          const csvRows = ["id,postSlug,stars,ip,userAgent,votedAt,edited"];
          let cur;
          do {
            const page = await allVotes.query({ orderBy: { votedAt: "desc" }, limit: 200, cursor: cur });
            for (const v of page.items) {
              const d = v.data;
              const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
              csvRows.push([esc(v.id), esc(d.postSlug), d.stars, esc(d.ip), esc(d.userAgent), esc(d.votedAt), d.edited].join(","));
            }
            cur = page.cursor;
          } while (cur);
          const csvText = csvRows.join("\n");
          return {
            blocks: [
              { type: "header", text: "EmDash Rating" },
              tabBar("ratings"),
              { type: "divider" },
              { type: "header", text: "Export CSV" },
              {
                type: "context",
                text: `${csvRows.length - 1} vote${csvRows.length - 1 !== 1 ? "s" : ""} exported. Copy the text below and save as a .csv file.`
              },
              {
                type: "form",
                block_id: "csv-export-form",
                fields: [
                  {
                    type: "text_input",
                    action_id: "csv_export_text",
                    label: "CSV data",
                    initial_value: csvText,
                    multiline: true
                  }
                ],
                submit: { label: "Back to Ratings", action_id: "back_to_ratings" }
              }
            ]
          };
        }
        if (interaction.type === "form_submit" && interaction.action_id === "back_to_ratings") {
          return ratingsTab();
        }
        if (interaction.type === "block_action" && interaction.action_id === "preview_color") {
          const color = interaction.value;
          await ctx.kv.set("settings:starColor", color);
          return settingsTab(false, color, void 0);
        }
        if (interaction.type === "block_action" && interaction.action_id === "preview_size") {
          const size = interaction.value;
          await ctx.kv.set("settings:starSize", size);
          return settingsTab(false, void 0, size);
        }
        if (interaction.type === "form_submit" && interaction.action_id === "preview_custom_color") {
          const vals = interaction.values;
          const color = vals.custom_color?.trim() || "#f59e0b";
          await ctx.kv.set("settings:starColor", color);
          return settingsTab(false, color, void 0);
        }
        if (interaction.type === "form_submit" && interaction.action_id === "save_settings") {
          const v = interaction.values;
          const allowed = [
            "starColor",
            "starSize",
            "successText",
            "preventDuplicateByIp",
            "schemaEnabled",
            "schemaType"
          ];
          for (const key of allowed) {
            if (key in v) await ctx.kv.set(`settings:${key}`, v[key]);
          }
          return {
            ...await settingsTab(true),
            toast: { message: "Settings saved", type: "success" }
          };
        }
        if (interaction.type === "form_submit" && interaction.action_id === "import_csv") {
          const v = interaction.values;
          const text = v.csv_data ?? "";
          const lines = text.trim().split("\n").slice(1);
          const votesCol = ctx.storage.votes;
          const statsCol = ctx.storage.stats;
          let imported = 0;
          let skipped = 0;
          const affected = /* @__PURE__ */ new Set();
          for (const line of lines) {
            const cols = line.match(/("(?:[^"]|"")*"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) ?? [];
            const unq = (s) => s.replace(/^"|"$/g, "").replace(/""/g, '"');
            const [id, postSlug, starsRaw, ip, userAgent, votedAt] = cols.map(unq);
            const stars = parseInt(starsRaw ?? "", 10);
            if (!postSlug || !stars || stars < 1 || stars > 5) {
              skipped++;
              continue;
            }
            const voteId = id && id !== "" ? id : uid();
            await votesCol.put(voteId, {
              postSlug,
              stars,
              ip: ip ?? "imported",
              userAgent: userAgent ?? "",
              votedAt: votedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
              edited: false
            });
            affected.add(postSlug);
            imported++;
          }
          for (const slug of affected) await rebuildStats(slug, votesCol, statsCol);
          const importResult = await settingsTab();
          importResult.blocks = [
            { type: "header", text: "EmDash Rating" },
            tabBar("settings"),
            { type: "divider" },
            {
              type: "banner",
              title: `Import complete \u2014 ${imported} imported, ${skipped} skipped`,
              variant: "default"
            },
            ...importResult.blocks.slice(4)
            // keep form fields after the banner
          ];
          return {
            ...importResult,
            toast: { message: `Imported ${imported} vote${imported !== 1 ? "s" : ""}`, type: "success" }
          };
        }
        return { blocks: [] };
      }
    }
  }
});
export {
  sandbox_entry_default as default
};

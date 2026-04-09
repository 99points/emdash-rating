# EmDash Rating

A star rating plugin for EmDash CMS. Let visitors rate any post with 1–5 stars, see live averages, and manage all votes from a built-in admin dashboard.

---

## Features

- **5-star widget** — renders on every post page, fully styled with your chosen colour and size
- **Per-post stats** — average rating and vote count displayed next to the widget
- **Admin dashboard** — three-tab UI: Ratings, Categories, Settings
  - **Ratings tab** — paginated table of all votes with post slug, stars, IP, date
  - **Categories tab** — aggregated stats grouped by post slug prefix (e.g. `dental-tips/post` → `dental-tips`)
  - **Settings tab** — colour palette, custom hex input, size picker, success message, duplicate-vote protection, Schema.org toggle
- **Dashboard widget** — total votes + top-rated posts summary on the EmDash home screen
- **Duplicate vote protection** — blocks multiple votes from the same IP per post
- **Schema.org structured data** — injects `AggregateRating` JSON-LD for rich search snippets
- **Export / Import** — download all votes as CSV, or paste CSV to bulk-import votes
- **Cloudflare Workers compatible** — no Node.js builtins, runs in V8 isolates

---

## Installation

### From the marketplace

1. Go to **Admin → Plugins** and search for **EmDash Rating**
2. Click **Install**
3. The plugin activates automatically and seeds default settings

### Manual (local development)

```bash
npm install emdash-rating
```

In `astro.config.mjs`:

```js
import { emDashRatingPlugin } from "emdash-rating";
import emdash from "emdash/astro";

export default defineConfig({
  integrations: [
    emdash({
      plugins: [emDashRatingPlugin()],
    }),
  ],
});
```

---

## Usage

### Front-end widget

The rating widget is injected automatically on any page that includes the EmDash `page:inject` hook. For Astro sites, add the widget HTML to your post template:

```astro
<!-- src/pages/posts/[slug].astro -->
<div class="post-rating" id="post-rating" data-slug={slug}>
  <div class="rating-header">
    <span class="rating-label">Rate this post</span>
    <span class="rating-summary" id="rating-summary"></span>
  </div>
  <div class="rating-stars" id="rating-stars" role="group" aria-label="Rate this post">
    {[1,2,3,4,5].map((n) => (
      <button type="button" class="rating-star" data-value={n} aria-label={`${n} star${n !== 1 ? 's' : ''}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
      </button>
    ))}
  </div>
  <p class="rating-feedback" id="rating-feedback" aria-live="polite"></p>
</div>
```

The widget script fetches settings and stats from the plugin API on page load and wires up click/hover interactions automatically.

### Public API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/_emdash/api/plugins/emdash-rating/public/post?slug=<slug>` | Fetch settings + stats for a post |
| `POST` | `/_emdash/api/plugins/emdash-rating/public/vote` | Submit a vote `{ postSlug, stars }` |

**GET response example:**
```json
{
  "data": {
    "settings": {
      "starColor": "#f59e0b",
      "starSize": "md",
      "successText": "Thanks for your rating!",
      "schemaEnabled": true,
      "schemaType": "BlogPosting"
    },
    "stats": {
      "postSlug": "my-post",
      "totalVotes": 12,
      "totalStars": 52,
      "averageRating": 4.3,
      "distribution": { "1": 0, "2": 1, "3": 1, "4": 5, "5": 5 },
      "updatedAt": "2026-04-09T10:00:00.000Z"
    }
  }
}
```

**POST vote body:**
```json
{ "postSlug": "my-post", "stars": 4 }
```

**POST vote success response:**
```json
{
  "data": {
    "success": true,
    "message": "Thanks for your rating!",
    "stats": { "totalVotes": 13, "averageRating": 4.3, "..." }
  }
}
```

**POST vote duplicate response:**
```json
{
  "data": {
    "error": "already_voted",
    "message": "You have already rated this post."
  }
}
```

---

## Configuration

All settings are managed from **Admin → EmDash Rating → Settings**.

| Setting | Default | Description |
|---------|---------|-------------|
| Star colour | `#f59e0b` (Amber) | Fill colour for highlighted stars. Choose from 10 presets or enter any hex code. |
| Star size | `md` (34px) | Star size: `sm` 24px, `md` 34px, `lg` 46px, `xl` 58px |
| Success message | `Thanks for your rating!` | Text shown to the visitor after they vote |
| Prevent duplicate votes by IP | `true` | Blocks more than one vote per IP address per post |
| Enable Schema.org structured data | `true` | Injects `AggregateRating` JSON-LD into the page `<head>` |
| Schema.org type | `BlogPosting` | The `@type` used in the JSON-LD: `BlogPosting`, `Article`, `LocalBusiness`, `Product`, or `Recipe` |

### Live preview

In the Settings tab, clicking a colour swatch or size button immediately updates both the admin preview image and saves the value — no separate Save click needed for colour and size. The **Save All Settings** button saves the success message, duplicate-vote toggle, and Schema.org options.

---

## Export & Import

### Export

1. Go to **Admin → EmDash Rating → Ratings** or **Settings**
2. Click **Export CSV**
3. Copy the CSV text from the panel and save as a `.csv` file

CSV format:
```
id,postSlug,stars,ip,userAgent,votedAt,edited
"1234-abc","my-post",4,"203.0.113.1","Mozilla/5.0...","2026-04-09T10:00:00.000Z",false
```

### Import

1. Go to **Admin → EmDash Rating → Settings → Import / Export**
2. Paste your CSV (including the header row) into the text area
3. Click **Import Votes**

The importer skips rows with missing or invalid data and reports how many were imported vs skipped. Stats are rebuilt automatically for all affected posts.

---

## Dashboard widget

The **EmDash Rating Overview** widget appears on the EmDash admin home screen and shows:
- Total votes across all posts
- Top 5 highest-voted posts with their average rating

---

## Schema.org structured data

When enabled, the plugin injects an `AggregateRating` block into the page `<head>` after a vote is recorded or when existing stats are loaded:

```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "name": "My Post Title",
  "url": "https://example.com/posts/my-post",
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.3",
    "bestRating": "5",
    "worstRating": "1",
    "ratingCount": 12
  }
}
```

The schema is only injected when at least one vote exists for the post.

---

## Storage

The plugin uses two storage collections:

| Collection | Description |
|------------|-------------|
| `votes` | One document per vote — stores `postSlug`, `stars`, `ip`, `userAgent`, `votedAt`, `edited` |
| `stats` | One document per post — pre-aggregated `totalVotes`, `totalStars`, `averageRating`, `distribution` |

Stats are rebuilt synchronously on every vote submission and on import, so reads are always fast.

---

## Capabilities

| Capability | Reason |
|------------|--------|
| `page:inject` | Injects the rating widget and Schema.org JSON-LD into post pages |

---

## Changelog

### 1.0.0
- Initial release
- 5-star voting widget with live colour and size preview
- Admin dashboard with Ratings, Categories, and Settings tabs
- Duplicate vote protection by IP
- Schema.org `AggregateRating` structured data
- CSV export and import
- Dashboard overview widget

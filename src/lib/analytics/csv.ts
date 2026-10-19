/**
 * CSV import for content analytics (the fallback when no platform connector
 * is configured). Missing values stay null – nothing is estimated or invented.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const ALIASES: Record<string, string[]> = {
  postId: ["post_id", "id", "video_id", "content_id", "url"],
  platform: ["platform", "channel", "network"],
  title: ["title", "caption", "description", "name"],
  postedAt: ["posted_at", "date", "published_at", "publish_time", "created_at"],
  views: ["views", "video_views", "plays", "impressions_views"],
  watchTimeSeconds: ["watch_time_seconds", "watch_time", "total_watch_time"],
  avgRetentionPct: ["avg_retention_pct", "average_retention", "retention", "avg_percentage_viewed"],
  shares: ["shares"],
  saves: ["saves", "bookmarks", "favorites"],
  likes: ["likes", "reactions"],
  comments: ["comments"],
  followerDelta: ["follower_delta", "followers_gained", "new_followers"],
  characters: ["characters", "character"],
  format: ["format", "content_type"],
  theme: ["theme", "topic", "pillar"],
};

const pick = (r: Record<string, string>, key: string) => {
  for (const a of ALIASES[key]) if (r[a] !== undefined && r[a] !== "") return r[a];
  return null;
};
const num = (v: string | null) => {
  if (v === null) return null;
  const n = Number(v.replace(/[,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function mapRow(r: Record<string, string>) {
  const posted = pick(r, "postedAt");
  const d = posted ? new Date(posted) : null;
  return {
    postId: pick(r, "postId"),
    platform: (pick(r, "platform") ?? "unknown").toLowerCase(),
    title: pick(r, "title") ?? "",
    postedAt: d && !Number.isNaN(d.getTime()) ? d : null,
    views: num(pick(r, "views")),
    watchTimeSeconds: num(pick(r, "watchTimeSeconds")),
    avgRetentionPct: num(pick(r, "avgRetentionPct")),
    shares: num(pick(r, "shares")),
    saves: num(pick(r, "saves")),
    likes: num(pick(r, "likes")),
    comments: num(pick(r, "comments")),
    followerDelta: num(pick(r, "followerDelta")),
    characters: (pick(r, "characters") ?? "").split(/[;|]/).map((s) => s.trim()).filter(Boolean),
    format: pick(r, "format"),
    theme: pick(r, "theme"),
  };
}

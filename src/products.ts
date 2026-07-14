/**
 * The Takeout product catalog: what each `Takeout/<folder>` contains, how
 * portable its formats are, and the concrete next step for getting the data
 * into tools you control. Folder names reflect English-locale exports as of
 * mid-2026; `aliases` covers legacy names and common localized spellings.
 *
 * Portability grades:
 *   high   — open, widely-implemented formats (mbox, vCard, iCalendar, media)
 *   medium — documented JSON/CSV that needs a converter or a script
 *   low    — ad-hoc dumps that are readable but rarely importable anywhere
 */
import type { ProductInfo } from "./types.js";

export const PRODUCTS: readonly ProductInfo[] = [
  {
    id: "root",
    folder: "(Takeout root)",
    aliases: [],
    summary: "Files Google places directly under Takeout/: the archive_browser.html index of your export.",
    formats: "HTML index",
    portability: "high",
    nextSteps: [
      "Open archive_browser.html in any browser for Google's own map of the export.",
    ],
  },
  {
    id: "photos",
    folder: "Google Photos",
    aliases: ["Google Fotos", "Google Foto"],
    summary: "Your photo and video library, one folder per album/year, each media file paired with a JSON metadata sidecar.",
    formats: "JPEG/HEIC/PNG/MP4 media plus one *.json sidecar per item",
    portability: "high",
    nextSteps: [
      "The JSON sidecars, not the files' EXIF, hold the authoritative timestamps, descriptions and GPS Google stripped or edited — merge them back with exiftool or a dedicated Takeout photo fixer before importing anywhere.",
      "Self-host the library with Immich or PhotoPrism; both understand Takeout sidecars on import.",
      "Watch for edited duplicates: `IMG_x.jpg` and `IMG_x-edited.jpg` both appear when a photo was edited in Google Photos.",
    ],
  },
  {
    id: "mail",
    folder: "Mail",
    aliases: ["Correo", "E-Mail"],
    summary: "Your entire Gmail history as mbox mailboxes, labels preserved as X-Gmail-Labels headers.",
    formats: "mbox (usually one large 'All mail Including Spam and Trash.mbox')",
    portability: "high",
    nextSteps: [
      "Import the .mbox straight into Thunderbird (ImportExportTools NG) to browse and re-file it.",
      "For a searchable archive, convert to Maildir with `mb2md` and index with notmuch or mu.",
      "Labels survive as `X-Gmail-Labels:` headers — filter on them when splitting the mailbox.",
    ],
  },
  {
    id: "drive",
    folder: "Drive",
    aliases: ["Google Drive"],
    summary: "Your Drive tree; uploaded files come back as-is, native Docs/Sheets/Slides are converted to the formats you chose.",
    formats: "original uploads unchanged; Docs as docx/odt, Sheets as xlsx/ods, Slides as pptx, comments in separate files",
    portability: "high",
    nextSteps: [
      "Converted Docs/Sheets/Slides open cleanly in LibreOffice or OnlyOffice; spot-check complex documents, since comments land in sibling files.",
      "Move the tree into Nextcloud or a Syncthing folder to keep the sync workflow without the account.",
      "Shared-with-me files are NOT included — only items you own export.",
    ],
  },
  {
    id: "youtube",
    folder: "YouTube and YouTube Music",
    aliases: ["YouTube", "YouTube und YouTube Music"],
    summary: "Watch/search history, playlists, subscriptions, comments — and your own uploads as full video files.",
    formats: "history as JSON or HTML, playlists/subscriptions as CSV, uploads as original MP4/MKV",
    portability: "medium",
    nextSteps: [
      "subscriptions.csv imports into NewPipe or FreeTube for account-free following.",
      "Your uploaded videos export at original quality here — this is the only complete backup of your channel.",
      "Prefer JSON history over HTML (choose it in the Takeout format options) if you plan to analyze it with jq.",
    ],
  },
  {
    id: "contacts",
    folder: "Contacts",
    aliases: ["Kontakte", "Contactos"],
    summary: "Every contact group as vCard and CSV, including the auto-collected 'All Contacts'.",
    formats: "vCard (.vcf) and CSV per group",
    portability: "high",
    nextSteps: [
      "The .vcf files import directly into any CardDAV server (Nextcloud, Radicale) or straight onto a phone.",
      "Deduplicate before importing: 'All Contacts' includes every address you ever mailed once.",
    ],
  },
  {
    id: "calendar",
    folder: "Calendar",
    aliases: ["Kalender", "Calendario"],
    summary: "Each calendar as a standalone iCalendar file, recurring events and reminders included.",
    formats: "iCalendar (.ics), one file per calendar",
    portability: "high",
    nextSteps: [
      "Import each .ics into a CalDAV server (Nextcloud Calendar, Radicale) or Thunderbird.",
      "Events on calendars you subscribe to but don't own are not exported.",
    ],
  },
  {
    id: "chrome",
    folder: "Chrome",
    aliases: [],
    summary: "Synced browser data: bookmarks, history, autofill, extensions list, settings.",
    formats: "Bookmarks.html plus JSON files per data type",
    portability: "medium",
    nextSteps: [
      "Bookmarks.html imports into Firefox or any Chromium fork directly.",
      "Saved passwords are NOT here — export them separately as CSV from passwords.google.com before closing the account.",
      "History and autofill are JSON dumps for reference; no browser imports them directly.",
    ],
  },
  {
    id: "timeline",
    folder: "Timeline",
    aliases: ["Location History (Timeline)", "Location History"],
    summary: "Everywhere your account was: raw location records and per-day 'semantic' visits and routes.",
    formats: "JSON (Records.json, Semantic Location History per month)",
    portability: "medium",
    nextSteps: [
      "Community converters turn Records.json into GPX/KML for any mapping tool; self-hosted timeline viewers such as Dawarich ingest it directly.",
      "Since Timeline moved on-device in 2024, this folder may be small or absent — the full history now exports from the phone itself.",
    ],
  },
  {
    id: "keep",
    folder: "Keep",
    aliases: ["Google Keep"],
    summary: "Every note as paired JSON + HTML, with attachments and label metadata alongside.",
    formats: "JSON + HTML per note, PNG/JPEG/3GP attachments",
    portability: "medium",
    nextSteps: [
      "Joplin imports the Keep export zip directly (File > Import); Obsidian and Standard Notes have community converters for the JSON.",
      "The JSON carries labels, colors, pinned state and checklist structure the HTML flattens — keep it even if you only read the HTML.",
    ],
  },
  {
    id: "myactivity",
    folder: "My Activity",
    aliases: ["Meine Aktivitäten"],
    summary: "Per-service activity logs: every search, every ad click, every Assistant command.",
    formats: "HTML or JSON per service (chosen at export time)",
    portability: "medium",
    nextSteps: [
      "Re-export with JSON selected if you got HTML — the JSON is greppable and jq-friendly, the HTML is enormous.",
      "This is the folder to read before deciding what to delete at myactivity.google.com; it is a record, not importable data.",
    ],
  },
  {
    id: "fit",
    folder: "Fit",
    aliases: ["Google Fit"],
    summary: "Workout sessions and daily aggregates from Google Fit.",
    formats: "TCX per session, CSV daily aggregates",
    portability: "medium",
    nextSteps: [
      "TCX sessions upload into self-hosted fitness trackers or convert to GPX with standard tools.",
      "Daily aggregate CSVs open in any spreadsheet; column meanings are in Google's Fit data documentation.",
    ],
  },
  {
    id: "fitbit",
    folder: "Fitbit",
    aliases: [],
    summary: "Complete Fitbit device history: sleep, steps, heart rate, exercises, SpO2.",
    formats: "JSON and CSV per data domain",
    portability: "medium",
    nextSteps: [
      "Gadgetbridge and several community dashboards import Fitbit Takeout JSON for continued self-hosted tracking.",
      "Heart-rate JSON is per-reading and very large — budget disk accordingly.",
    ],
  },
  {
    id: "tasks",
    folder: "Tasks",
    aliases: ["Google Tasks"],
    summary: "All task lists with completion state and due dates.",
    formats: "single JSON dump",
    portability: "low",
    nextSteps: [
      "Short community scripts convert Tasks JSON to CalDAV VTODO for Nextcloud Tasks or Tasks.org.",
    ],
  },
  {
    id: "voice",
    folder: "Voice",
    aliases: ["Google Voice"],
    summary: "Google Voice call history, voicemails, texts and greetings.",
    formats: "HTML per conversation, MP3 voicemails/greetings",
    portability: "medium",
    nextSteps: [
      "The MP3s are plain audio — archive them as-is; the HTML threads print or convert to PDF for records.",
    ],
  },
  {
    id: "chat",
    folder: "Google Chat",
    aliases: ["Hangouts"],
    summary: "Chat spaces and DMs (and legacy Hangouts) as JSON threads with attachments.",
    formats: "messages.json per space/DM, attachments alongside",
    portability: "low",
    nextSteps: [
      "Community viewers render Chat/Hangouts JSON as browsable HTML; no messenger imports it directly.",
    ],
  },
  {
    id: "play",
    folder: "Google Play Store",
    aliases: ["Google Play"],
    summary: "App install/order/redemption history and Play settings.",
    formats: "JSON per record type",
    portability: "low",
    nextSteps: [
      "Installs.json is your app list — useful as a checklist when rebuilding a phone from F-Droid/Aurora.",
    ],
  },
  {
    id: "maps",
    folder: "Maps (your places)",
    aliases: ["Maps"],
    summary: "Starred places, saved places and your reviews.",
    formats: "GeoJSON and JSON",
    portability: "medium",
    nextSteps: [
      "Saved Places.json is GeoJSON — it loads directly into QGIS, umap or any GeoJSON-aware map for re-pinning in OsmAnd/Organic Maps.",
    ],
  },
  {
    id: "saved",
    folder: "Saved",
    aliases: [],
    summary: "Your saved collections (links, images, places) from Google's 'Saved' feature.",
    formats: "CSV per collection",
    portability: "medium",
    nextSteps: [
      "The CSVs are just titles + URLs — import them into a bookmark manager such as linkding or Shiori.",
    ],
  },
  {
    id: "pay",
    folder: "Google Pay",
    aliases: [],
    summary: "Transaction history and loyalty/pass records from Google Pay.",
    formats: "CSV and PDF statements",
    portability: "medium",
    nextSteps: [
      "The transaction CSV imports into accounting tools (Firefly III, GnuCash) after a column mapping.",
    ],
  },
  {
    id: "home",
    folder: "Home App",
    aliases: ["Google Home"],
    summary: "Your Google Home structure: homes, rooms, registered devices.",
    formats: "JSON",
    portability: "low",
    nextSteps: [
      "Use the device list as the migration checklist when moving to Home Assistant.",
    ],
  },
  {
    id: "nest",
    folder: "Nest",
    aliases: [],
    summary: "Nest device data: camera clips and snapshots, sensor history.",
    formats: "MP4 clips, JPEG snapshots, CSV sensor logs",
    portability: "medium",
    nextSteps: [
      "Clips and CSVs are standard formats — archive them; sensor CSVs graph in any spreadsheet or Grafana.",
    ],
  },
  {
    id: "blogger",
    folder: "Blogger",
    aliases: [],
    summary: "Your blogs: posts, pages and comments as an Atom feed, plus uploaded media.",
    formats: "Atom XML per blog, media files",
    portability: "medium",
    nextSteps: [
      "WordPress imports Blogger Atom natively; blog2md-style converters turn it into Markdown for Hugo/Jekyll.",
    ],
  },
  {
    id: "groups",
    folder: "Groups",
    aliases: ["Google Groups"],
    summary: "Message archives and member lists for Google Groups you own.",
    formats: "mbox per group, CSV member lists",
    portability: "high",
    nextSteps: [
      "The mbox archives migrate into any list software (Mailman 3 imports mbox) or browse in Thunderbird.",
    ],
  },
  {
    id: "profile",
    folder: "Profile",
    aliases: [],
    summary: "Your account profile: names, photo, birthday, contact info.",
    formats: "JSON plus the profile photo",
    portability: "low",
    nextSteps: [
      "Nothing to migrate — keep it as the record of what the account claimed about you.",
    ],
  },
  {
    id: "search-contributions",
    folder: "Search Contributions",
    aliases: [],
    summary: "Reviews, ratings and Q&A you contributed through Google Search.",
    formats: "JSON",
    portability: "low",
    nextSteps: [
      "Keep as a personal record; reviews are not importable into other platforms.",
    ],
  },
  {
    id: "access-log",
    folder: "Access Log Activity",
    aliases: [],
    summary: "A security audit trail: which Google services accessed your account data, from where.",
    formats: "CSV",
    portability: "low",
    nextSteps: [
      "Skim it once for surprises (unexpected devices/locations), then archive; it has no other use.",
    ],
  },
  {
    id: "android-config",
    folder: "Android Device Configuration Service",
    aliases: [],
    summary: "Hardware attributes and settings of every Android device that touched the account.",
    formats: "HTML per device",
    portability: "low",
    nextSteps: [
      "Safe to ignore for migration — it is device metadata, not user data.",
    ],
  },
  {
    id: "account",
    folder: "Google Account",
    aliases: [],
    summary: "Subscriber info and account activity summary.",
    formats: "HTML and JSON",
    portability: "low",
    nextSteps: [
      "Keep for records; contains no importable data.",
    ],
  },
  {
    id: "street-view",
    folder: "Street View",
    aliases: [],
    summary: "360 imagery you published to Street View.",
    formats: "JPEG panoramas with embedded XMP",
    portability: "high",
    nextSteps: [
      "The panoramas keep their photosphere XMP — they re-upload to Mapillary or Panoramax as-is.",
    ],
  },
  {
    id: "news",
    folder: "News",
    aliases: ["Google News"],
    summary: "Followed topics, sources and saved stories from Google News.",
    formats: "TXT lists",
    portability: "low",
    nextSteps: [
      "Recreate the source list as RSS feeds in a self-hosted reader (FreshRSS, Miniflux).",
    ],
  },
] as const;

/** Advice attached to folders the catalog does not recognize. */
export const UNKNOWN_ADVICE =
  "Not in the catalog — open the folder's files directly (Takeout data is always plain files) and check Google's per-product export docs.";

const byName = new Map<string, ProductInfo>();
for (const p of PRODUCTS) {
  byName.set(p.folder.toLowerCase(), p);
  for (const alias of p.aliases) byName.set(alias.toLowerCase(), p);
}

const byId = new Map<string, ProductInfo>(PRODUCTS.map((p) => [p.id, p]));

/** Resolve a `Takeout/<folder>` name to a catalog entry, or null. */
export function resolveProduct(folderName: string): ProductInfo | null {
  return byName.get(folderName.trim().toLowerCase()) ?? null;
}

/** Look a product up by its stable id (as used with `--only`). */
export function productById(id: string): ProductInfo | null {
  return byId.get(id.trim().toLowerCase()) ?? null;
}

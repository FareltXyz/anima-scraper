# AnimaScraper

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Express](https://img.shields.io/badge/framework-Express%205-lightgrey.svg)](https://expressjs.com/)
[![Cheerio](https://img.shields.io/badge/scraper-Cheerio%201.2-orange.svg)](https://cheerio.js.org/)

**AnimaScraper** is a high-speed, modular anime scraping microservice and REST API written in Node.js. It extracts structured anime metadata, rankings, seasonal schedules, character details, voice actors, streaming mirrors, and multi-resolution download links with zero third-party API keys required.

It features a unique **Cross-Provider Linker** that allows you to query streaming episodes and download links directly using standard **MyAnimeList Numeric IDs**, eliminating the need to look up arbitrary fansub URL slugs manually.

---

## Table of Contents

- [Overview & Architecture](#overview--architecture)
- [Key Features](#key-features)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running the Application](#running-the-application)
- [Web Interface & Interactive Docs](#web-interface--interactive-docs)
- [API Reference](#api-reference)
  - [Service Status & Info](#service-status--info)
  - [MyAnimeList Provider Endpoints](#myanimelist-provider-endpoints)
  - [Sokuja ID Provider Endpoints](#sokuja-id-provider-endpoints)
    - [Direct MyAnimeList ID Access (Dual-Mode)](#direct-myanimelist-id-access-dual-mode)
    - [Native Sokuja Endpoints](#native-sokuja-endpoints)
  - [Sakunime Provider Endpoints](#sakunime-provider-endpoints)
    - [Prefixed Slugs & Multi-Server Architecture](#prefixed-slugs--multi-server-architecture)
    - [Sakunime Endpoints & Dual-Mode MAL ID Access](#sakunime-endpoints--dual-mode-mal-id-access)
- [Programmatic SDK Usage](#programmatic-sdk-usage)
- [Cross-Provider Heuristic Linker (MAL Bridge)](#cross-provider-heuristic-linker-mal-bridge)
- [Error Handling & Standard Responses](#error-handling--standard-responses)
- [License & Disclaimer](#license--disclaimer)

---

## Overview & Architecture

AnimaScraper bridges global metadata and multi-server streaming providers into a unified API:

```
                              ┌────────────────────────────────────────┐
                              │             Client Request             │
                              └───────────────────┬────────────────────┘
                                                  │
            ┌──────────────────────────┬──────────┴───────────────┬──────────────────┐
            │                          │                          │                  │
            ▼                          ▼                          ▼                  ▼
  /api/v1/myanimelist          /api/v1/sokujaId           /api/v1/sakunime     Web UI (/ & /docs)
            │                          │                          │
            ▼                          ▼                          ▼
┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐
│   MyAnimeList Engine  │  │   Sokuja ID Engine    │  │    Sakunime Engine    │
│  (Scores, Synopsis,   │  │  (Streaming Mirrors,  │  │ (3-Server Aggregator, │
│   Staff, Taxonomy)    │  │   Multi-res Downloads)│  │  HLS + AI Subtitles)  │
└───────────┬───────────┘  └───────────┬───────────┘  └───────────┬───────────┘
            │                          │                          │
            └──────────────────────────┼──────────────────────────┘
                                       ▼
                        ┌─────────────────────────────┐
                        │  Cross-Provider MAL Bridge  │
                        │ MalSokujaLinker &           │
                        │ MalSakunimeLinker           │
                        └─────────────────────────────┘
```

1. **MyAnimeList (`myanimelist`)**: Extracts comprehensive global anime metadata, official English & alternative titles, ratings, synopsis, ranked top lists, seasonal schedules, episode lists, character voice actors, user recommendations, and production studios.
2. **Sokuja ID (`sokujaId`)**: Extracts Indonesian subtitled releases, multi-server streaming video embeds (`.mp4`), direct resolution download links (360p - 1080p), and weekly broadcast schedules.
3. **Sakunime (`sakunime`)**: Aggregates 3 upstream servers (`hid~` / `hi~` Server 1 with 1080p HLS `.m3u8` + AI Indonesian/English/multi-lang WebVTT subtitles & dubs, `sm~` Server 2 Samehadaku Sub Indo, and unprefixed Server 3 Otakudesu Sub Indo) with on-demand server stream resolution and multi-resolution downloads.
4. **Cross-Provider MAL Bridge (`MalSokujaLinker` & `MalSakunimeLinker`)**: Bridges numeric MyAnimeList IDs (e.g., `52991` for *Sousou no Frieren*) directly into Sokuja ID and Sakunime streaming data using token similarity, Roman numeral detection, part/cour parsing, release year verification, and media type matching.

---

## Key Features

- **Zero API Key Dependencies**: Scrapes and parses clean structured JSON directly from HTML without third-party API rate limits or subscription fees.
- **Next.js RSC Flight & Suspense Hydration**: Accurately parses modern Next.js 14/15 App Router streaming chunks (`<template id="B:N">`, `self.__next_f.push`) to obtain full episode lists and embedded streaming mirrors.
- **Built-in In-Memory Caching**: Intelligent TTL-based caching for HTML responses, JSON payloads, and cross-provider ID mapping to ensure rapid response times and minimal external load.
- **Dual-Mode Sokuja Routing**: Access anime and episode streams either via fansub slug (`sousou-no-frieren-subtitle-indonesia`) or directly by numeric MyAnimeList ID (`52991`).
- **Standardized Error Handling**: Strict HTTP status codes (`400`, `404`, `429`, `501`, `502`) with informative error messages.
- **Interactive UI & Playground**: Includes a dark/light responsive landing page and interactive documentation playground at `/docs`.

---

## Project Structure

```
anima-scraper/
├── index.js                      # Express application entrypoint & middleware
├── package.json                  # Project dependencies & scripts
├── public/
│   ├── index.html                # Responsive landing page
│   ├── docs.html                 # Interactive API documentation & playground
│   └── logo.png                  # Project logo
├── routes/
│   ├── myanimelist.js            # Express router for MyAnimeList endpoints
│   ├── sokujaId.js               # Express router for Sokuja ID endpoints
│   └── sakunime.js               # Express router for Sakunime endpoints
└── scraper/
    ├── index.js                  # Unified AnimaScraper facade & factory
    ├── malLinker.js              # Heuristic MAL-to-Sokuja & MAL-to-Sakunime matcher
    └── providers/
        ├── myanimelist.js        # MyAnimeList scraping engine & parser
        ├── sokujaId.js           # Sokuja ID scraping engine & RSC parser
        └── sakunime.js           # Sakunime multi-server JSON proxy scraper
```

---

## Getting Started

### Prerequisites

- **Node.js**: Version **18.0.0** or higher (requires native `fetch` support).
- **npm**: Version **8.0.0** or higher.

### Installation

1. Clone or download the repository:
   ```bash
   git clone https://github.com/your-username/anima-scraper.git
   cd anima-scraper
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application

- **Production / Standard Mode**:
  ```bash
  npm start
  ```
- **Custom Port**:
  ```bash
  PORT=8080 npm start
  ```

Once running, the console will output:
```
🚀 Server running at http://localhost:3000
👉 Mode: development
```

---

## Web Interface & Interactive Docs

- **Landing Page**: [`http://localhost:3000/`](http://localhost:3000/)  
  Features service statistics, live architecture breakdown, and quicklinks.
- **Interactive Documentation**: [`http://localhost:3000/docs`](http://localhost:3000/docs)  
  Includes full endpoint specifications, request parameter tables, response schemas, and a **Live API Playground** to test requests directly in your browser.

---

## API Reference

All JSON endpoints return a standardized payload with `status: "success"` or `status: "error"`.

### Service Status & Info

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Server health check and uptime monitor |
| `GET` | `/api/v1/info` | Service version, active providers, and description |

---

### MyAnimeList Provider Endpoints

Base path: `/api/v1/myanimelist`

#### 1. Search Anime
```http
GET /api/v1/myanimelist/search?q=frieren&page=1
```
- Query Parameters:
  - `q` *(required)*: Anime title search query (string).
  - `page` *(optional, default: 1)*: Page number.

#### 2. Top Ranked Anime
```http
GET /api/v1/myanimelist/top?type=all&page=1
```
- Query Parameters:
  - `type` *(optional, default: "all")*: `all`, `airing`, `upcoming`, `tv`, `movie`, `ova`, `ona`, `special`, `bypopularity`, `favorite`.
  - `page` *(optional, default: 1)*: Page number (50 items per page).

#### 3. Seasonal Anime
```http
GET /api/v1/myanimelist/season
GET /api/v1/myanimelist/season/:year/:season
```
- Example: `GET /api/v1/myanimelist/season/2026/fall`
- Path Parameters:
  - `year`: 4-digit year (e.g. `2024`, `2026`).
  - `season`: `winter`, `spring`, `summer`, `fall`.

#### 4. Weekly Broadcast Schedule
```http
GET /api/v1/myanimelist/schedule?day=friday
```
- Query Parameters:
  - `day` *(optional)*: `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday`, `other`.

#### 5. Anime Details by ID
```http
GET /api/v1/myanimelist/anime/:id
```
- Example: `GET /api/v1/myanimelist/anime/52991` (*Sousou no Frieren*)
- Returns: English title, Japanese title, score, ranked position, popularity, member count, synopsis, genres, studios, airing status, duration, rating, streaming platforms, and external links.

#### 6. Anime Episodes List
```http
GET /api/v1/myanimelist/anime/:id/episodes?page=1
```
- Example: `GET /api/v1/myanimelist/anime/52991/episodes?page=1`
- Returns: Episode numbers, English/Romanized/Japanese episode titles, original air dates, and forum discussion links.

#### 7. Characters & Voice Actors (Staff)
```http
GET /api/v1/myanimelist/anime/:id/characters
```
- Example: `GET /api/v1/myanimelist/anime/52991/characters`
- Returns: Main and supporting characters with high-resolution portrait images, character roles, and voice actors (Seiyuu) grouped by language.

#### 8. User Recommendations
```http
GET /api/v1/myanimelist/anime/:id/recommendations
```
- Example: `GET /api/v1/myanimelist/anime/52991/recommendations`
- Returns: Community recommendations with target anime metadata and user explanations.

#### 9. Taxonomy & Directory Lookups
```http
GET /api/v1/myanimelist/genres
GET /api/v1/myanimelist/genre/:id?page=1
GET /api/v1/myanimelist/producer/:id?page=1&limit=50
```
- `genres`: Returns all genre, theme, and demographic IDs with total entry counts.
- `genre/:id`: Lists anime filtered by genre ID (e.g. `1` for Action).
- `producer/:id`: Lists anime produced by a studio or company ID (e.g. `11` for Madhouse).

---

### Sokuja ID Provider Endpoints

Base path: `/api/v1/sokujaId`

#### Direct MyAnimeList ID Access (Dual-Mode)

You do **not** need to guess or scrape fansub title slugs. The Sokuja ID router accepts numeric MyAnimeList IDs directly:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/sokujaId/:malId` | Fetch full Sokuja anime details using MAL ID (e.g. `/52991`) |
| `GET` | `/api/v1/sokujaId/:malId/episodes` | List all episodes for an anime using MAL ID |
| `GET` | `/api/v1/sokujaId/:malId/episode/:number` | **Fetch streaming video mirrors & downloads by episode number** (e.g. `/52991/episode/28`) |
| `GET` | `/api/v1/sokujaId/:malId/characters` | Fetch cast & voice actors for an anime using MAL ID |
| `GET` | `/api/v1/sokujaId/:malId/recommendations` | Fetch recommendations for an anime using MAL ID |
| `GET` | `/api/v1/sokujaId/resolve/:malId` | Test cross-provider match and return confidence score |

#### Native Sokuja Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/sokujaId/home?page=1` | Homepage slider, latest updates, ongoing, completed, and top series |
| `GET` | `/api/v1/sokujaId/latest?page=1` | Paginated latest episode releases |
| `GET` | `/api/v1/sokujaId/search?q=:query&page=1` | Keyword search across the Sokuja catalog |
| `GET` | `/api/v1/sokujaId/browse?...` | Filter catalog by genre, studio, season, status, type, and order |
| `GET` | `/api/v1/sokujaId/ongoing?page=1` | Currently airing anime series |
| `GET` | `/api/v1/sokujaId/completed?page=1` | Finished/completed anime catalog |
| `GET` | `/api/v1/sokujaId/movies?page=1` | Anime movies catalog |
| `GET` | `/api/v1/sokujaId/top?type=score&page=1` | Top anime ranked by score or popularity |
| `GET` | `/api/v1/sokujaId/anime-list?letter=S` | Full alphabetical A-Z catalog |
| `GET` | `/api/v1/sokujaId/schedule?day=friday` | Release schedule filtered by day |
| `GET` | `/api/v1/sokujaId/genres` | All genre taxonomy categories |
| `GET` | `/api/v1/sokujaId/genre/:slug?page=1` | Anime listing filtered by genre slug |
| `GET` | `/api/v1/sokujaId/seasons` | All seasonal archives (e.g. `winter-2026`, `fall-2023`) |
| `GET` | `/api/v1/sokujaId/season/:slug?page=1` | Anime listing filtered by season slug |
| `GET` | `/api/v1/sokujaId/studios` | All animation studios |
| `GET` | `/api/v1/sokujaId/studio/:slug?page=1` | Anime listing filtered by studio slug |
| `GET` | `/api/v1/sokujaId/cast/:slug?page=1` | Anime listing filtered by voice actor/cast slug |
| `GET` | `/api/v1/sokujaId/director/:slug?page=1` | Anime listing filtered by director slug |
| `GET` | `/api/v1/sokujaId/anime/:slug` | Anime detail by original Sokuja slug |
| `GET` | `/api/v1/sokujaId/episode/:episodeSlug` | Episode detail, streaming mirrors & downloads by episode slug |

---

### Sakunime Provider Endpoints

Base path: `/api/v1/sakunime`

#### Prefixed Slugs & Multi-Server Architecture

Sakunime (`https://sakunime.com`) aggregates three upstream streaming servers distinguished by slug prefixes:
- **Server 1 (`hid~` / `hi~`)**: e.g. `hid~frieren-beyond-journeys-end-154587` — 1080p HLS `.m3u8` master playlists, Sakunime HLS proxy URLs, WebVTT subtitles (`Indonesia (AI)`, `English`, etc.), iframe fallbacks, and English Dub options.
- **Server 2 (`sm~`)**: e.g. `sm~sousou-no-frieren` — Samehadaku Indonesian subtitled embeds and multi-resolution cloud downloads.
- **Server 3 (unprefixed)**: e.g. `frieren-sub-indo` — Otakudesu Indonesian subtitled embeds and downloads.

Catalog and search endpoints accept an optional `?server=` query filter (`all`, `hid`, `sm`, `otaku`).

#### Sakunime Endpoints & Dual-Mode MAL ID Access

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/sakunime/anime/:idOrSlug` | Anime detail by prefixed slug (e.g. `hid~frieren-beyond-journeys-end-154587`) or MAL ID (`52991`) |
| `GET` | `/api/v1/sakunime/anime/:idOrSlug/episodes` | Paginated & sortable episode list (`?page=1&limit=100&order=asc`) |
| `GET` | `/api/v1/sakunime/anime/:idOrSlug/episode/:number` | **Fetch HLS stream, subtitles, mirrors & downloads** (`?type=sub\|dub`) |
| `GET` | `/api/v1/sakunime/anime/:idOrSlug/recommendations` | Related / recommended anime |
| `GET` | `/api/v1/sakunime/episode/:episodeSlug` | Episode stream by episode slug (e.g. `hid~frieren-beyond-journeys-end-154587~1~1`; alias `/watch/:slug`) |
| `GET` | `/api/v1/sakunime/server/:serverId` | Resolve individual server ID (`hie~...`, `sms~...`, or Server 3 ID) to playable URL |
| `GET` | `/api/v1/sakunime/:malId` | Direct Dual-Mode anime detail via numeric MAL ID (e.g. `/52991`) |
| `GET` | `/api/v1/sakunime/:malId/episode/:number` | Direct Dual-Mode episode stream via numeric MAL ID (e.g. `/52991/episode/1`) |
| `GET` | `/api/v1/sakunime/resolve/:malId` | Resolve numeric MAL ID to Sakunime slug with confidence & server alternatives |
| `GET` | `/api/v1/sakunime/home?page=1&server=all` | Homepage featured hero, latest releases, ongoing, completed, popular & genres |
| `GET` | `/api/v1/sakunime/latest?page=1` | Paginated latest episode updates |
| `GET` | `/api/v1/sakunime/search?q=:query&server=all` | Multi-server keyword search |
| `GET` | `/api/v1/sakunime/browse?...` | Filter catalog by `genre`, `status`, `type`, `order`, `server`, and `page` |
| `GET` | `/api/v1/sakunime/ongoing?page=1&server=all` | Ongoing anime across Sakunime servers |
| `GET` | `/api/v1/sakunime/completed?page=1&server=all` | Completed anime catalog |
| `GET` | `/api/v1/sakunime/movies?page=1` | Anime movies catalog |
| `GET` | `/api/v1/sakunime/top?type=popular&page=1` | Top / popular anime (`popular`, `score`, `ongoing`, `movie`) |
| `GET` | `/api/v1/sakunime/anime-list?letter=S` | Alphabetical A-Z directory |
| `GET` | `/api/v1/sakunime/schedule?day=friday` | Merged 3-server weekly broadcast schedule |
| `GET` | `/api/v1/sakunime/genres` | Unified genre taxonomy list |
| `GET` | `/api/v1/sakunime/genre/:slug?page=1&server=all` | Anime catalog filtered by genre slug |

---

## Programmatic SDK Usage

You can use the scraper directly in Node.js scripts without starting the HTTP server:

```javascript
const { AnimaScraper } = require('./scraper');

async function main() {
  // 1. Initialize MyAnimeList provider
  const mal = new AnimaScraper({ provider: 'myanimelist' });
  const anime = await mal.getAnimeById(52991);
  console.log(`Title: ${anime.title} | Score: ${anime.score}`);

  // 2. Initialize Sokuja ID provider
  const sokuja = new AnimaScraper({ provider: 'sokujaId' });
  const streamData = await sokuja.getAnimeEpisode(52991, 28);
  console.log(`Sokuja Episode: ${streamData.title}`);

  // 3. Initialize Sakunime provider (Prefixed Slugs & Multi-Server HLS)
  const sakunime = new AnimaScraper({ provider: 'sakunime' });
  const sakuAnime = await sakunime.getAnimeDetail('hid~frieren-beyond-journeys-end-154587');
  console.log(`Sakunime: ${sakuAnime.title} (${sakuAnime.episodeCount} eps)`);

  const sakuStream = await sakunime.getAnimeEpisode('hid~frieren-beyond-journeys-end-154587', 1);
  console.log('HLS Master Playlist:', sakuStream.hlsUrl);
  console.log('Subtitles:', sakuStream.subtitles.slice(0, 3));
}

main().catch(console.error);
```

---

## Cross-Provider Heuristic Linker (MAL Bridge)

When you make a request to `/api/v1/sokujaId/:malId` or `/api/v1/sakunime/:malId`:

1. **Metadata Acquisition**: AnimaScraper fetches title variations (canonical, English, synonyms), release year, media format, and episode count from MyAnimeList.
2. **Title Normalization**:
   - Strips fansub stop-words (e.g., `subtitle indonesia`, `sub indo`).
   - Translates Roman numerals (`II`, `III`, `IV`, `V`) to numeric seasons (`2`, `3`, etc.).
   - Recognizes multi-cour designations (`Part 1`, `Part 2`, `Zenpen`, `Kouhen`).
3. **Similarity Scoring**:
   - Computes Dice token similarity across full title and core title tokens.
   - Applies score penalties for season discrepancies and media type mismatches (e.g., movie vs. TV).
   - Validates against premiere year with a tolerance window.
4. **Resolution Threshold**:
   - Matches with confidence $\ge 0.62$ are automatically linked and cached in memory.

---

## Error Handling & Standard Responses

All error responses return a standardized JSON format:

```json
{
  "status": "error",
  "message": "Anime ID must be a positive integer."
}
```

Common status codes:
- `200 OK`: Request succeeded.
- `400 Bad Request`: Missing or invalid query/path parameters.
- `404 Not Found`: Resource or anime title does not exist.
- `429 Too Many Requests`: Upstream provider rate limit encountered.
- `501 Not Implemented`: Provider does not support the requested method.
- `502 Bad Gateway`: Failed to connect to or parse the upstream provider response.

---

## License & Disclaimer

- **License**: [MIT License](LICENSE).
- **Disclaimer**: This tool is developed strictly for educational and personal research purposes. AnimaScraper does not host, store, or distribute any media files or videos on its servers; it merely structures publicly available web pages. Please respect the terms of service of the respective content providers.

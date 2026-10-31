const cheerio = require('cheerio');
const { ScraperError } = require('./myanimelist');
const { MalSokujaLinker } = require('../malLinker');

function isNumericMalId(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0;
  if (typeof value === 'string') return /^\d+$/.test(value.trim());
  return false;
}

const BASE_URL = 'https://x6.sokuja.uk';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: `${BASE_URL}/`
};

const VALID_ORDERS = new Set([
  'update',
  'newest',
  'oldest',
  'title_az',
  'title_za',
  'score',
  'popular'
]);

const VALID_STATUSES = new Set(['ongoing', 'completed', 'upcoming']);
const VALID_TYPES = new Set(['tv', 'movie', 'ova', 'ona', 'special']);
const VALID_SUBS = new Set(['softsub', 'hardsub']);

const DAY_ALIASES = {
  monday: 'senin',
  senin: 'senin',
  mon: 'senin',
  tuesday: 'selasa',
  selasa: 'selasa',
  tue: 'selasa',
  wednesday: 'rabu',
  rabu: 'rabu',
  wed: 'rabu',
  thursday: 'kamis',
  kamis: 'kamis',
  thu: 'kamis',
  friday: 'jumat',
  jumat: 'jumat',
  "jum'at": 'jumat',
  fri: 'jumat',
  saturday: 'sabtu',
  sabtu: 'sabtu',
  sat: 'sabtu',
  sunday: 'minggu',
  minggu: 'minggu',
  ahad: 'minggu',
  sun: 'minggu',
  random: 'random / belum pasti',
  'random / belum pasti': 'random / belum pasti',
  libur: 'libur',
  hiatus: 'hiatus',
  end: 'sudah selesai (end)',
  completed: 'sudah selesai (end)',
  'sudah selesai (end)': 'sudah selesai (end)'
};

/**
 * Normalize relative Sokuja URLs to absolute URLs on BASE_URL
 */
function toAbsoluteUrl(href, baseUrl = BASE_URL) {
  if (!href) return null;
  const trimmed = String(href).trim();
  if (!trimmed || trimmed === '#') return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return `${baseUrl}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
}

/**
 * Extract clean slug from a Sokuja URL or path.
 * Supports:
 * - "https://x6.sokuja.uk/anime/sousou-no-frieren-subtitle-indonesia/" -> "sousou-no-frieren-subtitle-indonesia"
 * - "/anime/sousou-no-frieren-season-2-subtitle-indonesia/" -> "sousou-no-frieren-season-2-subtitle-indonesia"
 * - "/end-sousou-no-frieren-episode-28-subtitle-indonesia/" -> "end-sousou-no-frieren-episode-28-subtitle-indonesia"
 * - "/genre/action/" (with prefix="genre") -> "action"
 */
function extractSlug(input, prefix = null) {
  if (!input) return null;
  let pathname = String(input).trim();
  if (!pathname) return null;

  try {
    if (pathname.startsWith('http://') || pathname.startsWith('https://')) {
      pathname = new URL(pathname).pathname;
    } else {
      pathname = pathname.split('?')[0].split('#')[0];
    }
  } catch {
    pathname = pathname.split('?')[0].split('#')[0];
  }

  pathname = pathname.replace(/^\/+|\/+$/g, '');
  if (!pathname) return null;

  if (prefix) {
    const prefixClean = String(prefix).replace(/^\/+|\/+$/g, '');
    if (pathname.toLowerCase().startsWith(`${prefixClean.toLowerCase()}/`)) {
      pathname = pathname.slice(prefixClean.length + 1);
    }
  }

  // Extract the clean last segment
  const segments = pathname.split('/').filter(Boolean);
  return segments.length ? decodeURIComponent(segments[segments.length - 1]) : null;
}

/**
 * Parse numbers safely from strings like "9.33", "★ 7.7", "1,416", "28", "1.4K views"
 */
function parseNumber(text, isFloat = false) {
  if (text === null || text === undefined) return null;
  const cleaned = String(text).replace(/,/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '?' || cleaned === 'N/A') return null;

  // Support shorthand notation like "1.4K"
  const kMatch = cleaned.match(/(-?\d+(?:\.\d+)?)\s*([kKmM])\b/);
  if (kMatch && !isFloat) {
    const base = parseFloat(kMatch[1]);
    const mult = kMatch[2].toLowerCase() === 'm' ? 1_000_000 : 1_000;
    return Math.round(base * mult);
  }

  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = isFloat ? parseFloat(match[0]) : parseInt(match[0], 10);
  return Number.isNaN(num) ? null : num;
}

/**
 * Strip trailing "Subtitle Indonesia" / "Sub Indo" noise for clean display title
 */
function cleanAnimeTitle(rawTitle) {
  if (!rawTitle) return null;
  return (
    String(rawTitle)
      .replace(/\s+/g, ' ')
      .replace(/\s+(?:Subtitle\s+Indonesia|Sub\s+Indo)\s*$/i, '')
      .trim() || String(rawTitle).trim()
  );
}

/**
 * Parse Next.js `<img src="/_next/image/?url=...">` or direct CDN `<img>` into small/default/large URLs
 */
function parseImages(imgEl, baseUrl = BASE_URL) {
  if (!imgEl || !imgEl.length) {
    return {
      small: null,
      default: null,
      large: null
    };
  }

  const rawSrc = imgEl.attr('src') || imgEl.attr('data-src') || null;
  const rawSrcset = imgEl.attr('srcset') || '';

  if (!rawSrc && !rawSrcset) {
    return {
      small: null,
      default: null,
      large: null
    };
  }

  const candidate = rawSrc || rawSrcset.split(',')[0]?.trim().split(/\s+/)[0] || null;
  if (!candidate) {
    return { small: null, default: null, large: null };
  }

  // Decode original image path when wrapped by Next.js `/_next/image/?url=...`
  if (candidate.includes('/_next/image')) {
    try {
      const fullNextUrl = toAbsoluteUrl(candidate, baseUrl);
      const parsedUrl = new URL(fullNextUrl);
      const innerPath = parsedUrl.searchParams.get('url');
      if (innerPath) {
        const originalUrl = toAbsoluteUrl(innerPath, baseUrl);
        const encodedInner = encodeURIComponent(innerPath);
        return {
          small: `${baseUrl}/_next/image/?url=${encodedInner}&w=256&q=75`,
          default: originalUrl,
          large: `${baseUrl}/_next/image/?url=${encodedInner}&w=1080&q=75`
        };
      }
    } catch {
      // Fallback to raw URL
    }
  }

  const absUrl = toAbsoluteUrl(candidate, baseUrl);
  return {
    small: absUrl,
    default: absUrl,
    large: absUrl
  };
}

/**
 * Load HTML into Cheerio and hydrate Next.js App Router Streaming Suspense chunks (`<template id="B:N">` <- `<div id="S:N">`)
 */
function loadHydratedCheerio(html) {
  const $ = cheerio.load(html);

  $('div[id^="S:"]').each((_, sEl) => {
    const idAttr = $(sEl).attr('id') || '';
    const num = idAttr.slice(2);
    const tmpl = $(`template[id="B:${num}"]`);
    if (tmpl.length) {
      // Remove skeleton placeholders between <template id="B:N"> and closing comment <!--/$-->
      let node = tmpl[0].next;
      while (node) {
        const nextNode = node.next;
        if (node.type === 'comment' && node.data === '/$') {
          break;
        }
        $(node).remove();
        node = nextNode;
      }
      tmpl.replaceWith($(sEl).contents());
      $(sEl).remove();
    }
  });

  return $;
}

/**
 * Decode concatenated Next.js RSC Flight payload strings from `<script>self.__next_f.push([1, "..."])</script>`
 */
function extractNextFlightText($) {
  const chunks = [];
  $('script').each((_, scriptEl) => {
    const content = $(scriptEl).html() || '';
    if (!content.includes('self.__next_f.push')) return;
    const regex = /self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      try {
        chunks.push(JSON.parse(`"${match[1]}"`));
      } catch {
        // Skip non-standard chunks
      }
    }
  });
  return chunks.join('');
}

/**
 * Extract balanced JSON array or object starting at a given index
 */
function sliceBalancedJson(str, startIdx) {
  if (startIdx < 0 || startIdx >= str.length) return null;
  const openChar = str[startIdx];
  const closeChar = openChar === '[' ? ']' : openChar === '{' ? '}' : null;
  if (!closeChar) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return str.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

/**
 * Extract JSON-LD objects (`<script type="application/ld+json">`) using Cheerio
 */
function extractJsonLd($) {
  const results = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) results.push(...parsed);
      else results.push(parsed);
    } catch {
      // Ignore invalid JSON-LD
    }
  });
  return results;
}

class SokujaId {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || BASE_URL).replace(/\/+$/, '');
    this.cacheTTL = options.cacheTTL ?? 5 * 60 * 1000; // Default 5 minute cache
    this.cache = new Map();
    this.malLinker = new MalSokujaLinker({
      sokujaProvider: this,
      malProvider: options.malProvider,
      cacheTTL: options.linkCacheTTL ?? 60 * 60 * 1000
    });
  }

  async _fetchHtml(url) {
    const now = Date.now();
    if (this.cacheTTL > 0 && this.cache.has(url)) {
      const cached = this.cache.get(url);
      if (now - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
      this.cache.delete(url);
    }

    let response;
    try {
      response = await fetch(url, { headers: DEFAULT_HEADERS });
    } catch (err) {
      throw new ScraperError(`Failed to connect to Sokuja server (${err.message})`, 502);
    }

    if (response.status === 404) {
      throw new ScraperError(`Page not found on Sokuja (${url})`, 404);
    }
    if (response.status === 429) {
      throw new ScraperError('Too many requests to Sokuja (rate limited). Please try again later.', 429);
    }
    if (!response.ok) {
      throw new ScraperError(`Failed to fetch Sokuja page (HTTP ${response.status})`, 502);
    }

    const html = await response.text();
    if (this.cacheTTL > 0) {
      if (this.cache.size > 200) {
        const oldestKey = this.cache.keys().next().value;
        this.cache.delete(oldestKey);
      }
      this.cache.set(url, { data: html, timestamp: now });
    }
    return html;
  }

  async _fetchJson(url) {
    const now = Date.now();
    if (this.cacheTTL > 0 && this.cache.has(url)) {
      const cached = this.cache.get(url);
      if (now - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
      this.cache.delete(url);
    }

    let response;
    try {
      response = await fetch(url, {
        headers: {
          ...DEFAULT_HEADERS,
          Accept: 'application/json, text/plain, */*'
        }
      });
    } catch (err) {
      throw new ScraperError(`Failed to fetch Sokuja JSON data (${err.message})`, 502);
    }

    if (!response.ok) {
      throw new ScraperError(`Failed to fetch Sokuja JSON data (HTTP ${response.status})`, 502);
    }

    const json = await response.json();
    if (this.cacheTTL > 0) {
      this.cache.set(url, { data: json, timestamp: now });
    }
    return json;
  }

  /**
   * Shared parser for Sokuja anime portrait cards (`a.group` linking to `/anime/:slug/`)
   */
  _parseAnimeCard($, el) {
    const anchor = $(el).is('a') ? $(el) : $(el).closest('a');
    const href = anchor.attr('href');
    const url = toAbsoluteUrl(href, this.baseUrl);
    const slug = extractSlug(href, 'anime');

    const cardRoot = $(el);
    const imgEl = cardRoot.find('img').first();
    const images = parseImages(imgEl, this.baseUrl);

    const title =
      cardRoot.find('h3').first().text().trim() ||
      imgEl.attr('alt')?.trim() ||
      null;

    let type = null;
    let score = null;
    let status = null;
    let broadcastTime = null;

    cardRoot.find('span').each((_, spanEl) => {
      const text = $(spanEl).text().replace(/\s+/g, ' ').trim();
      if (!text) return;
      if (text.startsWith('★')) {
        score = parseNumber(text, true);
      } else if (/wib|wita|wit|\d{1,2}:\d{2}/i.test(text)) {
        broadcastTime = text;
      } else if (/^(ongoing|completed|upcoming)$/i.test(text)) {
        status = text;
      } else if (/^(tv|movie|ova|ona|special|bd)$/i.test(text)) {
        type = text;
      }
    });

    const subText = cardRoot.find('p').last().text().trim() || null;
    const year = subText && /^\d{4}$/.test(subText) ? parseInt(subText, 10) : null;

    return {
      slug,
      title,
      url,
      images,
      type,
      score,
      status,
      year,
      ...(broadcastTime ? { broadcastTime } : {})
    };
  }

  /**
   * Shared parser for Latest Episode cards (`Update Terbaru` on Homepage)
   */
  _parseLatestEpisodeCard($, el) {
    const card = $(el);
    const href = card.attr('href');
    const url = toAbsoluteUrl(href, this.baseUrl);
    const slug = extractSlug(href);

    const imgEl = card.find('img').first();
    const images = parseImages(imgEl, this.baseUrl);
    const title = card.find('h3').first().text().trim() || imgEl.attr('alt')?.trim() || null;

    let episodeNumber = null;
    let type = null;
    let status = null;

    card.find('div.relative span').each((_, spanEl) => {
      const text = $(spanEl).text().replace(/\s+/g, ' ').trim();
      if (/^ep\s+/i.test(text)) {
        episodeNumber = parseNumber(text, true) ?? text.replace(/^ep\s+/i, '').trim();
      } else if (/^(ongoing|completed|upcoming)$/i.test(text)) {
        status = text;
      } else if (text) {
        type = text;
      }
    });

    const metaSpans = card.find('h3').next('div').find('span');
    const episodeLabel = metaSpans.eq(0).text().replace(/\s+/g, ' ').trim() || null;
    if (episodeNumber === null && episodeLabel) {
      episodeNumber = parseNumber(episodeLabel, true);
    }
    const releasedAgo =
      metaSpans
        .eq(1)
        .text()
        .replace(/^[·•\s]+/, '')
        .trim() || null;

    return {
      slug,
      title,
      episodeNumber,
      episodeLabel,
      type,
      status,
      releasedAgo,
      url,
      images
    };
  }

  /**
   * Shared parser for numbered pagination nav (`1 2 ... 16 Selanjutnya`)
   */
  _parsePagination($, currentPage = 1) {
    let totalPages = currentPage;
    let hasNextPage = false;

    $('main#main-content a[href*="page="]').each((_, aEl) => {
      const href = $(aEl).attr('href') || '';
      const text = $(aEl).text().trim().toLowerCase();
      try {
        const u = new URL(toAbsoluteUrl(href, this.baseUrl));
        const p = parseInt(u.searchParams.get('page'), 10);
        if (p && p > totalPages) totalPages = p;
        if (p === currentPage + 1 || text.includes('selanjutnya') || text.includes('next')) {
          hasNextPage = true;
        }
      } catch {
        // Ignore invalid URLs
      }
    });

    return {
      currentPage,
      totalPages,
      hasNextPage,
      hasPrevPage: currentPage > 1
    };
  }

  /**
   * 1. Homepage Data (Featured Slider, Latest Updates, Ongoing, Completed, Popular Weekly/Monthly/All-Time)
   */
  async getHome(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const url = `${this.baseUrl}/${page > 1 ? `?page=${page}` : ''}`;
    const html = await this._fetchHtml(url);
    const $ = loadHydratedCheerio(html);

    // 1. Hero Featured Carousel
    const featured = [];
    $('main#main-content .snap-x > div').each((_, slideEl) => {
      const slide = $(slideEl);
      const titleLink = slide.find('a[href*="/anime/"]').first();
      const href = titleLink.attr('href');
      const slug = extractSlug(href, 'anime');
      if (!slug) return;

      const title = titleLink.find('h3').text().trim() || slide.find('img').attr('alt')?.trim() || null;
      const images = parseImages(slide.find('img').first(), this.baseUrl);
      const synopsis = slide.find('p').first().text().trim() || null;

      let isHot = false;
      let type = null;
      let score = null;

      slide.find('span').each((__, spanEl) => {
        const t = $(spanEl).text().replace(/\s+/g, ' ').trim();
        if (t.toUpperCase() === 'HOT') isHot = true;
        else if (t.startsWith('★')) score = parseNumber(t, true);
        else if (t) type = t;
      });

      const genres = [];
      slide.find('a[href^="/genre/"]').each((__, gEl) => {
        const gHref = $(gEl).attr('href');
        genres.push({
          slug: extractSlug(gHref, 'genre'),
          name: $(gEl).text().trim(),
          url: toAbsoluteUrl(gHref, this.baseUrl)
        });
      });

      featured.push({
        slug,
        title,
        url: toAbsoluteUrl(href, this.baseUrl),
        images,
        isHot,
        type,
        score,
        genres,
        synopsis
      });
    });

    // 2. Hydrated Sections inside <main>
    const latestUpdates = [];
    let latestPagination = {
      currentPage: page,
      totalPages: page,
      hasNextPage: false,
      hasPrevPage: page > 1
    };
    const ongoing = [];
    const completed = [];
    const popular = {
      weekly: [],
      monthly: [],
      allTime: []
    };

    $('main#main-content section').each((_, secEl) => {
      const sec = $(secEl);
      const heading = sec.find('h2').first().text().replace(/\s+/g, ' ').trim().toLowerCase();

      if (heading.includes('update terbaru')) {
        sec.find('a.group').each((__, cardEl) => {
          const parsed = this._parseLatestEpisodeCard($, cardEl);
          if (parsed.slug) latestUpdates.push(parsed);
        });

        const pageInfoText = sec.find('> div').last().find('span').text().replace(/\s+/g, ' ').trim();
        const ratioMatch = pageInfoText.match(/(\d+)\s*\/\s*(\d+)/);
        const totalPages = ratioMatch ? parseInt(ratioMatch[2], 10) : page;
        const hasNext =
          sec.find(`a[href*="page=${page + 1}"]`).length > 0 || page < totalPages;
        latestPagination = {
          currentPage: page,
          totalPages,
          hasNextPage: hasNext,
          hasPrevPage: page > 1
        };
      } else if (heading.includes('ongoing')) {
        sec.find('a.group').each((__, cardEl) => {
          const parsed = this._parseAnimeCard($, cardEl);
          if (parsed.slug) ongoing.push({ ...parsed, status: parsed.status || 'Ongoing' });
        });
      } else if (heading.includes('completed')) {
        sec.find('a.group').each((__, cardEl) => {
          const parsed = this._parseAnimeCard($, cardEl);
          if (parsed.slug) completed.push({ ...parsed, status: parsed.status || 'Completed' });
        });
      } else if (heading.includes('populer mingguan')) {
        sec.find('a.group').each((idx, cardEl) => {
          const parsed = this._parseAnimeCard($, cardEl);
          if (parsed.slug) popular.weekly.push({ rank: idx + 1, ...parsed });
        });
      } else if (heading.includes('populer bulanan')) {
        sec.find('a.group').each((idx, cardEl) => {
          const parsed = this._parseAnimeCard($, cardEl);
          if (parsed.slug) popular.monthly.push({ rank: idx + 1, ...parsed });
        });
      } else if (heading.includes('populer sepanjang masa')) {
        sec.find('a.group').each((idx, cardEl) => {
          const parsed = this._parseAnimeCard($, cardEl);
          if (parsed.slug) popular.allTime.push({ rank: idx + 1, ...parsed });
        });
      }
    });

    return {
      featured,
      latestUpdates: {
        pagination: latestPagination,
        data: latestUpdates
      },
      ongoing,
      completed,
      popular
    };
  }

  /**
   * 2. Latest Episode Updates (Paginated)
   */
  async getLatestUpdates(options = {}) {
    const home = await this.getHome(options);
    return home.latestUpdates;
  }

  /**
   * 3. Search Anime (`/?s=<query>&page=<page>`)
   */
  async search(query, options = {}) {
    const q = String(query || '').trim();
    if (!q) {
      throw new ScraperError('Search query parameter (q) is required.', 400);
    }

    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const params = new URLSearchParams({ s: q });
    if (page > 1) params.set('page', String(page));

    const searchUrl = `${this.baseUrl}/?${params.toString()}`;
    const html = await this._fetchHtml(searchUrl);
    const $ = loadHydratedCheerio(html);

    const data = [];
    $('main#main-content section a.group[href*="/anime/"]').each((_, cardEl) => {
      const parsed = this._parseAnimeCard($, cardEl);
      if (parsed.slug) data.push(parsed);
    });

    const pagination = this._parsePagination($, page);

    return {
      query: q,
      pagination,
      data
    };
  }

  /**
   * 4. Browse / Filter Anime Directory (`/anime/?genre=...&studio=...&season=...&status=...&type=...&sub=...&order=...&page=...`)
   */
  async browseAnime(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const params = new URLSearchParams();

    if (options.genre) params.set('genre', extractSlug(options.genre, 'genre'));
    if (options.studio) params.set('studio', extractSlug(options.studio, 'studio'));
    if (options.season) params.set('season', extractSlug(options.season, 'season'));

    if (options.status) {
      const status = String(options.status).toLowerCase().trim();
      if (!VALID_STATUSES.has(status)) {
        throw new ScraperError(
          `Invalid status "${status}". Allowed values: ${Array.from(VALID_STATUSES).join(', ')}`,
          400
        );
      }
      params.set('status', status);
    }

    if (options.type) {
      const type = String(options.type).toLowerCase().trim();
      if (!VALID_TYPES.has(type)) {
        throw new ScraperError(
          `Invalid type "${type}". Allowed values: ${Array.from(VALID_TYPES).join(', ')}`,
          400
        );
      }
      params.set('type', type);
    }

    if (options.sub) {
      const sub = String(options.sub).toLowerCase().trim();
      if (!VALID_SUBS.has(sub)) {
        throw new ScraperError(
          `Invalid subtitle filter "${sub}". Allowed values: ${Array.from(VALID_SUBS).join(', ')}`,
          400
        );
      }
      params.set('sub', sub);
    }

    const order = options.order ? String(options.order).toLowerCase().trim() : 'update';
    if (!VALID_ORDERS.has(order)) {
      throw new ScraperError(
        `Invalid order "${order}". Allowed values: ${Array.from(VALID_ORDERS).join(', ')}`,
        400
      );
    }
    params.set('order', order);

    if (page > 1) params.set('page', String(page));

    const queryStr = params.toString();
    const url = `${this.baseUrl}/anime/${queryStr ? `?${queryStr}` : ''}`;
    const html = await this._fetchHtml(url);
    const $ = loadHydratedCheerio(html);

    const countText = $('main#main-content p').first().text().trim();
    const totalCount = parseNumber(countText) ?? null;

    const data = [];
    $('main#main-content a.group[href*="/anime/"]').each((_, cardEl) => {
      const parsed = this._parseAnimeCard($, cardEl);
      if (parsed.slug) data.push(parsed);
    });

    const pagination = this._parsePagination($, page);

    return {
      filters: {
        genre: params.get('genre') || null,
        studio: params.get('studio') || null,
        season: params.get('season') || null,
        status: params.get('status') || null,
        type: params.get('type') || null,
        sub: params.get('sub') || null,
        order
      },
      totalCount,
      pagination,
      data
    };
  }

  /**
   * Shortcut: Ongoing Anime
   */
  async getOngoingAnime(options = {}) {
    return this.browseAnime({
      ...options,
      status: 'ongoing',
      order: options.order || 'update'
    });
  }

  /**
   * Shortcut: Completed Anime
   */
  async getCompletedAnime(options = {}) {
    return this.browseAnime({
      ...options,
      status: 'completed',
      order: options.order || 'update'
    });
  }

  /**
   * Shortcut: Anime Movies
   */
  async getMovies(options = {}) {
    return this.browseAnime({
      ...options,
      type: 'movie',
      order: options.order || 'update'
    });
  }

  /**
   * 5. Top / Popular Anime (`weekly`, `monthly`, `alltime`, `popular`, `score`, `ongoing`, `movie`, etc.)
   */
  async getTopAnime(options = {}) {
    const rawType = String(options.type || 'popular').toLowerCase().trim();
    const page = Math.max(1, parseInt(options.page, 10) || 1);

    if (rawType === 'weekly' || rawType === 'mingguan') {
      const home = await this.getHome();
      return {
        filter: 'weekly',
        pagination: { currentPage: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false },
        data: home.popular.weekly
      };
    }

    if (rawType === 'monthly' || rawType === 'bulanan') {
      const home = await this.getHome();
      return {
        filter: 'monthly',
        pagination: { currentPage: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false },
        data: home.popular.monthly
      };
    }

    if (rawType === 'alltime' || rawType === 'all-time' || rawType === 'sepanjang-masa') {
      const home = await this.getHome();
      return {
        filter: 'alltime',
        pagination: { currentPage: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false },
        data: home.popular.allTime
      };
    }

    const browseOpts = { page };
    if (rawType === 'score' || rawType === 'all' || rawType === 'rating') {
      browseOpts.order = 'score';
    } else if (rawType === 'popular' || rawType === 'bypopularity' || rawType === 'favorite') {
      browseOpts.order = 'popular';
    } else if (rawType === 'airing' || rawType === 'ongoing') {
      browseOpts.status = 'ongoing';
      browseOpts.order = 'popular';
    } else if (rawType === 'upcoming') {
      browseOpts.status = 'upcoming';
      browseOpts.order = 'newest';
    } else if (VALID_TYPES.has(rawType)) {
      browseOpts.type = rawType;
      browseOpts.order = 'score';
    } else {
      throw new ScraperError(
        `Invalid top anime type "${rawType}". Allowed values: popular, score, weekly, monthly, alltime, ongoing, upcoming, tv, movie, ova, ona, special`,
        400
      );
    }

    const result = await this.browseAnime(browseOpts);
    const startRank = (page - 1) * 24;
    const rankedData = result.data.map((item, idx) => ({
      rank: startRank + idx + 1,
      ...item
    }));

    return {
      filter: rawType,
      totalCount: result.totalCount,
      pagination: result.pagination,
      data: rankedData
    };
  }

  /**
   * 6. Full Alphabetical Anime Directory A-Z (`/anime/list-mode/`)
   */
  async getAnimeListAZ(options = {}) {
    const letterFilter = options.letter ? String(options.letter).trim().toUpperCase() : null;
    const url = `${this.baseUrl}/anime/list-mode/`;
    const html = await this._fetchHtml(url);
    const $ = loadHydratedCheerio(html);

    const groups = [];
    let total = 0;

    $('main#main-content h2').each((_, h2El) => {
      const letter = $(h2El).text().trim().toUpperCase();
      if (!letter) return;
      if (letterFilter && letter !== letterFilter) return;

      const items = [];
      $(h2El)
        .parent()
        .find('a[href*="/anime/"]')
        .each((__, aEl) => {
          const href = $(aEl).attr('href');
          const slug = extractSlug(href, 'anime');
          if (!slug || slug === 'list-mode') return;

          const spans = $(aEl).find('span');
          const title = spans.eq(0).text().trim() || $(aEl).text().trim();
          const metaRaw = spans.eq(1).text().trim();
          const parts = metaRaw ? metaRaw.split('·').map((s) => s.trim()) : [];

          items.push({
            slug,
            title,
            type: parts[0] || null,
            status: parts[1] || null,
            year: parseNumber(parts[2]),
            url: toAbsoluteUrl(href, this.baseUrl)
          });
        });

      if (items.length > 0) {
        groups.push({
          letter,
          count: items.length,
          items
        });
        total += items.length;
      }
    });

    return {
      letterFilter,
      total,
      groups
    };
  }

  /**
   * 7. Weekly Release Schedule (`/jadwal-rilis-anime/`)
   */
  async getSchedule(options = {}) {
    const rawDay = options.day ? String(options.day).toLowerCase().trim() : null;
    const normalizedDayFilter = rawDay ? DAY_ALIASES[rawDay] || rawDay : null;

    const url = `${this.baseUrl}/jadwal-rilis-anime/`;
    const html = await this._fetchHtml(url);
    const $ = loadHydratedCheerio(html);

    const schedule = {};
    let total = 0;

    $('main#main-content h2').each((_, h2El) => {
      const dayTitle = $(h2El).text().replace(/\s+/g, ' ').trim();
      if (!dayTitle) return;

      const dayKeyLower = dayTitle.toLowerCase();
      if (
        normalizedDayFilter &&
        dayKeyLower !== normalizedDayFilter &&
        !dayKeyLower.includes(normalizedDayFilter)
      ) {
        return;
      }

      const sectionWrapper = $(h2El).parent().parent();
      const items = [];

      sectionWrapper.find('a[href*="/anime/"]').each((__, aEl) => {
        const parsed = this._parseAnimeCard($, aEl);
        if (parsed.slug) items.push(parsed);
      });

      schedule[dayTitle] = items;
      total += items.length;
    });

    return {
      dayFilter: rawDay,
      total,
      schedule
    };
  }

  /**
   * 8. All Genres (`/genre/`)
   */
  async getGenres() {
    const url = `${this.baseUrl}/genre/`;
    const html = await this._fetchHtml(url);
    const $ = loadHydratedCheerio(html);

    const genres = [];
    const seen = new Set();

    $('main#main-content a[href^="/genre/"]').each((_, aEl) => {
      const href = $(aEl).attr('href');
      const slug = extractSlug(href, 'genre');
      if (!slug || seen.has(slug)) return;
      seen.add(slug);

      const spans = $(aEl).find('span');
      const name = spans.eq(0).text().trim() || $(aEl).text().trim();
      const count = parseNumber(spans.eq(1).text());

      genres.push({
        slug,
        name,
        count,
        url: toAbsoluteUrl(href, this.baseUrl)
      });
    });

    return genres;
  }

  /**
   * Shared parser for Taxonomy Listing Pages (`/genre/:slug/`, `/season/:slug/`, `/studio/:slug/`, `/cast/:slug/`, `/director/:slug/`)
   */
  async _fetchTaxonomyListing(prefix, rawSlug, labelName, options = {}) {
    const slug = extractSlug(rawSlug, prefix);
    if (!slug) {
      throw new ScraperError(`${labelName} slug is required (e.g. "${prefix === 'genre' ? 'action' : prefix}").`, 400);
    }

    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const order = options.order ? String(options.order).toLowerCase().trim() : 'update';
    if (!VALID_ORDERS.has(order)) {
      throw new ScraperError(
        `Invalid order "${order}". Allowed values: ${Array.from(VALID_ORDERS).join(', ')}`,
        400
      );
    }

    const params = new URLSearchParams();
    if (order && order !== 'update') params.set('order', order);
    if (page > 1) params.set('page', String(page));
    const queryStr = params.toString();

    const url = `${this.baseUrl}/${prefix}/${encodeURIComponent(slug)}/${queryStr ? `?${queryStr}` : ''}`;
    const html = await this._fetchHtml(url);
    const $ = loadHydratedCheerio(html);

    const heading = cleanAnimeTitle($('main#main-content h1').first().text().trim());
    const countText = $('main#main-content p').first().text().trim();
    const totalCount = parseNumber(countText);

    const data = [];
    $('main#main-content a.group[href*="/anime/"]').each((_, cardEl) => {
      const parsed = this._parseAnimeCard($, cardEl);
      if (parsed.slug) data.push(parsed);
    });

    const pagination = this._parsePagination($, page);

    return {
      [labelName]: {
        slug,
        title: heading,
        totalCount,
        url: `${this.baseUrl}/${prefix}/${encodeURIComponent(slug)}/`
      },
      order,
      pagination,
      data
    };
  }

  /**
   * 9. Anime by Genre Slug (`/genre/:slug/`)
   */
  async getAnimeByGenre(genreSlug, options = {}) {
    return this._fetchTaxonomyListing('genre', genreSlug, 'genre', options);
  }

  /**
   * 10. All Seasonal Archives (`SeasonArchive` widget data from HTML)
   */
  async getSeasons() {
    const html = await this._fetchHtml(`${this.baseUrl}/`);
    const $ = cheerio.load(html);
    const flightText = extractNextFlightText($);

    const seasons = [];
    const markerIdx = flightText.indexOf('"seasons":[');
    if (markerIdx !== -1) {
      const arrJson = sliceBalancedJson(flightText, markerIdx + '"seasons":'.length);
      if (arrJson) {
        try {
          const parsed = JSON.parse(arrJson);
          for (const item of parsed) {
            if (item && item.season && item.year) {
              const slug = `${String(item.season).toLowerCase()}-${item.year}`;
              seasons.push({
                slug,
                season: String(item.season).toLowerCase(),
                year: item.year,
                name: `${String(item.season).charAt(0).toUpperCase()}${String(item.season).slice(1)} ${item.year}`,
                count: item.count ?? null,
                url: `${this.baseUrl}/season/${slug}/`
              });
            }
          }
        } catch {
          // Fallback if parsing fails
        }
      }
    }

    return seasons;
  }

  /**
   * 11. Seasonal Anime (`/season/:slug/` e.g. `winter-2026` or `{ year: 2026, season: 'winter' }`)
   */
  async getSeasonalAnime(optionsOrSlug = {}, extraOptions = {}) {
    let seasonSlug = null;
    let listOptions = extraOptions;

    if (typeof optionsOrSlug === 'string') {
      seasonSlug = extractSlug(optionsOrSlug, 'season');
    } else if (optionsOrSlug && typeof optionsOrSlug === 'object') {
      listOptions = optionsOrSlug;
      if (optionsOrSlug.slug) {
        seasonSlug = extractSlug(optionsOrSlug.slug, 'season');
      } else if (optionsOrSlug.season && optionsOrSlug.year) {
        seasonSlug = `${String(optionsOrSlug.season).toLowerCase().trim()}-${parseInt(optionsOrSlug.year, 10)}`;
      } else if (optionsOrSlug.season) {
        seasonSlug = extractSlug(optionsOrSlug.season, 'season');
      }
    }

    // If called without parameters (defaults to latest season from seasons list)
    if (!seasonSlug) {
      const seasons = await this.getSeasons();
      if (!seasons.length) {
        throw new ScraperError('Season slug is required (e.g. "winter-2026").', 400);
      }
      seasonSlug = seasons[0].slug;
    }

    return this._fetchTaxonomyListing('season', seasonSlug, 'season', listOptions);
  }

  /**
   * 12. All Studios (extracted from `/anime/` filter select options)
   */
  async getStudios() {
    const html = await this._fetchHtml(`${this.baseUrl}/anime/`);
    const $ = loadHydratedCheerio(html);

    const studios = [];
    $('main#main-content label').each((_, labelEl) => {
      if ($(labelEl).text().trim().toLowerCase() !== 'studio') return;
      $(labelEl)
        .next('select')
        .find('option')
        .each((__, optEl) => {
          const slug = $(optEl).attr('value')?.trim();
          const name = $(optEl).text().trim();
          if (slug && name) {
            studios.push({
              slug,
              name,
              url: `${this.baseUrl}/studio/${encodeURIComponent(slug)}/`
            });
          }
        });
    });

    return studios;
  }

  /**
   * 13. Anime by Studio Slug (`/studio/:slug/`)
   */
  async getAnimeByStudio(studioSlug, options = {}) {
    return this._fetchTaxonomyListing('studio', studioSlug, 'studio', options);
  }

  /**
   * Alias for compatibility with AnimaScraper.getAnimeByProducer interface
   */
  async getAnimeByProducer(studioSlug, options = {}) {
    return this.getAnimeByStudio(studioSlug, options);
  }

  /**
   * 14. Anime by Voice Actor / Cast Slug (`/cast/:slug/`)
   */
  async getAnimeByCast(castSlug, options = {}) {
    return this._fetchTaxonomyListing('cast', castSlug, 'cast', options);
  }

  /**
   * 15. Anime by Director Slug (`/director/:slug/`)
   */
  async getAnimeByDirector(directorSlug, options = {}) {
    return this._fetchTaxonomyListing('director', directorSlug, 'director', options);
  }

  /**
   * Internal helper to fetch Anime HTML by slug, with automatic fallback to `<slug>-subtitle-indonesia`
   */
  async _fetchAnimeHtmlBySlug(rawSlug) {
    const cleanSlug = extractSlug(rawSlug, 'anime');
    if (!cleanSlug) {
      throw new ScraperError(
        'Anime slug is required (e.g. "sousou-no-frieren-subtitle-indonesia" or "/anime/sousou-no-frieren-season-2-subtitle-indonesia/").',
        400
      );
    }

    const primaryUrl = `${this.baseUrl}/anime/${encodeURIComponent(cleanSlug)}/`;
    try {
      const html = await this._fetchHtml(primaryUrl);
      return { slug: cleanSlug, url: primaryUrl, html };
    } catch (err) {
      if (err.status === 404 && !cleanSlug.endsWith('-subtitle-indonesia')) {
        const fallbackSlug = `${cleanSlug}-subtitle-indonesia`;
        const fallbackUrl = `${this.baseUrl}/anime/${encodeURIComponent(fallbackSlug)}/`;
        const html = await this._fetchHtml(fallbackUrl);
        return { slug: fallbackSlug, url: fallbackUrl, html };
      }
      throw err;
    }
  }

  /**
   * 16. Resolve MyAnimeList Numeric ID -> Sokuja Anime Slug
   * e.g. `52991` -> `sousou-no-frieren-subtitle-indonesia`
   */
  async resolveMalId(malId) {
    return this.malLinker.resolveMalId(malId);
  }

  /**
   * 17. Get Full Sokuja Anime Detail via MyAnimeList Numeric ID
   * e.g. `52991` -> Sousou no Frieren (Season 1), `59978` -> Sousou no Frieren Season 2
   */
  async getAnimeByMalId(malId) {
    const resolved = await this.resolveMalId(malId);
    const detail = await this._getAnimeDetailBySlug(resolved.slug);
    return {
      malId: resolved.malId,
      malUrl: resolved.mal.url,
      linkedMal: {
        ...resolved.mal,
        confidence: resolved.confidence,
        matchScore: resolved.matchScore
      },
      ...detail
    };
  }

  /**
   * 18. Get Episode Streaming & Download on Sokuja via Anime Slug OR MyAnimeList ID + Episode Number
   * e.g. `getAnimeEpisode(52991, 28)` or `getAnimeEpisode('sousou-no-frieren-subtitle-indonesia', 28)`
   */
  async getAnimeEpisode(idOrSlug, episodeNumber) {
    const epNum = parseFloat(episodeNumber);
    if (Number.isNaN(epNum) || epNum <= 0) {
      throw new ScraperError('Episode number must be a positive number (e.g. 1, 28).', 400);
    }

    const animeDetail = await this.getAnimeDetail(idOrSlug);
    let targetEp = animeDetail.episodeList.find((ep) => ep.number === epNum);

    // Fallback for Movies with a single episode entry without an explicit episode number in title
    if (!targetEp && epNum === 1 && animeDetail.episodeList.length === 1) {
      targetEp = animeDetail.episodeList[0];
    }

    if (!targetEp) {
      const idLabel = animeDetail.malId
        ? `MAL ID: ${animeDetail.malId}, Sokuja: ${animeDetail.slug}`
        : `Sokuja: ${animeDetail.slug}`;
      throw new ScraperError(
        `Episode ${episodeNumber} not found for anime "${animeDetail.title}" (${idLabel}).`,
        404
      );
    }

    const epDetail = await this.getEpisodeDetail(targetEp.slug);
    return {
      ...(animeDetail.malId
        ? {
            malId: animeDetail.malId,
            malUrl: animeDetail.malUrl,
            linkedMal: animeDetail.linkedMal
          }
        : {}),
      ...epDetail
    };
  }

  /**
   * Dedicated alias for MyAnimeList Numeric ID + Episode Number
   * e.g. `getEpisodeByMalId(52991, 28)` -> Episode 28 streaming mirrors & downloads
   */
  async getEpisodeByMalId(malId, episodeNumber) {
    if (!isNumericMalId(malId)) {
      throw new ScraperError('MyAnimeList ID must be a positive integer (e.g. 52991).', 400);
    }
    return this.getAnimeEpisode(malId, episodeNumber);
  }

  /**
   * 19. Full Anime Details by Slug OR MyAnimeList Numeric ID
   * Supports:
   * - Numeric MAL ID: `52991` (Season 1), `59978` (Season 2)
   * - Sokuja path/slug: `/anime/sousou-no-frieren-subtitle-indonesia/`, `sousou-no-frieren-season-2-subtitle-indonesia`
   */
  async getAnimeDetail(idOrSlug) {
    if (isNumericMalId(idOrSlug)) {
      return this.getAnimeByMalId(idOrSlug);
    }
    return this._getAnimeDetailBySlug(idOrSlug);
  }

  async _getAnimeDetailBySlug(rawSlug) {
    const { slug, url, html } = await this._fetchAnimeHtmlBySlug(rawSlug);
    const $ = loadHydratedCheerio(html);
    const jsonLdList = extractJsonLd($);
    const tvSeriesLd = jsonLdList.find((item) => item['@type'] === 'TVSeries') || null;
    const flightText = extractNextFlightText($);

    const main = $('main#main-content');
    const fullTitle = main.find('h1').first().text().replace(/\s+/g, ' ').trim() || null;
    const title = cleanAnimeTitle(fullTitle) || tvSeriesLd?.name || null;

    const altRaw = main.find('h1').first().next('p').text().replace(/\s+/g, ' ').trim() || null;
    const alternativeTitles = altRaw
      ? altRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    // Banner / Backdrop & Poster (filter `.children('div')` because JSON-LD <script> is at start of wrapper)
    const topWrapperDivs = main.children('div').first().children('div');
    const bannerSection = topWrapperDivs.eq(0);
    const bannerImg = bannerSection.find('img').first();
    const banner = bannerImg.length ? parseImages(bannerImg, this.baseUrl).default : null;
    const isFeatured = bannerSection.text().toUpperCase().includes('FEATURED');

    const posterCol = topWrapperDivs.eq(1).children('div').first();
    const posterImg = posterCol.find('img').first();
    const posterImages = posterImg.length
      ? parseImages(posterImg, this.baseUrl)
      : {
          small: tvSeriesLd?.image || null,
          default: tvSeriesLd?.image || null,
          large: tvSeriesLd?.image || null
        };

    // Bookmark count
    const bookmarkBtn = posterCol
      .find('button')
      .filter((_, b) => $(b).text().toLowerCase().includes('bookmark'));
    const bookmarks = parseNumber(bookmarkBtn.find('span').last().text());

    // Internal animeId & YouTube trailer from Next.js flight payload
    let animeId = null;
    const animeIdMatch = flightText.match(/"animeId":(\d+)/);
    if (animeIdMatch) animeId = parseInt(animeIdMatch[1], 10);

    let trailer = null;
    const ytMatch = flightText.match(/"youtubeId":"([A-Za-z0-9_-]+)"/);
    if (ytMatch && ytMatch[1]) {
      const youtubeId = ytMatch[1];
      trailer = {
        youtubeId,
        url: `https://www.youtube.com/watch?v=${youtubeId}`,
        embedUrl: `https://www.youtube.com/embed/${youtubeId}`
      };
    }

    // Score & Rating Count
    let score = null;
    const scoreContainer = main
      .find('div.flex.items-center.gap-3')
      .filter((_, el) => $(el).text().includes('/ 10'))
      .first();
    if (scoreContainer.length) {
      score = parseNumber(scoreContainer.find('span').first().text(), true);
    }
    if (score === null && tvSeriesLd?.aggregateRating?.ratingValue) {
      score = parseNumber(tvSeriesLd.aggregateRating.ratingValue, true);
    }
    const scoredBy = parseNumber(tvSeriesLd?.aggregateRating?.ratingCount);

    // Genres
    const genres = [];
    const seenGenres = new Set();
    main.find('a[href^="/genre/"]').each((_, gEl) => {
      const gHref = $(gEl).attr('href');
      const gSlug = extractSlug(gHref, 'genre');
      const gName = $(gEl).text().trim();
      if (gSlug && gName && !seenGenres.has(gSlug)) {
        seenGenres.add(gSlug);
        genres.push({
          slug: gSlug,
          name: gName,
          url: toAbsoluteUrl(gHref, this.baseUrl)
        });
      }
    });

    // Anime Information (<dl> <dt> / <dd>)
    let status = null;
    let type = null;
    let year = null;
    let episodes = null;
    let duration = null;
    let subtitle = null;
    let fansub = null;
    const seasons = [];
    const studios = [];
    const directors = [];

    const parseLinkedTaxonomy = (ddEl, prefix) => {
      const items = [];
      ddEl.find('a').each((_, aEl) => {
        const href = $(aEl).attr('href');
        const itemSlug = extractSlug(href, prefix);
        const name = $(aEl).text().trim();
        if (itemSlug && name) {
          items.push({
            slug: itemSlug,
            name,
            url: toAbsoluteUrl(href, this.baseUrl)
          });
        }
      });
      return items;
    };

    main.find('dl > div').each((_, rowEl) => {
      const dt = $(rowEl).find('dt').text().replace(':', '').trim().toLowerCase();
      const dd = $(rowEl).find('dd');
      const val = dd.text().replace(/\s+/g, ' ').trim();

      switch (dt) {
        case 'status':
          status = val || null;
          break;
        case 'tipe':
        case 'type':
          type = val || null;
          break;
        case 'tahun':
        case 'year':
          year = parseNumber(val);
          break;
        case 'musim':
        case 'season':
          seasons.push(...parseLinkedTaxonomy(dd, 'season'));
          break;
        case 'episode':
        case 'episodes':
          episodes = parseNumber(val);
          break;
        case 'durasi':
        case 'duration':
          duration = val || null;
          break;
        case 'subtitle':
          subtitle = val || null;
          break;
        case 'fansub':
          fansub = val || null;
          break;
        case 'studio':
          studios.push(...parseLinkedTaxonomy(dd, 'studio'));
          break;
        case 'sutradara':
        case 'director':
          directors.push(...parseLinkedTaxonomy(dd, 'director'));
          break;
        default:
          break;
      }
    });

    // Synopsis, Related Series links inside Synopsis, & External Links
    let synopsis = null;
    const relatedSeries = [];
    const externalLinks = [];
    const synopsisProse = main.find('.prose').first();

    if (synopsisProse.length) {
      synopsisProse.find('a').each((_, aEl) => {
        const href = $(aEl).attr('href') || '';
        const linkText = $(aEl).text().trim();
        if (!href) return;

        if (href.includes('/anime/')) {
          const relSlug = extractSlug(href, 'anime');
          if (relSlug && relSlug !== slug) {
            relatedSeries.push({
              slug: relSlug,
              title: cleanAnimeTitle(linkText) || relSlug,
              url: `${this.baseUrl}/anime/${encodeURIComponent(relSlug)}/`
            });
          }
        } else if (href.startsWith('http')) {
          externalLinks.push({
            name: linkText || href,
            url: href
          });
        }
      });

      // Convert <br> to newlines to keep synopsis paragraphs formatted
      const proseClone = synopsisProse.clone();
      proseClone.find('br').replaceWith('\n');
      synopsis =
        proseClone
          .text()
          .split('\n')
          .map((line) => line.replace(/\s+/g, ' ').trim())
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim() || null;
    }

    // Gallery (Screenshots)
    const gallery = [];
    const galleryH2 = main
      .find('h2')
      .filter((_, h) => {
        const text = $(h).text().trim().toLowerCase();
        return text === 'galeri' || text === 'gallery';
      });
    if (galleryH2.length) {
      galleryH2
        .parent()
        .find('img')
        .each((_, imgEl) => {
          const parsedImg = parseImages($(imgEl), this.baseUrl);
          if (parsedImg.default) gallery.push(parsedImg.default);
        });
    }

    // Voice Actors / Casts
    const casts = [];
    const castH2 = main
      .find('h2')
      .filter((_, h) => {
        const text = $(h).text().trim().toLowerCase();
        return text === 'pemeran' || text === 'cast' || text === 'casts';
      });
    if (castH2.length) {
      castH2
        .parent()
        .find('a[href^="/cast/"]')
        .each((_, aEl) => {
          const href = $(aEl).attr('href');
          const cSlug = extractSlug(href, 'cast');
          const name = $(aEl).text().trim();
          if (cSlug && name) {
            casts.push({
              slug: cSlug,
              name,
              url: toAbsoluteUrl(href, this.baseUrl)
            });
          }
        });
    }

    // Episode List (Combine DOM + RSC EpisodeList to ensure long series >50 episodes remain 100% complete)
    const domEpisodeMap = new Map();
    const domEpisodes = [];
    const epH2 = main
      .find('h2')
      .filter((_, h) => {
        const text = $(h).text().toLowerCase();
        return text.includes('daftar episode') || text.includes('episode list') || text.includes('episodes');
      })
      .first();

    if (epH2.length) {
      const epContainer = epH2.parent().parent();
      epContainer.find('a[href]').each((_, aEl) => {
        const href = $(aEl).attr('href');
        const epSlug = extractSlug(href);
        if (!epSlug) return;

        const spans = $(aEl).find('span');
        const epTitle = spans.eq(0).text().trim() || $(aEl).text().trim();
        const releasedAgo = spans.eq(1).text().trim() || null;
        const numMatch = epTitle.match(/episode\s+(\d+(?:\.\d+)?)/i);
        const epNumber = numMatch ? parseFloat(numMatch[1]) : null;
        const isEnd = /\(end\)|\bend-/i.test(epTitle) || /^end-/i.test(epSlug);

        const epEntry = {
          episodeId: null,
          number: epNumber,
          slug: epSlug,
          title: epTitle,
          isEnd,
          releasedAgo,
          createdAt: null,
          url: toAbsoluteUrl(href, this.baseUrl)
        };
        domEpisodes.push(epEntry);
        domEpisodeMap.set(epSlug, epEntry);
      });
    }

    let episodeList = domEpisodes;
    const epJsonMarker = flightText.indexOf('"episodes":[');
    if (epJsonMarker !== -1) {
      const rawEpArr = sliceBalancedJson(flightText, epJsonMarker + '"episodes":'.length);
      if (rawEpArr) {
        try {
          const rscEpisodes = JSON.parse(rawEpArr);
          if (Array.isArray(rscEpisodes) && rscEpisodes.length > 0) {
            episodeList = rscEpisodes.map((ep) => {
              const epSlug = ep.slug;
              const domMatch = domEpisodeMap.get(epSlug);
              const rawCreated =
                typeof ep.createdAt === 'string' ? ep.createdAt.replace(/^\$D/, '') : null;
              const isEnd =
                Boolean(domMatch?.isEnd) ||
                /\(end\)/i.test(ep.title || '') ||
                /^end-/i.test(epSlug || '');

              return {
                episodeId: ep.id ?? null,
                number: ep.episodeNumber ?? domMatch?.number ?? null,
                slug: epSlug,
                title: ep.title || domMatch?.title || null,
                isEnd,
                releasedAgo: domMatch?.releasedAgo || null,
                createdAt: rawCreated,
                url: `${this.baseUrl}/${encodeURIComponent(epSlug)}/`
              };
            });
          }
        } catch {
          // Fall back to DOM results if parsing RSC JSON fails
        }
      }
    }

    // Related Anime (Recommendations)
    const recommendations = [];
    const relatedH2 = main
      .find('h2')
      .filter((_, h) => {
        const text = $(h).text().trim().toLowerCase();
        return text.includes('anime terkait') || text.includes('related anime') || text.includes('recommendations');
      })
      .first();
    if (relatedH2.length) {
      relatedH2
        .parent()
        .find('a.group[href*="/anime/"]')
        .each((_, cardEl) => {
          const parsed = this._parseAnimeCard($, cardEl);
          if (parsed.slug) recommendations.push(parsed);
        });
    }

    return {
      slug,
      animeId,
      url,
      title,
      fullTitle,
      alternativeTitles,
      images: {
        ...posterImages,
        banner
      },
      gallery,
      trailer,
      isFeatured,
      type,
      status,
      year,
      episodes: episodes ?? (episodeList.length || null),
      duration,
      subtitle,
      fansub,
      score,
      scoredBy,
      bookmarks,
      datePublished: tvSeriesLd?.datePublished || null,
      dateModified: tvSeriesLd?.dateModified || null,
      synopsis,
      seasons,
      studios,
      directors,
      genres,
      casts,
      relatedSeries,
      externalLinks,
      episodeCount: episodeList.length,
      episodeList,
      recommendations
    };
  }

  /**
   * Alias for compatibility with AnimaScraper.getAnimeById interface
   */
  async getAnimeById(slug) {
    return this.getAnimeDetail(slug);
  }

  /**
   * 17. Anime Episodes List by Anime Slug
   */
  async getAnimeEpisodes(slug, options = {}) {
    const detail = await this.getAnimeDetail(slug);
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(options.limit, 10) || 100));
    const order = String(options.order || 'desc').toLowerCase();

    const list =
      order === 'asc' ? [...detail.episodeList].reverse() : detail.episodeList;

    const startIdx = (page - 1) * limit;
    const paginated = list.slice(startIdx, startIdx + limit);

    return {
      ...(detail.malId
        ? {
            malId: detail.malId,
            malUrl: detail.malUrl,
            linkedMal: detail.linkedMal
          }
        : {}),
      slug: detail.slug,
      title: detail.title,
      totalEpisodes: list.length,
      pagination: {
        currentPage: page,
        perPage: limit,
        totalPages: Math.ceil(list.length / limit) || 1,
        hasNextPage: startIdx + limit < list.length,
        hasPrevPage: page > 1
      },
      data: paginated
    };
  }

  /**
   * 18. Anime Characters / Casts by Anime Slug or MAL ID (AnimaScraper.getAnimeCharacters compatibility)
   */
  async getAnimeCharacters(slug) {
    const detail = await this.getAnimeDetail(slug);
    return {
      ...(detail.malId
        ? {
            malId: detail.malId,
            malUrl: detail.malUrl,
            linkedMal: detail.linkedMal
          }
        : {}),
      slug: detail.slug,
      title: detail.title,
      casts: detail.casts,
      directors: detail.directors
    };
  }

  /**
   * 19. Anime Recommendations & Related Series by Anime Slug or MAL ID
   */
  async getAnimeRecommendations(slug) {
    const detail = await this.getAnimeDetail(slug);
    return {
      ...(detail.malId
        ? {
            malId: detail.malId,
            malUrl: detail.malUrl,
            linkedMal: detail.linkedMal
          }
        : {}),
      slug: detail.slug,
      title: detail.title,
      relatedSeries: detail.relatedSeries,
      total: detail.recommendations.length,
      data: detail.recommendations
    };
  }

  /**
   * 20. Episode Detail, Direct Streaming Mirrors (`.mp4` / Embed) & Download Links
   * e.g. `/end-sousou-no-frieren-episode-28-subtitle-indonesia/`
   * or `/sousou-no-frieren-s2-episode-10-subtitle-indonesia/`
   */
  async getEpisodeDetail(rawEpisodeSlug) {
    const slug = extractSlug(rawEpisodeSlug);
    if (!slug || slug === 'anime') {
      throw new ScraperError(
        'Episode slug is required (e.g. "end-sousou-no-frieren-episode-28-subtitle-indonesia").',
        400
      );
    }

    const url = `${this.baseUrl}/${encodeURIComponent(slug)}/`;
    const html = await this._fetchHtml(url);
    const $ = loadHydratedCheerio(html);
    const jsonLdList = extractJsonLd($);
    const episodeLd = jsonLdList.find((item) => item['@type'] === 'TVEpisode') || null;
    const flightText = extractNextFlightText($);

    const main = $('main#main-content');
    const fullTitle = main.find('h1').first().text().replace(/\s+/g, ' ').trim() || null;
    const title = cleanAnimeTitle(fullTitle) || episodeLd?.name || null;

    // Top metadata row (Subtitle badge, release date, views count)
    const metaDiv = main.find('h1').first().next('div');
    const metaSpans = metaDiv.find('> span');
    const subtitle = metaSpans.eq(0).text().trim() || null;
    const releasedAt = metaSpans.eq(1).text().trim() || null;
    const viewsLabel = metaSpans.eq(2).text().replace(/\s+/g, ' ').trim() || null;
    const views =
      parseNumber(episodeLd?.interactionStatistic?.userInteractionCount) ??
      parseNumber(viewsLabel);

    // Extract LazyVideoPlayer props from HTML script (`episodeId`, `qualityOptions`, `posterUrl`)
    let episodeId = null;
    let qualityOptions = [];
    let posterUrl = episodeLd?.thumbnailUrl || null;

    const epIdMatch = flightText.match(
      /"posterUrl":("(?:\\.|[^"\\])*"|null),"episodeId":(\d+),"qualityOptions":(\[[^\]]*\])/
    );
    if (epIdMatch) {
      try {
        const parsedPoster = JSON.parse(epIdMatch[1]);
        if (parsedPoster) posterUrl = toAbsoluteUrl(parsedPoster, this.baseUrl);
      } catch {
        // Skip if poster parsing fails
      }
      episodeId = parseInt(epIdMatch[2], 10);
      try {
        qualityOptions = JSON.parse(epIdMatch[3]);
      } catch {
        qualityOptions = [];
      }
    } else {
      const fallbackIdMatch = flightText.match(/"episodeId":(\d+)/);
      if (fallbackIdMatch) episodeId = parseInt(fallbackIdMatch[1], 10);
    }

    // Fetch live streaming mirrors using `episodeId`
    let mirrors = [];
    let videoHostFallbacks = [];
    if (episodeId) {
      try {
        const mirrorPayload = await this._fetchJson(
          `${this.baseUrl}/api/video-mirrors/?e=${episodeId}`
        );
        videoHostFallbacks = Array.isArray(mirrorPayload.videoHostFallbacks)
          ? mirrorPayload.videoHostFallbacks
          : [];
        const fallbackGroups = Array.isArray(mirrorPayload.videoHostFallbackGroups)
          ? mirrorPayload.videoHostFallbackGroups
          : [];

        mirrors = (mirrorPayload.mirrors || []).map((m) => {
          const fallbackUrls = [];
          if (m.embedUrl) {
            try {
              const u = new URL(m.embedUrl);
              const matchingGroup = fallbackGroups.find(
                (grp) => Array.isArray(grp) && grp.includes(u.hostname)
              );
              const candidateHosts = matchingGroup || videoHostFallbacks;
              for (const host of candidateHosts) {
                if (host && host !== u.hostname) {
                  const alt = new URL(m.embedUrl);
                  alt.hostname = host;
                  fallbackUrls.push(alt.toString());
                }
              }
            } catch {
              // Ignore if not a valid URL
            }
          }

          return {
            id: m.id ?? null,
            serverName: m.serverName || 'SOKUJA',
            quality: m.quality || 'Default',
            embedType: m.embedType || 'mp4',
            url: m.embedUrl || null,
            fallbackUrls
          };
        });
      } catch {
        // Return episode data even if mirror endpoint fails to load
      }
    }

    // Navigation (Prev / All Episodes / Next)
    let prevEpisode = null;
    let nextEpisode = null;
    let animeSlug = null;
    let allEpisodesUrl = null;

    const allEpAnchor = main
      .find('a')
      .filter((_, a) => {
        const text = $(a).text().trim().toLowerCase();
        return text === 'semua episode' || text === 'all episodes';
      })
      .first();

    if (allEpAnchor.length) {
      const animeHref = allEpAnchor.attr('href');
      animeSlug = extractSlug(animeHref, 'anime');
      allEpisodesUrl = toAbsoluteUrl(animeHref, this.baseUrl);

      const navContainer = allEpAnchor.parent();
      const prevEl = navContainer.children().first();
      const nextEl = navContainer.children().last();

      if (prevEl.is('a')) {
        const pHref = prevEl.attr('href');
        const pSlug = extractSlug(pHref);
        if (pSlug) {
          prevEpisode = {
            slug: pSlug,
            url: toAbsoluteUrl(pHref, this.baseUrl)
          };
        }
      }

      if (nextEl.is('a')) {
        const nHref = nextEl.attr('href');
        const nSlug = extractSlug(nHref);
        if (nSlug) {
          nextEpisode = {
            slug: nSlug,
            url: toAbsoluteUrl(nHref, this.baseUrl)
          };
        }
      }
    }

    // Download Links
    const downloads = [];
    const dlH2 = main
      .find('h2')
      .filter((_, h) => $(h).text().trim().toLowerCase() === 'download')
      .first();

    if (dlH2.length) {
      dlH2
        .parent()
        .parent()
        .find('a[href]')
        .each((_, aEl) => {
          const dlHref = $(aEl).attr('href');
          if (!dlHref || dlHref === '#') return;
          const qualitySpan = $(aEl).find('span').first();
          const quality = qualitySpan.text().trim() || 'Default';
          const clone = $(aEl).clone();
          clone.find('span').first().remove();
          const label = clone.text().replace(/\s+/g, ' ').trim() || 'Download';

          downloads.push({
            quality,
            label,
            url: dlHref
          });
        });
    }

    // Other Episodes
    const otherEpisodes = [];
    const otherEpH2 = main
      .find('h2')
      .filter((_, h) => {
        const text = $(h).text().trim().toLowerCase();
        return text === 'episode lainnya' || text === 'other episodes';
      })
      .first();

    if (otherEpH2.length) {
      otherEpH2
        .parent()
        .parent()
        .find('a[href]')
        .each((_, aEl) => {
          const oHref = $(aEl).attr('href');
          const oSlug = extractSlug(oHref);
          if (!oSlug) return;

          const oImg = $(aEl).find('img').first();
          const epBadge = $(aEl).find('span').first().text().replace(/\s+/g, ' ').trim();
          const infoDivs = $(aEl).find('> div').last().find('div');

          otherEpisodes.push({
            slug: oSlug,
            episodeNumber: parseNumber(epBadge, true),
            label: infoDivs.eq(0).text().trim() || epBadge || null,
            title: infoDivs.eq(1).text().trim() || null,
            releasedAgo: infoDivs.eq(2).text().trim() || null,
            images: parseImages(oImg, this.baseUrl),
            url: toAbsoluteUrl(oHref, this.baseUrl)
          });
        });
    }

    // Series Information (Parent Anime Metadata)
    let anime = null;
    const seriesH2 = main
      .find('h2')
      .filter((_, h) => {
        const text = $(h).text().trim().toLowerCase();
        return text === 'informasi series' || text === 'series information';
      })
      .first();

    if (seriesH2.length) {
      const seriesCard = seriesH2.parent().parent();
      const seriesLinks = seriesCard.find('a[href*="/anime/"]');
      const posterAnchor = seriesLinks.eq(0);
      const titleAnchor = seriesLinks.eq(1).length ? seriesLinks.eq(1) : posterAnchor;
      const sHref = titleAnchor.attr('href') || episodeLd?.partOfSeries?.url;
      const sSlug = extractSlug(sHref, 'anime') || animeSlug;
      const sTitle =
        titleAnchor.text().trim() || episodeLd?.partOfSeries?.name || null;
      const sImg = posterAnchor.find('img').first();

      const badgeSpans = seriesCard
        .find('div.min-w-0 span')
        .map((_, sp) => $(sp).text().trim())
        .get();

      const seriesGenres = [];
      seriesCard.find('a[href^="/genre/"]').each((_, gEl) => {
        const gHref = $(gEl).attr('href');
        seriesGenres.push({
          slug: extractSlug(gHref, 'genre'),
          name: $(gEl).text().trim(),
          url: toAbsoluteUrl(gHref, this.baseUrl)
        });
      });

      const seriesSynopsis =
        seriesCard.find('h3').filter((_, h) => {
          const text = $(h).text().toLowerCase();
          return text.includes('sinopsis') || text.includes('synopsis');
        }).next().text().trim() ||
        episodeLd?.description ||
        null;

      anime = {
        slug: sSlug,
        title: sTitle,
        url: sSlug ? `${this.baseUrl}/anime/${encodeURIComponent(sSlug)}/` : allEpisodesUrl,
        images: parseImages(sImg, this.baseUrl),
        type: badgeSpans[0] || null,
        status: badgeSpans[1] || null,
        genres: seriesGenres,
        synopsis: seriesSynopsis
      };
    } else if (animeSlug || episodeLd?.partOfSeries) {
      const fallbackSlug = animeSlug || extractSlug(episodeLd?.partOfSeries?.url, 'anime');
      anime = {
        slug: fallbackSlug,
        title: episodeLd?.partOfSeries?.name || null,
        url: fallbackSlug ? `${this.baseUrl}/anime/${encodeURIComponent(fallbackSlug)}/` : null
      };
    }

    const episodeNumber =
      parseNumber(episodeLd?.episodeNumber, true) ??
      parseNumber(title?.match(/episode\s+(\d+(?:\.\d+)?)/i)?.[1], true);

    return {
      slug,
      episodeId,
      episodeNumber,
      url,
      title,
      fullTitle,
      thumbnail: posterUrl,
      subtitle,
      releasedAt,
      uploadDate: episodeLd?.uploadDate || null,
      views,
      viewsLabel,
      navigation: {
        prevEpisode,
        allEpisodesUrl: allEpisodesUrl || anime?.url || null,
        animeSlug: anime?.slug || animeSlug,
        nextEpisode
      },
      streaming: {
        qualityOptions,
        mirrors,
        videoHostFallbacks
      },
      downloads,
      anime,
      otherEpisodes
    };
  }
}

module.exports = {
  SokujaId
};

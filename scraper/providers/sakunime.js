const { ScraperError } = require('./myanimelist');
const { MalSakunimeLinker } = require('../malLinker');

const DEFAULT_BASE_URL = 'https://sakunime.com';
const SANKA_ANIME_DIRECT_URL = 'https://www.sankavollerei.web.id/anime/samehadaku';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const HI_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,180}$/i;

const DAY_ORDER_ID = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

const DAY_ALIASES = {
  monday: 'senin',
  senin: 'senin',
  tuesday: 'selasa',
  selasa: 'selasa',
  wednesday: 'rabu',
  rabu: 'rabu',
  thursday: 'kamis',
  kamis: 'kamis',
  friday: 'jumat',
  jumat: 'jumat',
  "jum'at": 'jumat',
  saturday: 'sabtu',
  sabtu: 'sabtu',
  sunday: 'minggu',
  minggu: 'minggu',
  ahad: 'minggu',
  random: 'random',
  acak: 'random',
  other: 'random'
};

const SERVER_ALIASES = {
  all: 'all',
  merged: 'all',
  hid: 'hid',
  s1: 'hid',
  server1: 'hid',
  hianime: 'hid',
  'sanka-en': 'hid',
  hi: 'hi',
  sm: 'sm',
  s2: 'sm',
  server2: 'sm',
  samehadaku: 'sm',
  'sanka-anime': 'sm',
  otaku: 'otaku',
  s3: 'otaku',
  server3: 'otaku',
  otakudesu: 'otaku'
};

const SERVER_LABELS = {
  hid: 'Server 1 (Sub Indo AI / Sub Eng / Dub)',
  hi: 'Server 1 (Sub Eng / Sub Indo AI / Dub)',
  sm: 'Server 2 (Samehadaku Sub Indo)',
  otaku: 'Server 3 (Otakudesu Sub Indo)'
};

const SM_GENRE_FALLBACK = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Harem',
  'Historical',
  'Isekai',
  'Mystery',
  'Reincarnation',
  'Romance',
  'School',
  'Sci-Fi',
  'Seinen',
  'Shounen',
  'Slice of Life',
  'Sports',
  'Super Power',
  'Supernatural'
];

function isNumericMalId(input) {
  if (typeof input === 'number') {
    return Number.isInteger(input) && input > 0;
  }
  if (typeof input === 'string') {
    return /^\d+$/.test(input.trim()) && parseInt(input.trim(), 10) > 0;
  }
  return false;
}

function parseNumber(val, isFloat = false) {
  if (val === undefined || val === null) return null;
  const cleaned = String(val).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!cleaned) return null;
  const num = isFloat ? parseFloat(cleaned[0]) : parseInt(cleaned[0], 10);
  return Number.isNaN(num) ? null : num;
}

function extractYear(str) {
  if (!str) return null;
  const m = String(str).match(/\b(19\d{2}|20\d{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

function genreKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeServerFilter(rawServer) {
  if (!rawServer) return 'all';
  const key = String(rawServer).toLowerCase().trim();
  const mapped = SERVER_ALIASES[key];
  if (!mapped) {
    throw new ScraperError(
      `Invalid server "${rawServer}". Allowed values: all, hid (Server 1), hi (Server 1 Eng), sm (Server 2), otaku (Server 3).`,
      400
    );
  }
  return mapped;
}

function toAbsoluteUrl(urlOrPath, baseUrl = DEFAULT_BASE_URL) {
  if (!urlOrPath) return null;
  const trimmed = String(urlOrPath).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

function buildImageSet(poster, banner = null, baseUrl = DEFAULT_BASE_URL) {
  const absPoster = toAbsoluteUrl(poster, baseUrl);
  const absBanner = toAbsoluteUrl(banner, baseUrl);
  return {
    small: absPoster,
    default: absPoster,
    large: absPoster,
    ...(absBanner !== null ? { banner: absBanner } : {})
  };
}

function cleanAnimeTitle(rawTitle) {
  if (!rawTitle) return null;
  return (
    String(rawTitle)
      .replace(/\s*(?:Subtitle\s+Indonesia|Sub\s+Indo)\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim() || String(rawTitle).trim()
  );
}

function translateAgoId(text) {
  if (!text) return null;
  return String(text)
    .replace(/\bseconds?\b/gi, 'detik')
    .replace(/\bminutes?\b/gi, 'menit')
    .replace(/\bhours?\b/gi, 'jam')
    .replace(/\bdays?\b/gi, 'hari')
    .replace(/\bweeks?\b/gi, 'minggu')
    .replace(/\bmonths?\b/gi, 'bulan')
    .replace(/\byears?\b/gi, 'tahun')
    .trim();
}

function normalizeStatusLabel(status) {
  if (!status) return null;
  const s = String(status).trim();
  if (/currently\s*airing|ongoing|sedang\s*tayang/i.test(s)) return 'Ongoing';
  if (/finished\s*airing|completed|tamat|selesai/i.test(s)) return 'Completed';
  if (/not\s*yet\s*aired|upcoming/i.test(s)) return 'Upcoming';
  return s;
}

/**
 * Extract clean Sakunime slug from a URL, path, or raw slug while preserving `~` prefixes
 * Examples:
 * - "https://sakunime.com/anime/hid~frieren-beyond-journeys-end-154587" -> "hid~frieren-beyond-journeys-end-154587"
 * - "/watch/hid~frieren-beyond-journeys-end-154587~1~1/" -> "hid~frieren-beyond-journeys-end-154587~1~1"
 * - "sm~zombie-sagashitemasu" -> "sm~zombie-sagashitemasu"
 */
function extractSakunimeSlug(input, expectedPrefix = null) {
  if (!input) return null;
  let str = String(input).trim();
  try {
    if (str.startsWith('http://') || str.startsWith('https://')) {
      str = new URL(str).pathname;
    }
  } catch {
    // Keep raw string
  }

  try {
    str = decodeURIComponent(str);
  } catch {
    // Keep raw string if malformed percent-encoding
  }

  str = str.split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '');
  if (expectedPrefix && str.startsWith(`${expectedPrefix}/`)) {
    str = str.slice(expectedPrefix.length + 1);
  } else if (str.startsWith('anime/')) {
    str = str.slice('anime/'.length);
  } else if (str.startsWith('watch/')) {
    str = str.slice('watch/'.length);
  } else if (str.startsWith('episode/')) {
    str = str.slice('episode/'.length);
  } else if (str.startsWith('genre/')) {
    str = str.slice('genre/'.length).split('/')[0];
  }

  return str.replace(/^\/+|\/+$/g, '') || null;
}

/**
 * Parse a Sakunime anime slug into server metadata & upstream raw ID
 */
function parseAnimeSlug(rawInput) {
  const fullSlug = extractSakunimeSlug(rawInput, 'anime');
  if (!fullSlug) return null;

  if (fullSlug.startsWith('hid~')) {
    const rawId = fullSlug.slice(4);
    const anilistMatch = rawId.match(/-(\d{2,8})$/);
    return {
      slug: `hid~${rawId}`,
      rawId,
      prefix: 'hid~',
      server: 'hid',
      serverLabel: SERVER_LABELS.hid,
      anilistId: anilistMatch ? parseInt(anilistMatch[1], 10) : null
    };
  }

  if (fullSlug.startsWith('hi~')) {
    const rawId = fullSlug.slice(3);
    const anilistMatch = rawId.match(/-(\d{2,8})$/);
    return {
      slug: `hi~${rawId}`,
      rawId,
      prefix: 'hi~',
      server: 'hi',
      serverLabel: SERVER_LABELS.hi,
      anilistId: anilistMatch ? parseInt(anilistMatch[1], 10) : null
    };
  }

  if (fullSlug.startsWith('sm~')) {
    const rawId = fullSlug.slice(3);
    return {
      slug: `sm~${rawId}`,
      rawId,
      prefix: 'sm~',
      server: 'sm',
      serverLabel: SERVER_LABELS.sm,
      anilistId: null
    };
  }

  return {
    slug: fullSlug,
    rawId: fullSlug,
    prefix: '',
    server: 'otaku',
    serverLabel: SERVER_LABELS.otaku,
    anilistId: null
  };
}

/**
 * Parse episode number from title or episode slug
 */
function extractEpisodeNumber(title, episodeSlug) {
  if (typeof title === 'number' && !Number.isNaN(title)) return title;
  const titleStr = String(title || '').trim();
  if (/^\d+(?:\.\d+)?$/.test(titleStr)) return parseFloat(titleStr);

  const mTitle = titleStr.match(/episode\s*(\d+(?:\.\d+)?)/i);
  if (mTitle) return parseFloat(mTitle[1]);

  const slugStr = String(episodeSlug || '');
  const mHi = slugStr.match(/~(\d+(?:\.\d+)?)$/);
  if (mHi) return parseFloat(mHi[1]);

  const mSlug = slugStr.match(/episode-(\d+(?:\.\d+)?)/i);
  if (mSlug) return parseFloat(mSlug[1]);

  return null;
}

class Sakunime {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout || 20000;
    this.cacheTTL = options.cacheTTL ?? 5 * 60 * 1000;
    this.cache = new Map();
    this.headers = {
      'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      Referer: `${this.baseUrl}/`,
      ...options.headers
    };

    this.malLinker = new MalSakunimeLinker({
      sakunimeProvider: this,
      malProvider: options.malProvider,
      cacheTTL: options.linkCacheTTL ?? 60 * 60 * 1000
    });
  }

  async _fetchJson(url, { ttl = this.cacheTTL, timeout = this.timeout } = {}) {
    const now = Date.now();
    if (ttl > 0 && this.cache.has(url)) {
      const cached = this.cache.get(url);
      if (now - cached.timestamp < ttl) {
        return cached.data;
      }
      this.cache.delete(url);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        headers: this.headers,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new ScraperError(
          `Failed to fetch data from Sakunime (HTTP ${response.status})`,
          response.status === 404 ? 404 : response.status === 429 ? 429 : 502
        );
      }

      const json = await response.json();

      if (ttl > 0) {
        if (this.cache.size >= 400) {
          const oldestKey = this.cache.keys().next().value;
          this.cache.delete(oldestKey);
        }
        this.cache.set(url, { data: json, timestamp: now });
      }

      return json;
    } catch (err) {
      if (err instanceof ScraperError) throw err;
      if (err.name === 'AbortError') {
        throw new ScraperError(`Request to Sakunime timed out (${timeout}ms)`, 504);
      }
      if (err instanceof SyntaxError) {
        throw new ScraperError('Invalid JSON response received from Sakunime upstream.', 502);
      }
      throw new ScraperError(`Network error while contacting Sakunime: ${err.message}`, 502);
    } finally {
      clearTimeout(timer);
    }
  }

  async _hiGet(path, options = {}) {
    const url = `${this.baseUrl}/sanka-en${path}`;
    const json = await this._fetchJson(url, options);
    if (!json || json.status !== 'success' || !json.data) {
      throw new ScraperError(json?.message || 'Resource not found on Sakunime Server 1.', 404);
    }
    return json.data;
  }

  async _smGet(path, options = {}) {
    const primaryUrl = `${this.baseUrl}/sanka-anime${path}`;
    try {
      const json = await this._fetchJson(primaryUrl, options);
      if (!json || json.status !== 'success') {
        throw new ScraperError('Bad response from Sakunime Server 2.', 502);
      }
      return json;
    } catch (primaryErr) {
      if (primaryErr.status === 404) throw primaryErr;
      const fallbackUrl = `${SANKA_ANIME_DIRECT_URL}${path}`;
      const json = await this._fetchJson(fallbackUrl, options);
      if (!json || json.status !== 'success') {
        throw primaryErr;
      }
      return json;
    }
  }

  async _otakuGet(path, options = {}) {
    const url = `${this.baseUrl}/otakudesu${path}`;
    const json = await this._fetchJson(url, options);
    if (!json || (json.status && json.status !== 'success' && json.statusCode >= 400)) {
      throw new ScraperError(json?.message || 'Resource not found on Sakunime Server 3.', 404);
    }
    return json;
  }

  _normalizeHiCard(item, prefix = 'hid~') {
    if (!item || !item.id || !HI_SLUG_RE.test(item.id)) return null;
    const romajiTitle = String(item.jtitle || '').trim();
    const engTitle = String(item.title || '').trim();
    const title = romajiTitle || engTitle;
    if (!title) return null;

    const slug = `${prefix}${item.id}`;
    const server = prefix === 'hi~' ? 'hi' : 'hid';
    const anilistMatch = String(item.id).match(/-(\d{2,8})$/);
    const alternativeTitles = [];
    if (engTitle && engTitle !== title) alternativeTitles.push(engTitle);

    return {
      slug,
      rawId: item.id,
      server,
      serverLabel: SERVER_LABELS[server],
      anilistId: anilistMatch ? parseInt(anilistMatch[1], 10) : null,
      title,
      englishTitle: engTitle || null,
      alternativeTitles,
      url: `${this.baseUrl}/anime/${slug}`,
      images: buildImageSet(item.poster, null, this.baseUrl),
      type: item.type || null,
      status: normalizeStatusLabel(item.status),
      score: parseNumber(item.score, true),
      episodes: parseNumber(item.eps),
      episodesLabel: item.eps ? String(item.eps) : null,
      genres: Array.isArray(item.genres)
        ? item.genres.map((g) => ({
            slug: genreKey(g),
            name: String(g),
            url: `${this.baseUrl}/anime/genre/${genreKey(g)}/1/`
          }))
        : []
    };
  }

  _normalizeSmCard(item, defaultStatus = null) {
    if (!item || !item.animeId || !item.title) return null;
    const slug = `sm~${item.animeId}`;
    const title = cleanAnimeTitle(item.title);
    return {
      slug,
      rawId: item.animeId,
      server: 'sm',
      serverLabel: SERVER_LABELS.sm,
      anilistId: null,
      title,
      englishTitle: null,
      alternativeTitles: [],
      url: `${this.baseUrl}/anime/${slug}`,
      images: buildImageSet(item.poster, null, this.baseUrl),
      type: item.type || null,
      status: normalizeStatusLabel(item.status || defaultStatus),
      score: parseNumber(item.score, true),
      episodes: parseNumber(item.episodes),
      episodesLabel: item.episodes ? String(item.episodes) : null,
      releasedAgo: translateAgoId(item.releasedOn),
      genres: Array.isArray(item.genreList)
        ? item.genreList
            .filter((g) => g && (g.title || g.genreId))
            .map((g) => {
              const gSlug = genreKey(g.genreId || g.title);
              return {
                slug: gSlug,
                name: g.title || g.genreId,
                url: `${this.baseUrl}/anime/genre/${gSlug}/1/`
              };
            })
        : []
    };
  }

  _normalizeOtakuCard(item, defaultStatus = null) {
    if (!item || !item.animeId || !item.title) return null;
    const slug = String(item.animeId).trim();
    const title = cleanAnimeTitle(item.title);
    return {
      slug,
      rawId: slug,
      server: 'otaku',
      serverLabel: SERVER_LABELS.otaku,
      anilistId: null,
      title,
      englishTitle: null,
      alternativeTitles: [],
      url: `${this.baseUrl}/anime/${slug}`,
      images: buildImageSet(item.poster, null, this.baseUrl),
      type: item.type || null,
      status: normalizeStatusLabel(item.status || defaultStatus),
      score: parseNumber(item.score, true),
      episodes: parseNumber(item.episodes),
      episodesLabel: item.episodes ? String(item.episodes) : null,
      releaseDay: item.releaseDay || null,
      latestReleaseDate: item.latestReleaseDate || null,
      genres: Array.isArray(item.genreList)
        ? item.genreList
            .filter((g) => g && (g.title || g.genreId))
            .map((g) => {
              const gSlug = genreKey(g.genreId || g.title);
              return {
                slug: gSlug,
                name: g.title || g.genreId,
                url: `${this.baseUrl}/anime/genre/${gSlug}/1/`
              };
            })
        : []
    };
  }

  _mergePagination(page, paginations = [], hasItems = false) {
    let totalPages = 1;
    let hasNextPage = false;

    for (const p of paginations) {
      if (!p) continue;
      if (typeof p.totalPages === 'number' && p.totalPages > totalPages) {
        totalPages = p.totalPages;
      }
      if (p.hasNextPage || p.hasNext) {
        hasNextPage = true;
      }
    }

    if (hasNextPage && totalPages <= page) {
      totalPages = page + 1;
    }
    if (!hasItems && page > 1 && totalPages < page) {
      totalPages = page;
    }

    return {
      currentPage: page,
      totalPages,
      hasNextPage,
      hasPrevPage: page > 1
    };
  }

  /**
   * 1. Homepage (Featured Hero, Latest Releases, Ongoing, Completed, Popular & Genres)
   */
  async getHome(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const server = normalizeServerFilter(options.server);

    const [ongoingRes, completedRes, latestRes, popularRes, genres] = await Promise.all([
      this.getOngoingAnime({ page, server }).catch(() => ({ data: [] })),
      this.getCompletedAnime({ page: 1, server }).catch(() => ({ data: [] })),
      this.getLatestUpdates({ page }).catch(() => ({ data: [] })),
      this.getTopAnime({ type: 'popular', page: 1 }).catch(() => ({ data: [] })),
      this.getGenres().catch(() => [])
    ]);

    return {
      page,
      serverFilter: server,
      featured: ongoingRes.data.slice(0, 8),
      latestReleases: latestRes.data.slice(0, 20),
      ongoing: ongoingRes.data,
      completed: completedRes.data.slice(0, 24),
      popular: popularRes.data.slice(0, 15),
      genres
    };
  }

  /**
   * 2. Latest Episode Updates
   */
  async getLatestUpdates(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const res = await this._smGet(`/recent?page=${page}`);
    const rawList = Array.isArray(res?.data?.animeList) ? res.data.animeList : [];

    const data = rawList
      .filter((item) => item && item.animeId && item.title)
      .map((item) => {
        const animeSlug = `sm~${item.animeId}`;
        const episodeSlug = item.episodeId ? `sm~${item.episodeId}` : null;
        const epNumber = parseNumber(item.episodes, true);

        return {
          slug: episodeSlug || animeSlug,
          episodeSlug,
          animeSlug,
          server: 'sm',
          serverLabel: SERVER_LABELS.sm,
          title: cleanAnimeTitle(item.title),
          episode: epNumber,
          episodeLabel: item.episodes ? `Episode ${item.episodes}` : null,
          releasedAgo: translateAgoId(item.releasedOn),
          images: buildImageSet(item.poster, null, this.baseUrl),
          url: episodeSlug ? `${this.baseUrl}/watch/${episodeSlug}` : `${this.baseUrl}/anime/${animeSlug}`,
          animeUrl: `${this.baseUrl}/anime/${animeSlug}`
        };
      });

    return {
      pagination: this._mergePagination(page, [res?.pagination], data.length > 0),
      data
    };
  }

  /**
   * 3. Search Anime across Sakunime servers (`hid~`, `sm~`, `otaku`)
   */
  async search(query, options = {}) {
    const cleanQuery = String(query || '')
      .replace(/[/\\?#%]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanQuery) {
      throw new ScraperError('Search query parameter "q" is required.', 400);
    }

    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const server = normalizeServerFilter(options.server);
    const hiPrefix = server === 'hi' ? 'hi~' : 'hid~';

    const tasks = [];
    if (server === 'all' || server === 'hid' || server === 'hi') {
      tasks.push(
        this._hiGet(`/search?q=${encodeURIComponent(cleanQuery)}`)
          .then((d) => (d.list || []).map((it) => this._normalizeHiCard(it, hiPrefix)).filter(Boolean))
          .catch(() => [])
      );
    }
    if (server === 'all' || server === 'sm') {
      tasks.push(
        this._smGet(`/search?q=${encodeURIComponent(cleanQuery)}`)
          .then((r) => (r?.data?.animeList || []).map((it) => this._normalizeSmCard(it)).filter(Boolean))
          .catch(() => [])
      );
    }
    if (server === 'all' || server === 'otaku') {
      tasks.push(
        this._otakuGet(`/search/${encodeURIComponent(cleanQuery)}`)
          .catch(() => this._otakuGet(`/search?q=${encodeURIComponent(cleanQuery)}`))
          .then((r) => (r?.data?.animeList || []).map((it) => this._normalizeOtakuCard(it)).filter(Boolean))
          .catch(() => [])
      );
    }

    const groups = await Promise.all(tasks);
    const seen = new Set();
    const merged = [];
    for (const group of groups) {
      for (const item of group) {
        if (item && !seen.has(item.slug)) {
          seen.add(item.slug);
          merged.push(item);
        }
      }
    }

    return {
      query: cleanQuery,
      serverFilter: server,
      pagination: {
        currentPage: page,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false
      },
      total: merged.length,
      data: merged
    };
  }

  /**
   * 4. Browse / Filter Anime Catalog
   */
  async browseAnime(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const server = normalizeServerFilter(options.server);
    const genre = options.genre ? genreKey(options.genre) : null;
    const status = options.status ? String(options.status).toLowerCase().trim() : null;
    const type = options.type ? String(options.type).toLowerCase().trim() : null;
    const order = options.order ? String(options.order).toLowerCase().trim() : 'update';

    let baseResult;
    if (genre) {
      baseResult = await this.getAnimeByGenre(genre, { page, server });
    } else if (type === 'movie') {
      baseResult = await this.getMovies({ page, server });
    } else if (order === 'popular' && !status) {
      baseResult = await this.getTopAnime({ type: 'popular', page });
    } else if (status === 'completed') {
      baseResult = await this.getCompletedAnime({ page, server });
    } else if (status === 'ongoing') {
      baseResult = await this.getOngoingAnime({ page, server });
    } else {
      const [ongoing, completed] = await Promise.all([
        this.getOngoingAnime({ page, server }).catch(() => ({ data: [], pagination: null })),
        this.getCompletedAnime({ page, server }).catch(() => ({ data: [], pagination: null }))
      ]);
      const combined = [...ongoing.data, ...completed.data];
      const seen = new Set();
      const deduped = combined.filter((item) => {
        if (seen.has(item.slug)) return false;
        seen.add(item.slug);
        return true;
      });
      baseResult = {
        pagination: this._mergePagination(
          page,
          [ongoing.pagination, completed.pagination],
          deduped.length > 0
        ),
        data: deduped
      };
    }

    let filtered = [...(baseResult.data || [])];

    if (server !== 'all') {
      filtered = filtered.filter((item) => item.server === server);
    }
    if (status) {
      filtered = filtered.filter(
        (item) => !item.status || item.status.toLowerCase() === status
      );
    }
    if (type) {
      filtered = filtered.filter(
        (item) => !item.type || item.type.toLowerCase() === type
      );
    }

    if (order === 'score' || order === 'rating') {
      filtered.sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (order === 'title' || order === 'az') {
      filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (order === 'za') {
      filtered.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
    }

    return {
      filters: {
        genre,
        status,
        type,
        order,
        server
      },
      totalCount: filtered.length,
      pagination: baseResult.pagination,
      data: filtered
    };
  }

  /**
   * 5. Ongoing Anime
   */
  async getOngoingAnime(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const server = normalizeServerFilter(options.server);
    const hiPrefix = server === 'hi' ? 'hi~' : 'hid~';

    const tasks = [];
    if (server === 'all' || server === 'hid' || server === 'hi') {
      tasks.push(
        this._hiGet(`/list?type=ongoing&page=${page}`)
          .then((d) => ({
            items: (d.list || [])
              .map((it) => this._normalizeHiCard(it, hiPrefix))
              .filter(Boolean)
              .map((it) => ({ ...it, status: it.status || 'Ongoing' })),
            pagination: { currentPage: page, hasNextPage: Boolean(d.hasNext || (d.list && d.list.length >= 20)) }
          }))
          .catch(() => ({ items: [], pagination: null }))
      );
    }
    if (server === 'all' || server === 'sm') {
      tasks.push(
        this._smGet(`/ongoing?page=${page}`)
          .then((r) => ({
            items: (r?.data?.animeList || [])
              .map((it) => this._normalizeSmCard(it, 'Ongoing'))
              .filter(Boolean),
            pagination: r?.pagination || null
          }))
          .catch(() => ({ items: [], pagination: null }))
      );
    }
    if (server === 'all' || server === 'otaku') {
      tasks.push(
        this._otakuGet(`/ongoing?page=${page}`)
          .then((r) => ({
            items: (r?.data?.animeList || [])
              .map((it) => this._normalizeOtakuCard(it, 'Ongoing'))
              .filter(Boolean),
            pagination: r?.pagination || null
          }))
          .catch(() => ({ items: [], pagination: null }))
      );
    }

    const results = await Promise.all(tasks);
    const data = [];
    const seen = new Set();
    for (const r of results) {
      for (const item of r.items) {
        if (!seen.has(item.slug)) {
          seen.add(item.slug);
          data.push(item);
        }
      }
    }

    return {
      serverFilter: server,
      totalCount: data.length,
      pagination: this._mergePagination(
        page,
        results.map((r) => r.pagination),
        data.length > 0
      ),
      data
    };
  }

  /**
   * 6. Completed Anime
   */
  async getCompletedAnime(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const server = normalizeServerFilter(options.server);
    const hiPrefix = server === 'hi' ? 'hi~' : 'hid~';

    const tasks = [];
    if (server === 'all' || server === 'hid' || server === 'hi') {
      tasks.push(
        this._hiGet(`/list?type=completed&page=${page}`)
          .then((d) => ({
            items: (d.list || [])
              .map((it) => this._normalizeHiCard(it, hiPrefix))
              .filter((it) => it && !/ongoing/i.test(it.status || ''))
              .map((it) => ({ ...it, status: it.status || 'Completed' })),
            pagination: { currentPage: page, hasNextPage: Boolean(d.hasNext) }
          }))
          .catch(() => ({ items: [], pagination: null }))
      );
    }
    if (server === 'all' || server === 'sm') {
      tasks.push(
        this._smGet(`/completed?page=${page}`)
          .then((r) => ({
            items: (r?.data?.animeList || [])
              .map((it) => this._normalizeSmCard(it, 'Completed'))
              .filter(Boolean),
            pagination: r?.pagination || null
          }))
          .catch(() => ({ items: [], pagination: null }))
      );
    }
    if (server === 'all' || server === 'otaku') {
      tasks.push(
        this._otakuGet(`/completed?page=${page}`)
          .then((r) => ({
            items: (r?.data?.animeList || [])
              .map((it) => this._normalizeOtakuCard(it, 'Completed'))
              .filter(Boolean),
            pagination: r?.pagination || null
          }))
          .catch(() => ({ items: [], pagination: null }))
      );
    }

    const results = await Promise.all(tasks);
    const data = [];
    const seen = new Set();
    for (const r of results) {
      for (const item of r.items) {
        if (!seen.has(item.slug)) {
          seen.add(item.slug);
          data.push(item);
        }
      }
    }

    return {
      serverFilter: server,
      totalCount: data.length,
      pagination: this._mergePagination(
        page,
        results.map((r) => r.pagination),
        data.length > 0
      ),
      data
    };
  }

  /**
   * 7. Anime Movies
   */
  async getMovies(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const server = normalizeServerFilter(options.server);
    const hiPrefix = server === 'hi' ? 'hi~' : 'hid~';

    const tasks = [];
    if (server === 'all' || server === 'sm') {
      tasks.push(
        this._smGet(`/movies?page=${page}`)
          .then((r) => ({
            items: (r?.data?.animeList || [])
              .map((it) => this._normalizeSmCard({ ...it, type: it.type || 'Movie' }))
              .filter(Boolean),
            pagination: r?.pagination || null
          }))
          .catch(() => ({ items: [], pagination: null }))
      );
    }
    if (server === 'all' || server === 'hid' || server === 'hi') {
      tasks.push(
        this._hiGet(`/genre/movie?page=${page}`)
          .then((d) => ({
            items: (d.list || [])
              .map((it) => this._normalizeHiCard({ ...it, type: it.type || 'Movie' }, hiPrefix))
              .filter(Boolean),
            pagination: { currentPage: page, hasNextPage: Boolean(d.hasNext) }
          }))
          .catch(() => ({ items: [], pagination: null }))
      );
    }

    const results = await Promise.all(tasks);
    const data = [];
    const seen = new Set();
    for (const r of results) {
      for (const item of r.items) {
        if (!seen.has(item.slug)) {
          seen.add(item.slug);
          data.push(item);
        }
      }
    }

    return {
      serverFilter: server,
      totalCount: data.length,
      pagination: this._mergePagination(
        page,
        results.map((r) => r.pagination),
        data.length > 0
      ),
      data
    };
  }

  /**
   * 8. Top / Popular Anime
   */
  async getTopAnime(options = {}) {
    const rawType = String(options.type || 'popular').toLowerCase().trim();
    const page = Math.max(1, parseInt(options.page, 10) || 1);

    let listResult;
    if (rawType === 'popular' || rawType === 'bypopularity' || rawType === 'favorite' || rawType === 'all') {
      const res = await this._smGet(`/popular?page=${page}`);
      const items = (res?.data?.animeList || [])
        .map((it) => this._normalizeSmCard(it))
        .filter(Boolean);
      listResult = {
        pagination: this._mergePagination(page, [res?.pagination], items.length > 0),
        data: items
      };
    } else if (rawType === 'score' || rawType === 'rating') {
      const res = await this._smGet(`/popular?page=${page}`);
      const items = (res?.data?.animeList || [])
        .map((it) => this._normalizeSmCard(it))
        .filter(Boolean)
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      listResult = {
        pagination: this._mergePagination(page, [res?.pagination], items.length > 0),
        data: items
      };
    } else if (rawType === 'airing' || rawType === 'ongoing') {
      listResult = await this.getOngoingAnime({ page });
    } else if (rawType === 'movie' || rawType === 'movies') {
      listResult = await this.getMovies({ page });
    } else {
      throw new ScraperError(
        `Invalid top anime type "${rawType}". Allowed values: popular, score, ongoing, movie, all, bypopularity, favorite`,
        400
      );
    }

    const startRank = (page - 1) * (listResult.data.length || 20);
    const rankedData = listResult.data.map((item, idx) => ({
      rank: startRank + idx + 1,
      ...item
    }));

    return {
      filter: rawType,
      totalCount: rankedData.length,
      pagination: listResult.pagination,
      data: rankedData
    };
  }

  /**
   * 9. Alphabetical Anime Directory A-Z (Aggregated from active catalog)
   */
  async getAnimeListAZ(options = {}) {
    const letterFilter = options.letter ? String(options.letter).trim().toUpperCase() : null;
    const server = normalizeServerFilter(options.server);

    const [ongoing, completed, popular] = await Promise.all([
      this.getOngoingAnime({ page: 1, server }).catch(() => ({ data: [] })),
      this.getCompletedAnime({ page: 1, server }).catch(() => ({ data: [] })),
      server === 'all' || server === 'sm'
        ? this.getTopAnime({ type: 'popular', page: 1 }).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] })
    ]);

    const seen = new Set();
    const bucketMap = new Map();

    for (const item of [...ongoing.data, ...completed.data, ...popular.data]) {
      if (!item || !item.slug || seen.has(item.slug)) continue;
      seen.add(item.slug);

      const firstChar = String(item.title || '')
        .trim()
        .charAt(0)
        .toUpperCase();
      const letter = /^[A-Z]$/.test(firstChar) ? firstChar : '#';

      if (letterFilter && letter !== letterFilter) continue;

      if (!bucketMap.has(letter)) bucketMap.set(letter, []);
      bucketMap.get(letter).push({
        slug: item.slug,
        server: item.server,
        title: item.title,
        type: item.type,
        status: item.status,
        score: item.score,
        url: item.url
      });
    }

    const sortedLetters = Array.from(bucketMap.keys()).sort((a, b) => {
      if (a === '#') return -1;
      if (b === '#') return 1;
      return a.localeCompare(b);
    });

    let total = 0;
    const groups = sortedLetters.map((letter) => {
      const items = bucketMap
        .get(letter)
        .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      total += items.length;
      return {
        letter,
        count: items.length,
        items
      };
    });

    return {
      letterFilter,
      serverFilter: server,
      total,
      groups
    };
  }

  /**
   * 10. Weekly Release Schedule (`/anime/jadwal/`)
   * Merges Server 1 (7-day date schedule), Server 2 (Samehadaku), and Server 3 (Otakudesu)
   */
  async getSchedule(options = {}) {
    const rawDay = options.day ? String(options.day).toLowerCase().trim() : null;
    const normalizedDayFilter = rawDay ? DAY_ALIASES[rawDay] || null : null;
    if (rawDay && !normalizedDayFilter) {
      throw new ScraperError(
        `Invalid day "${rawDay}". Allowed values: monday..sunday or senin..minggu, random.`,
        400
      );
    }

    const server = normalizeServerFilter(options.server);
    const hiPrefix = server === 'hi' ? 'hi~' : 'hid~';

    const scheduleMap = new Map();
    for (const dayName of DAY_ORDER_ID) {
      scheduleMap.set(dayName, []);
    }

    const addEntry = (dayLabel, entry) => {
      if (!entry || !entry.slug) return;
      const cleanDay = String(dayLabel || '').trim();
      const matchedDay =
        DAY_ORDER_ID.find((d) => d.toLowerCase() === cleanDay.toLowerCase()) || 'Random';
      if (!scheduleMap.has(matchedDay)) scheduleMap.set(matchedDay, []);
      const list = scheduleMap.get(matchedDay);
      if (!list.some((x) => x.slug === entry.slug)) {
        list.push(entry);
      }
    };

    const tasks = [];

    // Server 1: fetch next 7 calendar days (or matching day only when filtered)
    if (server === 'all' || server === 'hid' || server === 'hi') {
      const now = new Date();
      const targetDates = [];
      for (let i = 0; i < 7; i++) {
        const dt = new Date(now.getTime() + i * 86400000);
        const dayName = DAY_ORDER_ID[(dt.getDay() + 6) % 7];
        if (!normalizedDayFilter || dayName.toLowerCase() === normalizedDayFilter) {
          targetDates.push({ date: dt.toISOString().slice(0, 10), dayName });
        }
      }

      tasks.push(
        Promise.all(
          targetDates.map(async ({ date, dayName }) => {
            try {
              const d = await this._hiGet(`/schedule?date=${encodeURIComponent(date)}`, {
                timeout: 12000
              });
              for (const item of d.list || []) {
                const title = String(item.jtitle || item.title || '').trim();
                if (!item.id || !title) continue;
                const slug = `${hiPrefix}${item.id}`;
                addEntry(dayName, {
                  slug,
                  server: server === 'hi' ? 'hi' : 'hid',
                  serverLabel: SERVER_LABELS[server === 'hi' ? 'hi' : 'hid'],
                  title,
                  englishTitle: item.title && item.title !== title ? item.title : null,
                  time: item.time ? `${item.time} WIB` : null,
                  episode: parseNumber(item.ep, true),
                  images: buildImageSet(item.poster, null, this.baseUrl),
                  url: `${this.baseUrl}/anime/${slug}`
                });
              }
            } catch {
              // Ignore failed date
            }
          })
        )
      );
    }

    // Server 2: Samehadaku schedule
    if (server === 'all' || server === 'sm') {
      tasks.push(
        this._smGet('/schedule')
          .then((res) => {
            for (const group of res?.data?.days || []) {
              for (const item of group.animeList || []) {
                if (!item.animeId || !item.title) continue;
                const slug = `sm~${item.animeId}`;
                addEntry(group.day, {
                  slug,
                  server: 'sm',
                  serverLabel: SERVER_LABELS.sm,
                  title: cleanAnimeTitle(item.title),
                  time: item.estimation || null,
                  type: item.type || null,
                  score: parseNumber(item.score, true),
                  genres: item.genres
                    ? String(item.genres)
                        .split(',')
                        .map((g) => g.trim())
                        .filter(Boolean)
                    : [],
                  images: buildImageSet(item.poster, null, this.baseUrl),
                  url: `${this.baseUrl}/anime/${slug}`
                });
              }
            }
          })
          .catch(() => {})
      );
    }

    // Server 3: Otakudesu schedule
    if (server === 'all' || server === 'otaku') {
      tasks.push(
        this._otakuGet('/schedule')
          .then((res) => {
            for (const group of res?.data?.scheduleList || []) {
              for (const item of group.animeList || []) {
                if (!item.animeId || !item.title) continue;
                const slug = String(item.animeId).trim();
                addEntry(group.title, {
                  slug,
                  server: 'otaku',
                  serverLabel: SERVER_LABELS.otaku,
                  title: cleanAnimeTitle(item.title),
                  time: null,
                  images: buildImageSet(item.poster || null, null, this.baseUrl),
                  url: `${this.baseUrl}/anime/${slug}`
                });
              }
            }
          })
          .catch(() => {})
      );
    }

    await Promise.all(tasks);

    const schedule = {};
    let total = 0;

    for (const [dayName, items] of scheduleMap.entries()) {
      if (normalizedDayFilter && dayName.toLowerCase() !== normalizedDayFilter) {
        continue;
      }
      if (items.length > 0 || normalizedDayFilter) {
        schedule[dayName] = items;
        total += items.length;
      }
    }

    return {
      dayFilter: rawDay,
      serverFilter: server,
      total,
      schedule
    };
  }

  /**
   * Internal Genre Index merging Server 2 & Server 3 genre maps
   */
  async _loadGenreIndex() {
    const [otakuRes, smRes] = await Promise.all([
      this._otakuGet('/genre').catch(() => null),
      this._smGet('/genres').catch(() => null)
    ]);

    const map = new Map();
    const register = (list, serverKey, getId) => {
      for (const g of list || []) {
        const name = String(g?.title || g?.name || '').trim();
        const rawId = getId(g);
        if (!name || !rawId) continue;
        const slug = genreKey(name);
        if (!slug) continue;
        const entry = map.get(slug) || {
          slug,
          name,
          servers: {}
        };
        if (!entry.servers[serverKey]) {
          entry.servers[serverKey] = rawId;
        }
        map.set(slug, entry);
      }
    };

    register(otakuRes?.data?.genreList, 'otaku', (g) => g.genreId || g.slug);

    const smGenres = smRes?.data?.genreList?.length
      ? smRes.data.genreList
      : SM_GENRE_FALLBACK.map((t) => ({ title: t, genreId: genreKey(t) }));
    register(smGenres, 'sm', (g) => g.genreId);

    for (const entry of map.values()) {
      entry.servers.hid = entry.slug;
    }

    return map;
  }

  /**
   * 11. All Genres
   */
  async getGenres() {
    const map = await this._loadGenreIndex();
    return Array.from(map.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({
        slug: entry.slug,
        name: entry.name,
        servers: Object.keys(entry.servers),
        url: `${this.baseUrl}/anime/genre/${entry.slug}/1/`
      }));
  }

  /**
   * 12. Anime by Genre Slug (`/anime/genre/:slug/:page/`)
   */
  async getAnimeByGenre(genreSlug, options = {}) {
    const cleanGenre = extractSakunimeSlug(genreSlug, 'genre');
    const normalizedSlug = genreKey(cleanGenre);
    if (!normalizedSlug) {
      throw new ScraperError('Genre slug is required (e.g. "action", "fantasy").', 400);
    }

    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const server = normalizeServerFilter(options.server);
    const hiPrefix = server === 'hi' ? 'hi~' : 'hid~';

    const genreMap = await this._loadGenreIndex();
    const genreEntry = genreMap.get(normalizedSlug) || {
      slug: normalizedSlug,
      name: normalizedSlug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      servers: {
        hid: normalizedSlug,
        sm: normalizedSlug,
        otaku: normalizedSlug
      }
    };

    const tasks = [];
    if (server === 'all' || server === 'hid' || server === 'hi') {
      tasks.push(
        this._hiGet(`/genre/${encodeURIComponent(normalizedSlug)}?page=${page}`)
          .then((d) => ({
            items: (d.list || []).map((it) => this._normalizeHiCard(it, hiPrefix)).filter(Boolean),
            pagination: { currentPage: page, hasNextPage: Boolean(d.hasNext) }
          }))
          .catch(() => ({ items: [], pagination: null }))
      );
    }
    if ((server === 'all' || server === 'sm') && genreEntry.servers.sm) {
      tasks.push(
        this._smGet(`/genres/${encodeURIComponent(genreEntry.servers.sm)}?page=${page}`)
          .then((r) => ({
            items: (r?.data?.animeList || []).map((it) => this._normalizeSmCard(it)).filter(Boolean),
            pagination: r?.pagination || null
          }))
          .catch(() => ({ items: [], pagination: null }))
      );
    }
    if ((server === 'all' || server === 'otaku') && genreEntry.servers.otaku) {
      tasks.push(
        this._otakuGet(`/genre/${encodeURIComponent(genreEntry.servers.otaku)}?page=${page}`)
          .then((r) => ({
            items: (r?.data?.animeList || [])
              .map((it) => this._normalizeOtakuCard(it))
              .filter(Boolean),
            pagination: r?.pagination || null
          }))
          .catch(() => ({ items: [], pagination: null }))
      );
    }

    const results = await Promise.all(tasks);
    const data = [];
    const seen = new Set();
    for (const r of results) {
      for (const item of r.items) {
        if (!seen.has(item.slug)) {
          seen.add(item.slug);
          data.push(item);
        }
      }
    }

    return {
      genre: {
        slug: genreEntry.slug,
        title: genreEntry.name,
        url: `${this.baseUrl}/anime/genre/${genreEntry.slug}/1/`
      },
      serverFilter: server,
      pagination: this._mergePagination(
        page,
        results.map((r) => r.pagination),
        data.length > 0
      ),
      data
    };
  }

  /**
   * 13. Resolve MyAnimeList Numeric ID -> Sakunime Anime Slug
   * e.g. `52991` -> `hid~frieren-beyond-journeys-end-154587`
   */
  async resolveMalId(malId) {
    return this.malLinker.resolveMalId(malId);
  }

  /**
   * 14. Full Sakunime Anime Detail via MyAnimeList Numeric ID
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
        matchScore: resolved.matchScore,
        alternatives: resolved.alternatives
      },
      ...detail
    };
  }

  /**
   * 15. Full Anime Details by Sakunime Slug (`hid~...`, `hi~...`, `sm~...`, or Otakudesu slug) OR MyAnimeList Numeric ID
   */
  async getAnimeDetail(idOrSlug) {
    if (isNumericMalId(idOrSlug)) {
      return this.getAnimeByMalId(idOrSlug);
    }
    return this._getAnimeDetailBySlug(idOrSlug);
  }

  async getAnimeById(idOrSlug) {
    return this.getAnimeDetail(idOrSlug);
  }

  async _getAnimeDetailBySlug(rawInput) {
    const parsed = parseAnimeSlug(rawInput);
    if (!parsed || !parsed.rawId) {
      throw new ScraperError(
        'Anime slug is required (e.g. "hid~frieren-beyond-journeys-end-154587", "sm~one-piece", or MAL ID "52991").',
        400
      );
    }

    if (parsed.server === 'hid' || parsed.server === 'hi') {
      return this._fetchHiAnimeDetail(parsed);
    }

    if (parsed.server === 'sm') {
      return this._fetchSmAnimeDetail(parsed);
    }

    // Unprefixed slug: if it looks like a bare Server 1 slug (`title-154587` without `-sub-indo`), try Server 1 if Otakudesu fails (or first if trailing AniList ID)
    const looksLikeBareHiSlug = /-\d{2,8}$/.test(parsed.rawId) && !/-sub-indo$/i.test(parsed.rawId);
    if (looksLikeBareHiSlug) {
      try {
        return await this._fetchHiAnimeDetail(parseAnimeSlug(`hid~${parsed.rawId}`));
      } catch {
        // Continue to Otakudesu / Server 2 fallbacks
      }
    }

    try {
      return await this._fetchOtakuAnimeDetail(parsed);
    } catch (otakuErr) {
      // Fallback: check if user passed a bare Server 1 or Server 2 slug without prefix
      try {
        return await this._fetchHiAnimeDetail(parseAnimeSlug(`hid~${parsed.rawId}`));
      } catch {
        try {
          return await this._fetchSmAnimeDetail(parseAnimeSlug(`sm~${parsed.rawId}`));
        } catch {
          throw otakuErr;
        }
      }
    }
  }

  async _fetchHiAnimeDetail(parsed) {
    if (!HI_SLUG_RE.test(parsed.rawId)) {
      throw new ScraperError(`Invalid Sakunime Server 1 slug "${parsed.slug}".`, 400);
    }

    const d = await this._hiGet(`/info/${encodeURIComponent(parsed.rawId)}`);
    if (!d || (!d.title && !d.jtitle && !Array.isArray(d.episodes))) {
      throw new ScraperError(`Anime "${parsed.slug}" not found on Sakunime.`, 404);
    }

    const romajiTitle = String(d.jtitle || '').trim();
    const englishTitle = String(d.title || '').trim();
    const title = romajiTitle || englishTitle || parsed.rawId;

    const altSet = new Set();
    if (englishTitle && englishTitle !== title) altSet.add(englishTitle);
    if (romajiTitle && romajiTitle !== title) altSet.add(romajiTitle);
    for (const part of String(d.alt || '').split(/\s*;\s*/)) {
      const trimmed = part.trim();
      if (trimmed && trimmed !== title) altSet.add(trimmed);
    }

    const rawEpisodes = Array.isArray(d.episodes) ? d.episodes : [];
    const episodeList = rawEpisodes
      .slice()
      .sort((a, b) => (b.n || 0) - (a.n || 0))
      .map((ep) => {
        const epSlug = `${parsed.prefix}${parsed.rawId}~${ep.ep}~${ep.n}`;
        return {
          episodeId: String(ep.ep),
          number: ep.n,
          slug: epSlug,
          title: ep.title ? `Episode ${ep.n}: ${ep.title}` : `Episode ${ep.n}`,
          episodeTitle: ep.title || null,
          isFiller: Boolean(ep.filler),
          url: `${this.baseUrl}/watch/${epSlug}`
        };
      });

    const genres = Array.isArray(d.genres)
      ? d.genres.map((g) => ({
          slug: genreKey(g),
          name: String(g),
          url: `${this.baseUrl}/anime/genre/${genreKey(g)}/1/`
        }))
      : [];

    const studios = d.studios
      ? String(d.studios)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && s !== '-')
          .map((name) => ({ slug: genreKey(name), name }))
      : [];

    return {
      slug: parsed.slug,
      rawId: parsed.rawId,
      server: parsed.server,
      serverLabel: parsed.serverLabel,
      anilistId: parsed.anilistId,
      url: `${this.baseUrl}/anime/${parsed.slug}`,
      title,
      englishTitle: englishTitle || null,
      japaneseTitle: romajiTitle || null,
      alternativeTitles: Array.from(altSet),
      images: buildImageSet(d.poster, d.banner || null, this.baseUrl),
      type: d.type || null,
      status: normalizeStatusLabel(d.status),
      aired: d.aired || null,
      premiered: d.premiered || null,
      year: extractYear(d.premiered) || extractYear(d.aired),
      episodes: episodeList.length || parseNumber(d.sub) || null,
      subEpisodes: parseNumber(d.sub),
      dubEpisodes: parseNumber(d.dub),
      duration: d.duration || null,
      subtitle: parsed.server === 'hi' ? 'Sub Eng / Sub Indo (AI) / Dub Eng' : 'Sub Indo (AI) / Sub Eng / Dub Eng',
      score: parseNumber(d.score, true),
      synopsis: String(d.synopsis || '').trim() || null,
      studios,
      producers: [],
      genres,
      episodeCount: episodeList.length,
      episodeList,
      recommendations: []
    };
  }

  async _fetchSmAnimeDetail(parsed) {
    const res = await this._smGet(`/anime/${encodeURIComponent(parsed.rawId)}`);
    const d = res?.data;
    if (!d || (!d.title && !d.japanese && !Array.isArray(d.episodeList))) {
      throw new ScraperError(`Anime "${parsed.slug}" not found on Sakunime Server 2.`, 404);
    }

    const title = cleanAnimeTitle(d.title || d.english || d.japanese || parsed.rawId);
    const altSet = new Set();
    for (const candidate of [d.english, d.japanese, d.synonyms]) {
      if (candidate) {
        for (const p of String(candidate).split(/\s*[,;]\s*/)) {
          const t = p.trim();
          if (t && t !== title) altSet.add(t);
        }
      }
    }

    const rawScore = d.score && typeof d.score === 'object' ? d.score.value : d.score;
    const synopsisParagraphs = Array.isArray(d.synopsis?.paragraphs) ? d.synopsis.paragraphs : [];

    const episodeList = (Array.isArray(d.episodeList) ? d.episodeList : [])
      .filter((e) => e && e.episodeId)
      .map((e) => {
        const epSlug = `sm~${e.episodeId}`;
        const epNum = extractEpisodeNumber(e.title, e.episodeId);
        const epTitle = /^\d+(?:\.\d+)?$/.test(String(e.title || ''))
          ? `Episode ${e.title}`
          : String(e.title || 'Episode');
        return {
          episodeId: e.episodeId,
          number: epNum,
          slug: epSlug,
          title: epTitle,
          isFiller: false,
          url: `${this.baseUrl}/watch/${epSlug}`
        };
      });

    const genres = (Array.isArray(d.genreList) ? d.genreList : [])
      .filter((g) => g && (g.title || g.genreId))
      .map((g) => {
        const gSlug = genreKey(g.genreId || g.title);
        return {
          slug: gSlug,
          name: g.title || g.genreId,
          url: `${this.baseUrl}/anime/genre/${gSlug}/1/`
        };
      });

    const studios = d.studios
      ? String(d.studios)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && s !== '-')
          .map((name) => ({ slug: genreKey(name), name }))
      : [];

    const producers = d.producers
      ? String(d.producers)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && s !== '-')
          .map((name) => ({ slug: genreKey(name), name }))
      : [];

    return {
      slug: parsed.slug,
      rawId: parsed.rawId,
      server: 'sm',
      serverLabel: SERVER_LABELS.sm,
      anilistId: null,
      url: `${this.baseUrl}/anime/${parsed.slug}`,
      title,
      englishTitle: d.english || null,
      japaneseTitle: d.japanese || null,
      alternativeTitles: Array.from(altSet),
      images: buildImageSet(d.poster, null, this.baseUrl),
      type: d.type || null,
      status: normalizeStatusLabel(d.status),
      aired: d.aired || null,
      premiered: d.season || null,
      year: extractYear(d.season) || extractYear(d.aired),
      episodes: parseNumber(d.episodes) || episodeList.length || null,
      subEpisodes: episodeList.length || null,
      dubEpisodes: null,
      duration: d.duration || null,
      subtitle: 'Subtitle Indonesia',
      score: parseNumber(rawScore, true),
      synopsis: synopsisParagraphs.join('\n\n').trim() || null,
      studios,
      producers,
      genres,
      episodeCount: episodeList.length,
      episodeList,
      recommendations: []
    };
  }

  async _fetchOtakuAnimeDetail(parsed) {
    const res = await this._otakuGet(`/anime/${encodeURIComponent(parsed.rawId)}`);
    const d = res?.data?.details || res?.data;
    if (!d || (!d.title && !Array.isArray(d.episodeList))) {
      throw new ScraperError(`Anime "${parsed.slug}" not found on Sakunime.`, 404);
    }

    const title = cleanAnimeTitle(d.title || parsed.rawId);
    const altSet = new Set();
    if (d.japanese && d.japanese !== title) altSet.add(String(d.japanese).trim());

    const synopsisParagraphs = Array.isArray(d.synopsis?.paragraphList)
      ? d.synopsis.paragraphList
      : Array.isArray(d.synopsis?.paragraphs)
        ? d.synopsis.paragraphs
        : [];

    const episodeList = (Array.isArray(d.episodeList) ? d.episodeList : [])
      .filter((e) => e && e.episodeId)
      .map((e) => {
        const epSlug = String(e.episodeId).trim();
        return {
          episodeId: epSlug,
          number: extractEpisodeNumber(e.title, epSlug),
          slug: epSlug,
          title: cleanAnimeTitle(e.title) || epSlug,
          releasedAt: e.date || e.releaseDate || null,
          isFiller: false,
          url: `${this.baseUrl}/watch/${epSlug}`
        };
      });

    const genres = (Array.isArray(d.genreList) ? d.genreList : [])
      .filter((g) => g && (g.title || g.genreId))
      .map((g) => {
        const gSlug = genreKey(g.genreId || g.title);
        return {
          slug: gSlug,
          name: g.title || g.genreId,
          url: `${this.baseUrl}/anime/genre/${gSlug}/1/`
        };
      });

    const studios = d.studios
      ? String(d.studios)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && s !== '-')
          .map((name) => ({ slug: genreKey(name), name }))
      : [];

    const producers = d.producers
      ? String(d.producers)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && s !== '-')
          .map((name) => ({ slug: genreKey(name), name }))
      : [];

    const recommendations = (Array.isArray(d.recommendedAnimeList) ? d.recommendedAnimeList : [])
      .map((rec) => this._normalizeOtakuCard(rec))
      .filter(Boolean);

    return {
      slug: parsed.slug,
      rawId: parsed.rawId,
      server: 'otaku',
      serverLabel: SERVER_LABELS.otaku,
      anilistId: null,
      url: `${this.baseUrl}/anime/${parsed.slug}`,
      title,
      englishTitle: null,
      japaneseTitle: d.japanese || null,
      alternativeTitles: Array.from(altSet),
      images: buildImageSet(d.poster, null, this.baseUrl),
      type: d.type || null,
      status: normalizeStatusLabel(d.status),
      aired: d.aired || null,
      premiered: null,
      year: extractYear(d.aired),
      episodes: parseNumber(d.episodes) || episodeList.length || null,
      subEpisodes: episodeList.length || null,
      dubEpisodes: null,
      duration: d.duration || null,
      subtitle: 'Subtitle Indonesia',
      score: parseNumber(d.score, true),
      synopsis: synopsisParagraphs.join('\n\n').trim() || null,
      studios,
      producers,
      genres,
      episodeCount: episodeList.length,
      episodeList,
      recommendations
    };
  }

  /**
   * 16. Anime Episodes List (Paginated & Sortable)
   */
  async getAnimeEpisodes(idOrSlug, options = {}) {
    const detail = await this.getAnimeDetail(idOrSlug);
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(options.limit, 10) || 100));
    const order = String(options.order || 'desc').toLowerCase();

    const sorted = [...detail.episodeList].sort((a, b) =>
      order === 'asc' ? (a.number || 0) - (b.number || 0) : (b.number || 0) - (a.number || 0)
    );

    const startIdx = (page - 1) * limit;
    const paginated = sorted.slice(startIdx, startIdx + limit);

    return {
      ...(detail.malId
        ? {
            malId: detail.malId,
            malUrl: detail.malUrl,
            linkedMal: detail.linkedMal
          }
        : {}),
      slug: detail.slug,
      server: detail.server,
      title: detail.title,
      totalEpisodes: sorted.length,
      pagination: {
        currentPage: page,
        perPage: limit,
        totalPages: Math.ceil(sorted.length / limit) || 1,
        hasNextPage: startIdx + limit < sorted.length,
        hasPrevPage: page > 1
      },
      data: paginated
    };
  }

  /**
   * 17. Anime Recommendations by Slug or MAL ID
   */
  async getAnimeRecommendations(idOrSlug) {
    const detail = await this.getAnimeDetail(idOrSlug);
    let recommendations = detail.recommendations || [];

    // If upstream detail didn't attach recommendations (e.g. Server 1 / Server 2), suggest top anime from primary genre
    if (!recommendations.length && detail.genres.length > 0) {
      try {
        const genreRes = await this.getAnimeByGenre(detail.genres[0].slug, {
          page: 1,
          server: detail.server
        });
        recommendations = (genreRes.data || [])
          .filter((item) => item.slug !== detail.slug)
          .slice(0, 12);
      } catch {
        recommendations = [];
      }
    }

    return {
      ...(detail.malId
        ? {
            malId: detail.malId,
            malUrl: detail.malUrl,
            linkedMal: detail.linkedMal
          }
        : {}),
      slug: detail.slug,
      server: detail.server,
      title: detail.title,
      total: recommendations.length,
      data: recommendations
    };
  }

  /**
   * 18. Get Episode Streaming & Downloads via Anime Slug OR MAL ID + Episode Number
   */
  async getAnimeEpisode(idOrSlug, episodeNumber, options = {}) {
    const epNum = parseFloat(episodeNumber);
    if (Number.isNaN(epNum) || epNum <= 0) {
      throw new ScraperError('Episode number must be a positive number (e.g. 1, 28).', 400);
    }

    const animeDetail = await this.getAnimeDetail(idOrSlug);
    let targetEp = animeDetail.episodeList.find((ep) => ep.number === epNum);

    if (!targetEp && epNum === 1 && animeDetail.episodeList.length === 1) {
      targetEp = animeDetail.episodeList[0];
    }

    if (!targetEp) {
      const idLabel = animeDetail.malId
        ? `MAL ID: ${animeDetail.malId}, Sakunime: ${animeDetail.slug}`
        : `Sakunime: ${animeDetail.slug}`;
      throw new ScraperError(
        `Episode ${episodeNumber} not found for anime "${animeDetail.title}" (${idLabel}).`,
        404
      );
    }

    const epDetail = await this.getEpisodeDetail(targetEp.slug, options);
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
   */
  async getEpisodeByMalId(malId, episodeNumber, options = {}) {
    if (!isNumericMalId(malId)) {
      throw new ScraperError('MyAnimeList ID must be a positive integer (e.g. 52991).', 400);
    }
    return this.getAnimeEpisode(malId, episodeNumber, options);
  }

  /**
   * 19. Episode Detail, HLS/Embed Video Mirrors, Subtitle Tracks & Downloads (`/watch/:episodeSlug`)
   * Supports:
   * - Server 1: `hid~frieren-beyond-journeys-end-154587~1~1` (or `hi~...`)
   * - Server 2: `sm~zombie-sagashitemasu-episode-4`
   * - Server 3: `shuiro-kamen-episode-4-sub-indo`
   */
  async getEpisodeDetail(rawEpisodeSlug, options = {}) {
    const cleanSlug = extractSakunimeSlug(rawEpisodeSlug, 'watch');
    if (!cleanSlug || cleanSlug === 'anime' || cleanSlug === 'watch') {
      throw new ScraperError(
        'Episode slug is required (e.g. "hid~frieren-beyond-journeys-end-154587~1~1").',
        400
      );
    }

    if (cleanSlug.startsWith('hid~') || cleanSlug.startsWith('hi~')) {
      return this._fetchHiEpisodeDetail(cleanSlug, options);
    }

    if (cleanSlug.startsWith('sm~')) {
      return this._fetchSmEpisodeDetail(cleanSlug);
    }

    // If unprefixed slug uses `~` episode separator, treat as `hid~`
    if (cleanSlug.includes('~')) {
      return this._fetchHiEpisodeDetail(`hid~${cleanSlug}`, options);
    }

    return this._fetchOtakuEpisodeDetail(cleanSlug);
  }

  async _fetchHiEpisodeDetail(episodeSlug, options = {}) {
    const prefix = episodeSlug.startsWith('hi~') ? 'hi~' : 'hid~';
    const serverKey = prefix === 'hi~' ? 'hi' : 'hid';
    const parts = episodeSlug.slice(prefix.length).split('~');
    const rawAnimeSlug = parts[0];
    const epParam = parts[1];
    let epNum = parts[2] ? parseInt(parts[2], 10) : parseInt(epParam, 10) || 1;

    if (!HI_SLUG_RE.test(rawAnimeSlug || '') || !/^\d{1,9}$/.test(epParam || '')) {
      throw new ScraperError(
        `Invalid Sakunime Server 1 episode slug "${episodeSlug}". Expected format: "hid~{anime-slug}~{ep}~{number}".`,
        400
      );
    }

    const audioPref = String(options.type || 'sub').toLowerCase() === 'dub' ? 'dub' : 'sub';

    const [animeDetail, serversData, downloadData] = await Promise.all([
      this._fetchHiAnimeDetail(parseAnimeSlug(`${prefix}${rawAnimeSlug}`)).catch(() => null),
      this._hiGet(`/servers/${encodeURIComponent(rawAnimeSlug)}?ep=${encodeURIComponent(epParam)}`),
      this._hiGet(
        `/download/${encodeURIComponent(rawAnimeSlug)}?ep=${encodeURIComponent(epParam)}`,
        { timeout: 7000 }
      ).catch(() => null)
    ]);

    const serverListRaw = Array.isArray(serversData?.list) ? serversData.list : [];
    if (!serverListRaw.length) {
      throw new ScraperError(`No streaming servers available for episode "${episodeSlug}".`, 404);
    }

    if (animeDetail) {
      const matchedEp = animeDetail.episodeList.find((e) => String(e.episodeId) === String(epParam));
      if (matchedEp && matchedEp.number) epNum = matchedEp.number;
    }

    const canonicalEpisodeSlug = `${prefix}${rawAnimeSlug}~${epParam}~${epNum}`;

    const isVhd = (s) => /^vhd-?\d/i.test(String(s.name || s.id || ''));
    const buildServerEntry = (s) => ({
      server: s.name || s.id,
      upstreamId: s.id,
      audioType: s.type || 'sub',
      playerKind: isVhd(s) ? 'embed' : 'hls',
      serverId: `hie~${rawAnimeSlug}~${epParam}~${s.id}~${s.type || 'sub'}`
    });

    const allServers = serverListRaw.map(buildServerEntry);
    const preferredPool = allServers.filter((s) => s.audioType === audioPref);
    const activePool = preferredPool.length ? preferredPool : allServers;

    const primaryHd = activePool.find((s) => s.playerKind === 'hls') || null;
    const primaryEmbed =
      activePool.find((s) => /^vhd-?2$/i.test(s.upstreamId)) ||
      activePool.find((s) => s.playerKind === 'embed') ||
      null;

    // Pre-resolve primary HLS stream (with Indonesian AI + multi-lang subtitles) & primary iframe embed
    const [resolvedHd, resolvedEmbed] = await Promise.all([
      primaryHd ? this.getServerUrl(primaryHd.serverId).catch(() => null) : Promise.resolve(null),
      primaryEmbed
        ? this.getServerUrl(primaryEmbed.serverId).catch(() => null)
        : Promise.resolve(null)
    ]);

    const subtitles = resolvedHd?.subtitles || [];
    const defaultStreamUrl =
      resolvedHd?.embedUrl || resolvedEmbed?.url || resolvedHd?.hlsUrl || null;

    const mirrors = [];
    if (resolvedHd) {
      mirrors.push({
        server: `${primaryHd.server} (${primaryHd.audioType.toUpperCase()})`,
        serverId: primaryHd.serverId,
        kind: resolvedHd.kind,
        url: resolvedHd.url,
        embedUrl: resolvedHd.embedUrl,
        hlsUrl: resolvedHd.hlsUrl,
        hlsProxyUrls: resolvedHd.hlsProxyUrls,
        qualityLevels: resolvedHd.qualityLevels
      });
    }
    if (resolvedEmbed) {
      mirrors.push({
        server: `${primaryEmbed.server} (${primaryEmbed.audioType.toUpperCase()})`,
        serverId: primaryEmbed.serverId,
        kind: resolvedEmbed.kind,
        url: resolvedEmbed.url,
        embedUrl: resolvedEmbed.embedUrl || resolvedEmbed.url
      });
    }

    const downloads = [];
    const dlRows = (Array.isArray(downloadData?.list) ? downloadData.list : []).filter(
      (x) => x && /^https?:\/\//i.test(x.url || '')
    );
    if (dlRows.length) {
      downloads.push({
        resolution: 'Multi / Direct',
        links: dlRows.map((x) => ({
          host: String(x.label || 'Download').trim(),
          url: x.url
        }))
      });
    }

    // Prev / Next navigation from anime episodeList (sorted descending by episode number)
    const epList = animeDetail?.episodeList || [];
    const currentIdx = epList.findIndex((e) => e.slug === canonicalEpisodeSlug || e.number === epNum);
    const prevEp = currentIdx !== -1 && epList[currentIdx + 1] ? epList[currentIdx + 1] : null;
    const nextEp = currentIdx > 0 && epList[currentIdx - 1] ? epList[currentIdx - 1] : null;

    return {
      slug: canonicalEpisodeSlug,
      episodeId: String(epParam),
      episodeNumber: epNum,
      server: serverKey,
      serverLabel: SERVER_LABELS[serverKey],
      url: `${this.baseUrl}/watch/${canonicalEpisodeSlug}`,
      title: animeDetail ? `${animeDetail.title} Episode ${epNum}` : `Episode ${epNum}`,
      thumbnail: animeDetail?.images?.banner || animeDetail?.images?.default || null,
      subtitle:
        serverKey === 'hid'
          ? 'Subtitle Indonesia (AI), English & Multi-Sub'
          : 'English, Subtitle Indonesia (AI) & Multi-Sub',
      defaultStreamUrl,
      hlsUrl: resolvedHd?.hlsUrl || null,
      hlsProxyUrls: resolvedHd?.hlsProxyUrls || [],
      subtitles,
      navigation: {
        prevEpisode: prevEp ? { slug: prevEp.slug, number: prevEp.number, url: prevEp.url } : null,
        animeSlug: `${prefix}${rawAnimeSlug}`,
        allEpisodesUrl: `${this.baseUrl}/anime/${prefix}${rawAnimeSlug}`,
        nextEpisode: nextEp ? { slug: nextEp.slug, number: nextEp.number, url: nextEp.url } : null
      },
      streaming: {
        audioPreference: audioPref,
        qualityLevels: resolvedHd?.qualityLevels || [],
        mirrors,
        servers: allServers
      },
      downloads,
      anime: animeDetail
        ? {
            slug: animeDetail.slug,
            title: animeDetail.title,
            englishTitle: animeDetail.englishTitle,
            url: animeDetail.url,
            images: animeDetail.images,
            type: animeDetail.type,
            status: animeDetail.status,
            score: animeDetail.score,
            genres: animeDetail.genres,
            synopsis: animeDetail.synopsis
          }
        : null,
      otherEpisodes: epList
    };
  }

  async _fetchSmEpisodeDetail(episodeSlug) {
    const rawEpId = episodeSlug.slice(3);
    const res = await this._smGet(`/episode/${encodeURIComponent(rawEpId)}`);
    const d = res?.data;
    if (!d || (!d.title && !d.defaultStreamingUrl && !d.server)) {
      throw new ScraperError(`Episode "${episodeSlug}" not found on Sakunime Server 2.`, 404);
    }

    const animeSlug = d.animeId ? `sm~${d.animeId}` : null;
    const animeDetail = d.animeId
      ? await this._fetchSmAnimeDetail(parseAnimeSlug(animeSlug)).catch(() => null)
      : null;

    const qualities = ((d.server && d.server.qualities) || [])
      .map((q) => ({
        quality: q.title && q.title !== 'unknown' ? q.title : 'Auto',
        servers: (q.serverList || [])
          .filter((s) => s && s.serverId)
          .map((s) => ({
            server: s.title || 'Server',
            serverId: `sms~${s.serverId}`
          }))
      }))
      .filter((q) => q.servers.length > 0);

    let defaultStreamUrl = d.defaultStreamingUrl || null;
    if (!defaultStreamUrl && qualities[0]?.servers[0]?.serverId) {
      const resolved = await this.getServerUrl(qualities[0].servers[0].serverId).catch(() => null);
      defaultStreamUrl = resolved?.url || null;
    }

    const downloads = [];
    for (const fmt of d.downloadUrl?.formats || []) {
      const formatTitle = String(fmt?.title || '')
        .split('[')[0]
        .trim();
      for (const q of fmt?.qualities || []) {
        const links = (q?.urls || [])
          .filter((u) => u && /^https?:\/\//i.test(u.url || ''))
          .map((u) => ({
            host: String(u.title || 'Download').trim(),
            url: u.url
          }));
        if (links.length) {
          downloads.push({
            resolution: [q.title, formatTitle].filter(Boolean).join(' · ') || 'Download',
            links
          });
        }
      }
    }

    const epNum = extractEpisodeNumber(d.title, rawEpId);
    const prevSlug =
      d.hasPrevEpisode && d.prevEpisode?.episodeId ? `sm~${d.prevEpisode.episodeId}` : null;
    const nextSlug =
      d.hasNextEpisode && d.nextEpisode?.episodeId ? `sm~${d.nextEpisode.episodeId}` : null;

    return {
      slug: `sm~${rawEpId}`,
      episodeId: rawEpId,
      episodeNumber: epNum,
      server: 'sm',
      serverLabel: SERVER_LABELS.sm,
      url: `${this.baseUrl}/watch/sm~${rawEpId}`,
      title: cleanAnimeTitle(d.title) || `Episode ${epNum || ''}`.trim(),
      thumbnail: toAbsoluteUrl(d.poster, this.baseUrl) || animeDetail?.images?.default || null,
      releasedAt: translateAgoId(d.releasedOn),
      subtitle: 'Subtitle Indonesia',
      defaultStreamUrl,
      hlsUrl: null,
      hlsProxyUrls: [],
      subtitles: [],
      navigation: {
        prevEpisode: prevSlug ? { slug: prevSlug, url: `${this.baseUrl}/watch/${prevSlug}` } : null,
        animeSlug,
        allEpisodesUrl: animeSlug ? `${this.baseUrl}/anime/${animeSlug}` : null,
        nextEpisode: nextSlug ? { slug: nextSlug, url: `${this.baseUrl}/watch/${nextSlug}` } : null
      },
      streaming: {
        mirrors: defaultStreamUrl
          ? [{ server: 'Default Player', kind: 'embed', url: defaultStreamUrl }]
          : [],
        qualities
      },
      downloads,
      anime: animeDetail
        ? {
            slug: animeDetail.slug,
            title: animeDetail.title,
            url: animeDetail.url,
            images: animeDetail.images,
            type: animeDetail.type,
            status: animeDetail.status,
            score: animeDetail.score,
            genres: animeDetail.genres,
            synopsis: animeDetail.synopsis
          }
        : null,
      otherEpisodes: animeDetail?.episodeList || []
    };
  }

  async _fetchOtakuEpisodeDetail(episodeSlug) {
    const res = await this._otakuGet(`/episode/${encodeURIComponent(episodeSlug)}`);
    const d = res?.data?.details || res?.data;
    if (!d || (!d.title && !d.defaultStreamingUrl && !d.server)) {
      throw new ScraperError(`Episode "${episodeSlug}" not found on Sakunime.`, 404);
    }

    const animeSlug = d.animeId || d.info?.animeId || null;
    const qualities = ((d.server && (d.server.qualityList || d.server.qualities)) || [])
      .map((q) => ({
        quality: q.title || 'Auto',
        servers: (q.serverList || [])
          .filter((s) => s && s.serverId)
          .map((s) => ({
            server: s.title || 'Server',
            serverId: s.serverId
          }))
      }))
      .filter((q) => q.servers.length > 0);

    let defaultStreamUrl = d.defaultStreamingUrl || null;
    if (!defaultStreamUrl && qualities[0]?.servers[0]?.serverId) {
      const resolved = await this.getServerUrl(qualities[0].servers[0].serverId).catch(() => null);
      defaultStreamUrl = resolved?.url || null;
    }

    const downloads = [];
    for (const q of d.download?.qualityList || []) {
      const links = (q.urlList || [])
        .filter((u) => u && /^https?:\/\//i.test(u.url || ''))
        .map((u) => ({
          host: String(u.title || 'Download').trim(),
          url: u.url
        }));
      if (links.length) {
        downloads.push({
          resolution: q.size ? `${q.title} (${q.size})` : q.title || 'Download',
          links
        });
      }
    }

    const epNum = extractEpisodeNumber(d.title, episodeSlug);
    const prevSlug =
      d.hasPrevEpisode && d.prevEpisode?.episodeId ? d.prevEpisode.episodeId : null;
    const nextSlug =
      d.hasNextEpisode && d.nextEpisode?.episodeId ? d.nextEpisode.episodeId : null;

    return {
      slug: episodeSlug,
      episodeId: episodeSlug,
      episodeNumber: epNum,
      server: 'otaku',
      serverLabel: SERVER_LABELS.otaku,
      url: `${this.baseUrl}/watch/${episodeSlug}`,
      title: cleanAnimeTitle(d.title) || episodeSlug,
      thumbnail: null,
      releasedAt: d.releaseTime || null,
      subtitle: 'Subtitle Indonesia',
      defaultStreamUrl,
      hlsUrl: null,
      hlsProxyUrls: [],
      subtitles: [],
      navigation: {
        prevEpisode: prevSlug ? { slug: prevSlug, url: `${this.baseUrl}/watch/${prevSlug}` } : null,
        animeSlug,
        allEpisodesUrl: animeSlug ? `${this.baseUrl}/anime/${animeSlug}` : null,
        nextEpisode: nextSlug ? { slug: nextSlug, url: `${this.baseUrl}/watch/${nextSlug}` } : null
      },
      streaming: {
        mirrors: defaultStreamUrl
          ? [{ server: 'Default Player', kind: 'embed', url: defaultStreamUrl }]
          : [],
        qualities
      },
      downloads,
      anime: animeSlug
        ? {
            slug: animeSlug,
            url: `${this.baseUrl}/anime/${animeSlug}`
          }
        : null,
      otherEpisodes: d.info?.episodeList
        ? d.info.episodeList.map((e) => ({
            episodeId: e.episodeId,
            number: extractEpisodeNumber(e.title, e.episodeId),
            slug: e.episodeId,
            title: cleanAnimeTitle(e.title),
            url: `${this.baseUrl}/watch/${e.episodeId}`
          }))
        : []
    };
  }

  /**
   * 20. Resolve Individual Streaming Server ID -> Direct HLS / Embed Player URL
   * Supports:
   * - `hie~{slug}~{ep}~{server}~{sub|dub}` (Server 1)
   * - `sms~{serverId}` (Server 2)
   * - `{otakudesuServerId}` (Server 3)
   */
  async getServerUrl(rawServerId) {
    const serverId = String(rawServerId || '').trim();
    if (!serverId) {
      throw new ScraperError('Streaming serverId is required.', 400);
    }

    if (serverId.startsWith('hie~')) {
      const parts = serverId.slice(4).split('~');
      const [slug, ep, srv, type = 'sub'] = parts;
      if (!HI_SLUG_RE.test(slug || '') || !/^\d{1,9}$/.test(ep || '') || !srv) {
        throw new ScraperError(`Invalid Server 1 serverId "${serverId}".`, 400);
      }

      // Short cache (60s) because HLS signed stream tokens expire
      const s = await this._hiGet(
        `/stream/${encodeURIComponent(slug)}?ep=${encodeURIComponent(ep)}&server=${encodeURIComponent(srv)}&type=${encodeURIComponent(type)}`,
        { ttl: 60 * 1000, timeout: 25000 }
      );

      if (!s || !s.url) {
        throw new ScraperError(`No playable stream returned for server "${serverId}".`, 404);
      }

      const rawTracks = Array.isArray(s.tracks) ? s.tracks : [];
      const subtitles = rawTracks
        .filter((t) => t && t.file)
        .map((t) => ({
          label: t.label || t.lang || 'Subtitle',
          lang: t.lang || null,
          kind: t.kind || 'captions',
          isAiTranslated: Boolean(t.ai),
          url: toAbsoluteUrl(t.file, this.baseUrl)
        }))
        .sort((a, b) => {
          // Prioritize Indonesian & English captions at top
          const rank = (x) =>
            x.kind === 'thumbnails'
              ? 9
              : /indonesia/i.test(x.label) || x.lang === 'id'
                ? 0
                : /english/i.test(x.label)
                  ? 1
                  : 2;
          return rank(a) - rank(b);
        });

      const isVideo = s.kind === 'video';
      return {
        serverId,
        server: 'hid',
        kind: isVideo ? 'video' : 'embed',
        url: toAbsoluteUrl(s.url, this.baseUrl),
        embedUrl: s.embed ? toAbsoluteUrl(s.embed, this.baseUrl) : !isVideo ? toAbsoluteUrl(s.url, this.baseUrl) : null,
        hlsUrl: isVideo ? toAbsoluteUrl(s.url, this.baseUrl) : null,
        hlsProxyUrls: Array.isArray(s.alts)
          ? s.alts.map((a) => toAbsoluteUrl(a, this.baseUrl)).filter(Boolean)
          : [],
        qualityLevels: Array.isArray(s.levels)
          ? s.levels.map((lv) => ({
              label: lv.label || `${lv.height || ''}p`,
              height: lv.height || null,
              url: toAbsoluteUrl(lv.url, this.baseUrl),
              proxyUrls: Array.isArray(lv.alts)
                ? lv.alts.map((a) => toAbsoluteUrl(a, this.baseUrl)).filter(Boolean)
                : []
            }))
          : [],
        subtitles
      };
    }

    if (serverId.startsWith('sms~')) {
      const rawId = serverId.slice(4);
      const res = await this._smGet(`/server/${encodeURIComponent(rawId)}`, { ttl: 60 * 1000 });
      const url = res?.data?.url || null;
      if (!url) {
        throw new ScraperError(`No playable URL returned for Server 2 "${serverId}".`, 404);
      }
      return {
        serverId,
        server: 'sm',
        kind: 'embed',
        url,
        embedUrl: url,
        hlsUrl: null,
        hlsProxyUrls: [],
        qualityLevels: [],
        subtitles: []
      };
    }

    const res = await this._otakuGet(`/server/${encodeURIComponent(serverId)}`, { ttl: 60 * 1000 });
    const url = res?.data?.details?.url || res?.data?.url || null;
    if (!url) {
      throw new ScraperError(`No playable URL returned for Server 3 "${serverId}".`, 404);
    }

    return {
      serverId,
      server: 'otaku',
      kind: 'embed',
      url,
      embedUrl: url,
      hlsUrl: null,
      hlsProxyUrls: [],
      qualityLevels: [],
      subtitles: []
    };
  }
}

module.exports = {
  Sakunime,
  extractSakunimeSlug,
  parseAnimeSlug
};

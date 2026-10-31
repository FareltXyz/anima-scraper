const cheerio = require('cheerio');

const BASE_URL = 'https://myanimelist.net';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

const VALID_TOP_TYPES = new Set([
  'all',
  'airing',
  'upcoming',
  'tv',
  'movie',
  'ova',
  'ona',
  'special',
  'bypopularity',
  'favorite'
]);

const VALID_SEASONS = new Set(['winter', 'spring', 'summer', 'fall']);

class ScraperError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'ScraperError';
    this.status = status;
  }
}

/**
 * Extract numeric MyAnimeList ID from a URL path
 * e.g. https://myanimelist.net/anime/52991/Sousou_no_Frieren -> 52991
 */
function extractId(url, prefix = 'anime') {
  if (!url) return null;
  const regex = new RegExp(`/${prefix}/(\\d+)`);
  const match = url.match(regex);
  return match ? Number(match[1]) : null;
}

/**
 * Normalize relative MAL URLs to absolute URLs
 */
function toAbsoluteUrl(href) {
  if (!href) return null;
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  return `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
}

/**
 * Upgrade MyAnimeList thumbnail URLs (/r/50x70/images/...) to full resolution URLs
 */
function parseImages(rawUrl) {
  if (!rawUrl || rawUrl.includes('spacer.gif') || rawUrl.includes('questionmark')) {
    return {
      small: rawUrl || null,
      default: rawUrl || null,
      large: rawUrl || null
    };
  }

  const withoutQuery = rawUrl.split('?')[0];
  const fullUrl = withoutQuery.replace(/\/r\/\d+x\d+/, '');
  const largeUrl = fullUrl.replace(/(\.(?:jpg|jpeg|png|webp))$/i, 'l$1');

  return {
    small: rawUrl,
    default: fullUrl,
    large: largeUrl
  };
}

/**
 * Parse numbers safely from formatted strings like "1,538,089" or "8.64" or "N/A"
 */
function parseNumber(text, isFloat = false) {
  if (!text) return null;
  const cleaned = String(text).replace(/,/g, '').trim();
  if (!cleaned || cleaned === 'N/A' || cleaned === '-' || cleaned === '?') return null;
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const num = isFloat ? parseFloat(match[0]) : parseInt(match[0], 10);
  return Number.isNaN(num) ? null : num;
}

class MyAnimeList {
  constructor(options = {}) {
    this.baseUrl = BASE_URL;
    this.cacheTTL = options.cacheTTL ?? 5 * 60 * 1000; // Default 5 menit cache
    this.cache = new Map();
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

    const response = await fetch(url, { headers: DEFAULT_HEADERS });

    if (response.status === 404) {
      throw new ScraperError(`Resource tidak ditemukan di MyAnimeList (${url})`, 404);
    }
    if (response.status === 429 || response.status === 405) {
      throw new ScraperError('Terlalu banyak request ke MyAnimeList (rate limited). Coba lagi beberapa saat.', 429);
    }
    if (!response.ok) {
      throw new ScraperError(`Gagal mengambil halaman MyAnimeList (HTTP ${response.status})`, 502);
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
    const response = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
      throw new ScraperError(`Gagal mengambil data JSON MyAnimeList (HTTP ${response.status})`, 502);
    }
    return response.json();
  }

  /**
   * Shared parser for `.seasonal-anime` cards (used in Season, Schedule, Genre, Producer pages)
   */
  _parseSeasonalCard($, el) {
    const card = $(el);
    const titleAnchor = card.find('.h2_anime_title a.link-title').first();
    const url = toAbsoluteUrl(titleAnchor.attr('href'));
    const id = extractId(url, 'anime') || parseNumber(card.find('.genres.js-genre').attr('id'));
    const title = titleAnchor.text().trim() || card.find('.js-title').text().trim();
    const englishTitle = card.find('.h3_anime_subtitle').text().trim() || null;

    const imgEl = card.find('.image img').first();
    const rawImg = imgEl.attr('data-src') || imgEl.attr('src');
    const images = parseImages(rawImg);

    const score =
      parseNumber(card.find('.js-score').text(), true) ??
      parseNumber(card.find('.scormem-item.score').text(), true);
    const members =
      parseNumber(card.find('.js-members').text()) ??
      parseNumber(card.find('.scormem-item.member').text());

    const infoItems = card.find('.prodsrc .info .item');
    const startDate = infoItems.eq(0).text().trim() || null;
    const epDurationRaw = infoItems.eq(1).text().replace(/\s+/g, ' ').trim();
    let episodes = null;
    let duration = null;
    if (epDurationRaw) {
      const parts = epDurationRaw.split(',').map((s) => s.trim());
      if (parts[0]) episodes = parseNumber(parts[0]);
      if (parts[1]) duration = parts[1];
    }

    const synopsis = card.find('.synopsis p.preline').text().trim() || null;

    const genres = [];
    card.find('.genres-inner .genre a').each((_, gEl) => {
      const gHref = toAbsoluteUrl($(gEl).attr('href'));
      genres.push({
        id: extractId(gHref, 'genre'),
        name: $(gEl).text().trim(),
        url: gHref
      });
    });

    const studios = [];
    const themes = [];
    const demographics = [];
    let source = null;

    card.find('.properties .property').each((_, propEl) => {
      const caption = $(propEl).find('.caption').text().trim().toLowerCase();
      if (caption.includes('studio')) {
        $(propEl)
          .find('.item a')
          .each((__, aEl) => {
            const href = toAbsoluteUrl($(aEl).attr('href'));
            studios.push({
              id: extractId(href, 'producer'),
              name: $(aEl).text().trim(),
              url: href
            });
          });
      } else if (caption.includes('source')) {
        source = $(propEl).find('.item').text().trim() || null;
      } else if (caption.includes('theme')) {
        $(propEl)
          .find('.item a')
          .each((__, aEl) => {
            const href = toAbsoluteUrl($(aEl).attr('href'));
            themes.push({
              id: extractId(href, 'genre'),
              name: $(aEl).text().trim(),
              url: href
            });
          });
      } else if (caption.includes('demographic')) {
        $(propEl)
          .find('.item a')
          .each((__, aEl) => {
            const href = toAbsoluteUrl($(aEl).attr('href'));
            demographics.push({
              id: extractId(href, 'genre'),
              name: $(aEl).text().trim(),
              url: href
            });
          });
      }
    });

    const streaming = [];
    const rawBroadcast = card.find('.js-broadcast-button').attr('data-raw');
    if (rawBroadcast) {
      try {
        const parsed = JSON.parse(rawBroadcast);
        if (Array.isArray(parsed.data)) {
          for (const item of parsed.data) {
            if (item.platform?.name && item.url) {
              streaming.push({
                name: item.platform.name,
                url: item.url,
                available: Boolean(item.available)
              });
            }
          }
        }
      } catch {
        // Fallback jika JSON di atribut data-raw gagal diparse
      }
    }

    return {
      id,
      title,
      englishTitle,
      url,
      images,
      synopsis,
      score,
      members,
      startDate,
      episodes,
      duration,
      source,
      studios,
      genres,
      themes,
      demographics,
      streaming
    };
  }

  /**
   * 1. Search Anime
   */
  async search(query, options = {}) {
    const q = String(query || '').trim();
    if (!q) {
      throw new ScraperError('Parameter query pencarian (q) wajib diisi.', 400);
    }

    const page = Math.max(1, parseInt(options.page, 10) || 1);

    // MyAnimeList HTML search membutuhkan minimal 3 karakter; gunakan prefix JSON untuk query pendek
    if (q.length < 3) {
      const prefixUrl = `${this.baseUrl}/search/prefix.json?type=anime&keyword=${encodeURIComponent(q)}&v=1`;
      const json = await this._fetchJson(prefixUrl);
      const items = json?.categories?.[0]?.items || [];
      const data = items.map((item) => ({
        id: item.id,
        title: item.name,
        url: item.url,
        images: parseImages(item.image_url),
        synopsis: null,
        type: item.payload?.media_type || null,
        episodes: null,
        score: parseNumber(item.payload?.score, true),
        aired: item.payload?.aired || null,
        status: item.payload?.status || null
      }));

      return {
        pagination: {
          currentPage: 1,
          hasNextPage: false
        },
        data
      };
    }

    const show = (page - 1) * 50;
    const searchUrl = `${this.baseUrl}/anime.php?q=${encodeURIComponent(q)}&cat=anime${show > 0 ? `&show=${show}` : ''}`;
    const html = await this._fetchHtml(searchUrl);
    const $ = cheerio.load(html);

    const data = [];
    const rows = $('.js-categories-seasonal table tr');

    rows.each((idx, row) => {
      if (idx === 0) return; // Skip table header row
      const tds = $(row).find('td');
      if (tds.length < 5) return;

      const imgEl = tds.eq(0).find('img').first();
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src');

      const titleLink = tds.eq(1).find('a.hoverinfo_trigger').first();
      const url = toAbsoluteUrl(titleLink.attr('href'));
      const id = extractId(url, 'anime');
      const title = titleLink.find('strong').text().trim() || titleLink.text().trim();

      const descClone = tds.eq(1).find('.pt4').first().clone();
      descClone.find('a').remove();
      const synopsis = descClone.text().trim().replace(/\.\.\.$/, '...').trim() || null;

      const type = tds.eq(2).text().trim() || null;
      const episodes = parseNumber(tds.eq(3).text());
      const score = parseNumber(tds.eq(4).text(), true);

      if (id && title) {
        data.push({
          id,
          title,
          url,
          images: parseImages(rawImg),
          synopsis,
          type,
          episodes,
          score
        });
      }
    });

    const nextShow = page * 50;
    const hasNextPage = $(`a[href*="show=${nextShow}"]`).length > 0;

    return {
      pagination: {
        currentPage: page,
        hasNextPage
      },
      data
    };
  }

  /**
   * 2. Top Anime Rankings
   */
  async getTopAnime(options = {}) {
    const type = String(options.type || 'all').toLowerCase().trim();
    if (!VALID_TOP_TYPES.has(type)) {
      throw new ScraperError(
        `Tipe ranking "${type}" tidak valid. Pilihan: ${Array.from(VALID_TOP_TYPES).join(', ')}`,
        400
      );
    }

    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = (page - 1) * 50;
    const params = new URLSearchParams();
    if (type !== 'all') params.set('type', type);
    if (limit > 0) params.set('limit', String(limit));

    const queryStr = params.toString();
    const url = `${this.baseUrl}/topanime.php${queryStr ? `?${queryStr}` : ''}`;
    const html = await this._fetchHtml(url);
    const $ = cheerio.load(html);

    const data = [];
    $('tr.ranking-list').each((_, row) => {
      const el = $(row);
      const rank = parseNumber(el.find('td.rank span').text());
      const titleAnchor = el.find('.anime_ranking_h3 a').first();
      const animeUrl = toAbsoluteUrl(titleAnchor.attr('href'));
      const id = extractId(animeUrl, 'anime');
      const title = titleAnchor.text().trim();

      const imgEl = el.find('td.title img').first();
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src');

      const infoLines = (el.find('.information').html() || '')
        .split(/<br\s*\/?>/i)
        .map((line) => cheerio.load(`<div>${line}</div>`)('div').text().trim())
        .filter(Boolean);

      const typeAndEps = infoLines[0] || '';
      const typeMatch = typeAndEps.match(/^([A-Za-z0-9\s]+?)\s*\(([^)]+)\)/);
      const animeType = typeMatch ? typeMatch[1].trim() : typeAndEps || null;
      const episodes = typeMatch ? parseNumber(typeMatch[2]) : null;
      const aired = infoLines[1] || null;
      const members = parseNumber(infoLines[2]);
      const score = parseNumber(el.find('td.score .score-label').text(), true);

      if (id && title) {
        data.push({
          rank,
          id,
          title,
          url: animeUrl,
          images: parseImages(rawImg),
          type: animeType,
          episodes,
          aired,
          members,
          score
        });
      }
    });

    const hasNextPage = $('a.link-blue-box.next').length > 0;

    return {
      filter: type,
      pagination: {
        currentPage: page,
        hasNextPage
      },
      data
    };
  }

  /**
   * 3. Seasonal Anime (Current Season or Specific Year & Season)
   */
  async getSeasonalAnime(options = {}) {
    const { year, season, type: filterType } = options;
    let url = `${this.baseUrl}/anime/season`;

    if (year || season) {
      const parsedYear = parseInt(year, 10);
      const normalizedSeason = String(season || '').toLowerCase().trim();
      if (!parsedYear || parsedYear < 1917 || parsedYear > 2100) {
        throw new ScraperError('Parameter year tidak valid (contoh: 2026).', 400);
      }
      if (!VALID_SEASONS.has(normalizedSeason)) {
        throw new ScraperError(
          `Parameter season tidak valid. Pilihan: ${Array.from(VALID_SEASONS).join(', ')}`,
          400
        );
      }
      url = `${this.baseUrl}/anime/season/${parsedYear}/${normalizedSeason}`;
    }

    const html = await this._fetchHtml(url);
    const $ = cheerio.load(html);

    const seasonName = $('.horiznav_nav a.on').first().text().trim() || null;
    const sections = [];
    const allItems = [];

    $('.seasonal-anime-list').each((_, listEl) => {
      const category = $(listEl).find('.anime-header').first().text().trim() || 'Unknown';
      if (filterType && category.toLowerCase() !== String(filterType).toLowerCase().trim()) {
        return;
      }

      const items = [];
      $(listEl)
        .find('.seasonal-anime')
        .each((__, cardEl) => {
          const parsed = this._parseSeasonalCard($, cardEl);
          if (parsed.id) {
            const withCategory = { ...parsed, category };
            items.push(withCategory);
            allItems.push(withCategory);
          }
        });

      if (items.length > 0) {
        sections.push({
          category,
          count: items.length,
          items
        });
      }
    });

    return {
      season: seasonName,
      total: allItems.length,
      sections
    };
  }

  /**
   * 4. Weekly Broadcast Schedule
   */
  async getSchedule(options = {}) {
    const dayFilter = options.day ? String(options.day).toLowerCase().trim() : null;
    const url = `${this.baseUrl}/anime/season/schedule`;
    const html = await this._fetchHtml(url);
    const $ = cheerio.load(html);

    const schedule = {};
    let total = 0;

    $('.seasonal-anime-list').each((_, listEl) => {
      const dayTitle = $(listEl).find('.anime-header').first().text().trim();
      if (!dayTitle) return;

      const dayKey = dayTitle.toLowerCase();
      if (dayFilter && dayKey !== dayFilter) return;

      const items = [];
      $(listEl)
        .find('.seasonal-anime')
        .each((__, cardEl) => {
          const parsed = this._parseSeasonalCard($, cardEl);
          if (parsed.id) {
            items.push(parsed);
          }
        });

      schedule[dayKey] = items;
      total += items.length;
    });

    return {
      dayFilter,
      total,
      schedule
    };
  }

  /**
   * 5. Full Anime Details by ID
   */
  async getAnimeById(id) {
    const animeId = parseInt(id, 10);
    if (!animeId || animeId <= 0) {
      throw new ScraperError('ID anime harus berupa angka positif.', 400);
    }

    const url = `${this.baseUrl}/anime/${animeId}`;
    const html = await this._fetchHtml(url);
    const $ = cheerio.load(html);

    const canonicalUrl = $('link[rel="canonical"]').attr('href') || url;
    const defaultTitle =
      $('h1.title-name strong').text().trim() || $('h1.title-name').text().trim();
    const englishHeader = $('p.title-english').text().trim() || null;

    const posterEl = $('.leftside img[itemprop="image"], .leftside img').first();
    const rawPoster = posterEl.attr('data-src') || posterEl.attr('src');
    const images = parseImages(rawPoster);

    // Trailer
    const trailerHref = $('a.iframe.js-fancybox-video').attr('href') || null;
    let trailer = null;
    if (trailerHref) {
      const cleanEmbed = trailerHref.split('?')[0];
      const ytMatch = cleanEmbed.match(/\/embed\/([A-Za-z0-9_-]+)/);
      const youtubeId = ytMatch ? ytMatch[1] : null;
      trailer = {
        youtubeId,
        url: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : trailerHref,
        embedUrl: trailerHref
      };
    }

    // Sidebar Information
    const titles = {
      default: defaultTitle,
      english: englishHeader,
      japanese: null,
      synonyms: []
    };

    let type = null;
    let episodes = null;
    let status = null;
    let aired = null;
    let premiered = null;
    let broadcast = null;
    let source = null;
    let duration = null;
    let rating = null;
    let score = parseNumber($('.score-label').first().text(), true);
    let scoredBy = parseNumber($('[itemprop="ratingCount"]').attr('content'));
    let rank = null;
    let popularity = null;
    let members = null;
    let favorites = null;

    const producers = [];
    const licensors = [];
    const studios = [];
    const genres = [];
    const explicitGenres = [];
    const themes = [];
    const demographics = [];

    const extractLinkedEntities = (container, prefix) => {
      const list = [];
      container.find('a').each((_, aEl) => {
        const href = toAbsoluteUrl($(aEl).attr('href'));
        const name = $(aEl).text().trim();
        if (href && name && !name.toLowerCase().includes('add some')) {
          list.push({
            id: extractId(href, prefix),
            name,
            url: href
          });
        }
      });
      return list;
    };

    $('.leftside .spaceit_pad').each((_, padEl) => {
      const el = $(padEl);
      const labelSpan = el.find('span.dark_text').first();
      if (!labelSpan.length) return;

      const label = labelSpan.text().replace(':', '').trim().toLowerCase();

      // Clone without dark_text, sup, hidden spans, and statistics notes
      const cleanClone = el.clone();
      cleanClone.find('span.dark_text, sup, div.statistics-info, [style*="display: none"], [style*="display:none"]').remove();
      const valueText = cleanClone.text().replace(/\s+/g, ' ').trim();

      switch (label) {
        case 'synonyms':
          titles.synonyms = valueText
            ? valueText.split(',').map((s) => s.trim()).filter(Boolean)
            : [];
          break;
        case 'japanese':
          titles.japanese = valueText || null;
          break;
        case 'english':
          titles.english = valueText || titles.english;
          break;
        case 'type':
          type = valueText || null;
          break;
        case 'episodes':
          episodes = parseNumber(valueText);
          break;
        case 'status':
          status = valueText || null;
          break;
        case 'aired':
          aired = valueText || null;
          break;
        case 'premiered':
          premiered = valueText || null;
          break;
        case 'broadcast':
          broadcast = valueText || null;
          break;
        case 'producers':
          producers.push(...extractLinkedEntities(el, 'producer'));
          break;
        case 'licensors':
          licensors.push(...extractLinkedEntities(el, 'producer'));
          break;
        case 'studios':
          studios.push(...extractLinkedEntities(el, 'producer'));
          break;
        case 'source':
          source = valueText || null;
          break;
        case 'genres':
        case 'genre':
          genres.push(...extractLinkedEntities(el, 'genre'));
          break;
        case 'explicit genres':
        case 'explicit genre':
          explicitGenres.push(...extractLinkedEntities(el, 'genre'));
          break;
        case 'themes':
        case 'theme':
          themes.push(...extractLinkedEntities(el, 'genre'));
          break;
        case 'demographic':
        case 'demographics':
          demographics.push(...extractLinkedEntities(el, 'genre'));
          break;
        case 'duration':
          duration = valueText || null;
          break;
        case 'rating':
          rating = valueText || null;
          break;
        case 'score':
          if (score === null) score = parseNumber(el.find('[itemprop="ratingValue"]').text(), true);
          if (scoredBy === null) scoredBy = parseNumber(el.find('[itemprop="ratingCount"]').text());
          break;
        case 'ranked':
          rank = parseNumber(valueText);
          break;
        case 'popularity':
          popularity = parseNumber(valueText);
          break;
        case 'members':
          members = parseNumber(valueText);
          break;
        case 'favorites':
          favorites = parseNumber(valueText);
          break;
        default:
          break;
      }
    });

    // Synopsis
    const synopsis = $('[itemprop="description"]').text().trim() || null;

    // Background
    let background = null;
    const bgHeaderDiv = $('#background').parent();
    if (bgHeaderDiv.length) {
      let bgHtml = '';
      let nextNode = bgHeaderDiv[0].next;
      while (nextNode) {
        if (nextNode.type === 'tag' && $(nextNode).hasClass('border_top')) {
          break;
        }
        bgHtml += $.html(nextNode);
        nextNode = nextNode.next;
      }
      const parsedBg = cheerio.load(`<div>${bgHtml}</div>`)('div').text().trim();
      if (
        parsedBg &&
        !parsedBg.toLowerCase().includes('no background information has been added')
      ) {
        background = parsedBg;
      }
    }

    // Related Entries (both tile cards and table rows)
    const relationsMap = new Map();
    const addRelation = (relType, entry) => {
      const cleanRel = relType.replace(/:$/, '').trim();
      if (!relationsMap.has(cleanRel)) {
        relationsMap.set(cleanRel, []);
      }
      relationsMap.get(cleanRel).push(entry);
    };

    $('.related-entries .entries-tile .entry').each((_, tileEl) => {
      const tile = $(tileEl);
      const relRaw = tile.find('.relation').text().replace(/\s+/g, ' ').trim();
      const typeMatch = relRaw.match(/^(.*?)\s*\(([^)]+)\)$/);
      const relName = typeMatch ? typeMatch[1].trim() : relRaw;
      const mediaType = typeMatch ? typeMatch[2].trim() : null;
      const link = tile.find('.title a').first();
      const entryUrl = toAbsoluteUrl(link.attr('href'));
      const entryType = entryUrl?.includes('/manga/') ? 'manga' : 'anime';

      if (entryUrl) {
        addRelation(relName || 'Related', {
          id: extractId(entryUrl, entryType),
          type: mediaType || entryType,
          name: link.text().trim(),
          url: entryUrl
        });
      }
    });

    $('.related-entries .entries-table tr').each((_, trEl) => {
      const tds = $(trEl).find('td');
      if (tds.length < 2) return;
      const relName = tds.eq(0).text().replace(':', '').trim();
      tds.eq(1)
        .find('li')
        .each((__, liEl) => {
          const link = $(liEl).find('a').first();
          const entryUrl = toAbsoluteUrl(link.attr('href'));
          if (!entryUrl) return;
          const entryType = entryUrl.includes('/manga/') ? 'manga' : 'anime';
          const fullLiText = $(liEl).text().trim();
          const parenMatch = fullLiText.match(/\(([^)]+)\)\s*$/);
          addRelation(relName || 'Related', {
            id: extractId(entryUrl, entryType),
            type: parenMatch ? parenMatch[1].trim() : entryType,
            name: link.text().trim(),
            url: entryUrl
          });
        });
    });

    const relations = Array.from(relationsMap.entries()).map(([relation, entries]) => ({
      relation,
      entries
    }));

    // Characters preview on main page
    const characters = [];
    $('.detail-characters-list')
      .first()
      .find('> div > table')
      .each((_, tableEl) => {
        const tds = $(tableEl).find('> tbody > tr > td, > tr > td');
        if (tds.length < 2) return;

        const charImg = tds.eq(0).find('img').first();
        const charLink = tds.eq(1).find('h3 a').first();
        const charUrl = toAbsoluteUrl(charLink.attr('href'));
        const role = tds.eq(1).find('small').first().text().trim() || null;

        let voiceActor = null;
        if (tds.length >= 3) {
          const vaLink = tds.eq(2).find('a').first();
          const vaUrl = toAbsoluteUrl(vaLink.attr('href'));
          const vaImg = tds.eq(2).find('img').first();
          if (vaUrl) {
            voiceActor = {
              id: extractId(vaUrl, 'people'),
              name: vaLink.text().trim(),
              language: tds.eq(2).find('small').first().text().trim() || null,
              url: vaUrl,
              images: parseImages(vaImg.attr('data-src') || vaImg.attr('src'))
            };
          }
        }

        if (charUrl) {
          characters.push({
            id: extractId(charUrl, 'character'),
            name: charLink.text().trim(),
            role,
            url: charUrl,
            images: parseImages(charImg.attr('data-src') || charImg.attr('src')),
            voiceActor
          });
        }
      });

    // Staff preview on main page
    const staff = [];
    const detailLists = $('.detail-characters-list');
    if (detailLists.length > 1) {
      detailLists
        .eq(1)
        .find('> div > table')
        .each((_, tableEl) => {
          const tds = $(tableEl).find('> tbody > tr > td, > tr > td');
          if (tds.length < 2) return;
          const personImg = tds.eq(0).find('img').first();
          const personLink = tds.eq(1).find('a').first();
          const personUrl = toAbsoluteUrl(personLink.attr('href'));
          const positions = tds
            .eq(1)
            .find('small')
            .text()
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

          if (personUrl) {
            staff.push({
              id: extractId(personUrl, 'people'),
              name: personLink.text().trim(),
              positions,
              url: personUrl,
              images: parseImages(personImg.attr('data-src') || personImg.attr('src'))
            });
          }
        });
    }

    // Theme Songs (Opening & Ending)
    const parseThemes = (selector) => {
      const songs = [];
      $(`${selector} > table > tbody > tr, ${selector} > table > tr`).each((_, trEl) => {
        const songTd = $(trEl).find('td').eq(1);
        if (!songTd.length) return;
        const clone = songTd.clone();
        clone.find('input, div, table').remove();
        const text = clone.text().replace(/\s+/g, ' ').trim();
        if (text) songs.push(text);
      });
      return songs;
    };

    const themeSongs = {
      openings: parseThemes('.theme-songs.opnening'),
      endings: parseThemes('.theme-songs.ending')
    };

    // Streaming Links
    const streaming = [];
    $('.broadcasts .broadcast a').each((_, aEl) => {
      const name = $(aEl).attr('title') || $(aEl).text().trim();
      const href = $(aEl).attr('href');
      if (name && href) {
        streaming.push({ name, url: href });
      }
    });

    // External Links
    const externalLinks = [];
    $('.external_links a.link').each((_, aEl) => {
      const name = $(aEl).text().trim();
      const href = $(aEl).attr('href');
      if (name && href) {
        externalLinks.push({ name, url: href });
      }
    });

    return {
      id: animeId,
      url: canonicalUrl,
      title: defaultTitle,
      titles,
      images,
      trailer,
      type,
      source,
      episodes,
      status,
      aired,
      premiered,
      broadcast,
      duration,
      rating,
      score,
      scoredBy,
      rank,
      popularity,
      members,
      favorites,
      synopsis,
      background,
      producers,
      licensors,
      studios,
      genres,
      explicitGenres,
      themes,
      demographics,
      relations,
      characters,
      staff,
      themeSongs,
      streaming,
      externalLinks
    };
  }

  /**
   * 6. Anime Episodes List by ID
   */
  async getAnimeEpisodes(id, options = {}) {
    const animeId = parseInt(id, 10);
    if (!animeId || animeId <= 0) {
      throw new ScraperError('ID anime harus berupa angka positif.', 400);
    }

    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const offset = (page - 1) * 100;
    const url = `${this.baseUrl}/anime/${animeId}/_/episode${offset > 0 ? `?offset=${offset}` : ''}`;
    const html = await this._fetchHtml(url);
    const $ = cheerio.load(html);

    const episodes = [];
    $('tr.episode-list-data').each((_, row) => {
      const el = $(row);
      const number =
        parseNumber(el.find('td.episode-number').attr('data-raw')) ??
        parseNumber(el.find('td.episode-number').text());
      const titleLink = el.find('td.episode-title a').first();
      const title = titleLink.text().trim() || null;
      const episodeUrl = toAbsoluteUrl(titleLink.attr('href'));

      const subTitleText = el.find('td.episode-title span.di-ib').text().trim();
      let romajiTitle = null;
      let japaneseTitle = null;
      if (subTitleText) {
        const jpMatch = subTitleText.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        if (jpMatch) {
          romajiTitle = jpMatch[1].trim() || null;
          japaneseTitle = jpMatch[2].trim() || null;
        } else {
          romajiTitle = subTitleText;
        }
      }

      const aired = el.find('td.episode-aired').text().trim() || null;
      const score =
        parseNumber(el.find('td.episode-poll').attr('data-raw'), true) ??
        parseNumber(el.find('td.episode-poll .value').text(), true);
      const forumUrl = toAbsoluteUrl(el.find('td.episode-forum a').attr('href'));

      episodes.push({
        number,
        title,
        romajiTitle,
        japaneseTitle,
        aired: aired && aired !== 'N/A' ? aired : null,
        score,
        url: episodeUrl,
        forumUrl
      });
    });

    const nextOffset = page * 100;
    const hasNextPage = $(`.pagination a[href*="offset=${nextOffset}"]`).length > 0;

    return {
      id: animeId,
      pagination: {
        currentPage: page,
        hasNextPage
      },
      data: episodes
    };
  }

  /**
   * 7. Full Anime Characters & Staff by ID
   */
  async getAnimeCharacters(id) {
    const animeId = parseInt(id, 10);
    if (!animeId || animeId <= 0) {
      throw new ScraperError('ID anime harus berupa angka positif.', 400);
    }

    const url = `${this.baseUrl}/anime/${animeId}/_/characters`;
    const html = await this._fetchHtml(url);
    const $ = cheerio.load(html);

    const characters = [];
    $('table.js-anime-character-table').each((_, tableEl) => {
      const tds = $(tableEl).find('> tbody > tr > td, > tr > td');
      if (tds.length < 2) return;

      const charImg = tds.eq(0).find('img').first();
      const charNameEl = tds.eq(1).find('.h3_character_name').first();
      const charLink = charNameEl.closest('a');
      const charUrl = toAbsoluteUrl(charLink.attr('href'));
      const favorites = parseNumber(tds.eq(1).find('.js-anime-character-favorites').text());
      const role = tds.eq(1).find('.spaceit_pad').eq(1).text().trim() || null;

      const voiceActors = [];
      if (tds.length >= 3) {
        tds
          .eq(2)
          .find('tr.js-anime-character-va-lang')
          .each((__, vaRow) => {
            const vaLink = $(vaRow).find('a').first();
            const vaUrl = toAbsoluteUrl(vaLink.attr('href'));
            const vaLang = $(vaRow).find('.js-anime-character-language').text().trim() || null;
            const vaImg = $(vaRow).find('img').first();
            if (vaUrl) {
              voiceActors.push({
                id: extractId(vaUrl, 'people'),
                name: vaLink.text().trim(),
                language: vaLang,
                url: vaUrl,
                images: parseImages(vaImg.attr('data-src') || vaImg.attr('src'))
              });
            }
          });
      }

      if (charUrl) {
        characters.push({
          id: extractId(charUrl, 'character'),
          name: charNameEl.text().trim(),
          role,
          favorites,
          url: charUrl,
          images: parseImages(charImg.attr('data-src') || charImg.attr('src')),
          voiceActors
        });
      }
    });

    const staff = [];
    const staffHeader = $('.h2_overwrite')
      .filter((_, el) => $(el).text().includes('Staff'))
      .parent();

    if (staffHeader.length) {
      staffHeader.nextAll('table').each((_, tableEl) => {
        const tds = $(tableEl).find('> tbody > tr > td, > tr > td');
        if (tds.length < 2) return;
        const personImg = tds.eq(0).find('img').first();
        const personLink = tds.eq(1).find('a').first();
        const personUrl = toAbsoluteUrl(personLink.attr('href'));
        const positions = tds
          .eq(1)
          .find('small')
          .text()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        if (personUrl && personUrl.includes('/people/')) {
          staff.push({
            id: extractId(personUrl, 'people'),
            name: personLink.text().trim(),
            positions,
            url: personUrl,
            images: parseImages(personImg.attr('data-src') || personImg.attr('src'))
          });
        }
      });
    }

    return {
      id: animeId,
      characters,
      staff
    };
  }

  /**
   * 8. User Recommendations for an Anime
   */
  async getAnimeRecommendations(id) {
    const animeId = parseInt(id, 10);
    if (!animeId || animeId <= 0) {
      throw new ScraperError('ID anime harus berupa angka positif.', 400);
    }

    const url = `${this.baseUrl}/anime/${animeId}/_/userrecs`;
    const html = await this._fetchHtml(url);
    const $ = cheerio.load(html);

    const data = [];
    $('.js-scrollfix-bottom-rel > div.borderClass').each((_, recDiv) => {
      const el = $(recDiv);
      const titleLink = el.find('a[href*="/anime/"] strong').parent();
      const animeUrl = toAbsoluteUrl(titleLink.attr('href'));
      const recId = extractId(animeUrl, 'anime');
      const title = titleLink.find('strong').text().trim();
      const imgEl = el.find('img').first();
      const rawImg = imgEl.attr('data-src') || imgEl.attr('src');

      const moreUsersText = el.find('.js-similar-recommendations-button strong').text();
      const extraUsers = parseNumber(moreUsersText) || 0;
      const sampleReason = el.find('.detail-user-recs-text').first().text().trim() || null;

      if (recId && title) {
        data.push({
          anime: {
            id: recId,
            title,
            url: animeUrl,
            images: parseImages(rawImg)
          },
          votes: extraUsers + 1,
          sampleReason
        });
      }
    });

    return {
      id: animeId,
      total: data.length,
      data
    };
  }

  /**
   * 9. Get All Anime Genres, Themes, Demographics & Popular Studios
   */
  async getGenres() {
    const url = `${this.baseUrl}/anime.php`;
    const html = await this._fetchHtml(url);
    const $ = cheerio.load(html);

    const categories = {
      genres: [],
      explicitGenres: [],
      themes: [],
      demographics: [],
      studios: []
    };

    $('.anime-manga-search .genre-link').each((_, groupEl) => {
      const headerRaw = $(groupEl).prevAll('.normal_header').first().text().toLowerCase();
      let bucket = null;
      let idPrefix = 'genre';

      if (headerRaw.includes('explicit')) {
        bucket = categories.explicitGenres;
      } else if (headerRaw.includes('genre')) {
        bucket = categories.genres;
      } else if (headerRaw.includes('theme')) {
        bucket = categories.themes;
      } else if (headerRaw.includes('demographic')) {
        bucket = categories.demographics;
      } else if (headerRaw.includes('studio')) {
        bucket = categories.studios;
        idPrefix = 'producer';
      }

      if (!bucket) return;

      $(groupEl)
        .find('a.genre-name-link')
        .each((__, aEl) => {
          const href = toAbsoluteUrl($(aEl).attr('href'));
          const rawText = $(aEl).text().trim();
          const match = rawText.match(/^(.*?)\s*\(([\d,]+)\)\s*$/);
          const name = match ? match[1].trim() : rawText;
          const count = match ? parseNumber(match[2]) : null;
          const itemId = extractId(href, idPrefix);

          if (itemId && name) {
            bucket.push({
              id: itemId,
              name,
              count,
              url: href
            });
          }
        });
    });

    return categories;
  }

  /**
   * 10. Get Anime List by Genre / Theme / Demographic ID
   */
  async getAnimeByGenre(genreId, options = {}) {
    const id = parseInt(genreId, 10);
    if (!id || id <= 0) {
      throw new ScraperError('ID genre harus berupa angka positif.', 400);
    }

    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const url = `${this.baseUrl}/anime/genre/${id}?page=${page}`;
    const html = await this._fetchHtml(url);
    const $ = cheerio.load(html);

    const headerText = $('h1.title-name, span.di-ib.mt4').first().text().trim();
    const countMatch = headerText.match(/\(([\d,]+)\)/);
    const totalCount = countMatch ? parseNumber(countMatch[1]) : null;
    const genreName = headerText.replace(/\s*\([\d,]+\)\s*$/, '').trim() || null;

    const data = [];
    $('.seasonal-anime').each((_, cardEl) => {
      const parsed = this._parseSeasonalCard($, cardEl);
      if (parsed.id) data.push(parsed);
    });

    const hasNextPage = $(`.pagination a[href*="page=${page + 1}"]`).length > 0;

    return {
      genre: {
        id,
        name: genreName,
        totalCount
      },
      pagination: {
        currentPage: page,
        hasNextPage
      },
      data
    };
  }

  /**
   * 11. Get Anime List & Profile by Studio / Producer ID
   */
  async getAnimeByProducer(producerId, options = {}) {
    const id = parseInt(producerId, 10);
    if (!id || id <= 0) {
      throw new ScraperError('ID studio/producer harus berupa angka positif.', 400);
    }

    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(options.limit, 10) || 50));
    const url = `${this.baseUrl}/anime/producer/${id}`;
    const html = await this._fetchHtml(url);
    const $ = cheerio.load(html);

    const producerName =
      $('h1.title-name').first().text().trim() ||
      $('.content-left .normal_header').first().text().trim() ||
      null;
    const logoImg = $('.content-left .logo img').first();
    const logo = logoImg.attr('data-src') || logoImg.attr('src') || null;

    let japaneseName = null;
    let established = null;
    let favorites = null;
    let about = null;

    $('.content-left .spaceit_pad').each((_, padEl) => {
      const el = $(padEl);
      const labelSpan = el.find('span.dark_text').first();
      if (labelSpan.length) {
        const label = labelSpan.text().replace(':', '').trim().toLowerCase();
        const clone = el.clone();
        clone.find('span.dark_text').remove();
        const val = clone.text().trim();
        if (label === 'japanese') japaneseName = val || null;
        else if (label === 'established') established = val || null;
        else if (label.includes('favorites')) favorites = parseNumber(val);
      } else {
        const text = el.text().trim();
        if (text) about = text;
      }
    });

    const allItems = [];
    $('.seasonal-anime').each((_, cardEl) => {
      const card = $(cardEl);
      // Company page uses compact tile structure (.title a, .category, .widget)
      const tileLink = card.find('.title a').first();
      if (tileLink.length && !card.find('.h2_anime_title').length) {
        const animeUrl = toAbsoluteUrl(tileLink.attr('href'));
        const animeId = extractId(animeUrl, 'anime');
        if (!animeId) return;
        const imgEl = card.find('.image img').first();
        allItems.push({
          id: animeId,
          title: tileLink.text().trim(),
          url: animeUrl,
          images: parseImages(imgEl.attr('data-src') || imgEl.attr('src')),
          role: card.find('.category').text().trim() || null,
          score: parseNumber(card.find('.widget .stars').text(), true),
          members: parseNumber(card.find('.widget .users').text())
        });
      } else {
        const parsed = this._parseSeasonalCard($, cardEl);
        if (parsed.id) allItems.push(parsed);
      }
    });

    // Deduplicate in case an anime appears under multiple categories (e.g., Studio + Producer)
    const uniqueMap = new Map();
    for (const item of allItems) {
      if (!uniqueMap.has(item.id)) {
        uniqueMap.set(item.id, item);
      } else if (item.role && uniqueMap.get(item.id).role && !uniqueMap.get(item.id).role.includes(item.role)) {
        uniqueMap.get(item.id).role += `, ${item.role}`;
      }
    }
    const uniqueItems = Array.from(uniqueMap.values());

    const startIdx = (page - 1) * limit;
    const paginatedData = uniqueItems.slice(startIdx, startIdx + limit);
    const hasNextPage = startIdx + limit < uniqueItems.length;

    return {
      producer: {
        id,
        name: producerName,
        japaneseName,
        established,
        favorites,
        logo,
        about,
        totalAnime: uniqueItems.length
      },
      pagination: {
        currentPage: page,
        perPage: limit,
        totalPages: Math.ceil(uniqueItems.length / limit) || 1,
        hasNextPage
      },
      data: paginatedData
    };
  }
}

module.exports = {
  MyAnimeList,
  ScraperError
};

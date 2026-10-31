const { MyAnimeList, ScraperError } = require('./providers/myanimelist');

const ROMAN_SEASONS = {
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6
};

const STOP_WORDS = new Set([
  'subtitle',
  'indonesia',
  'subtilte',
  'subtitlle',
  'subitle',
  'sub',
  'indo',
  'bahasa'
]);

/**
 * Extract 4-digit start year from MyAnimeList `premiered` ("Fall 2023") or `aired` ("Sep 29, 2023 to ...")
 */
function extractMalYear(malAnime) {
  if (malAnime?.premiered) {
    const m = String(malAnime.premiered).match(/\b(19\d{2}|20\d{2})\b/);
    if (m) return parseInt(m[1], 10);
  }
  if (malAnime?.aired) {
    const m = String(malAnime.aired).match(/\b(19\d{2}|20\d{2})\b/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/**
 * Parse title into canonical base tokens, arc tokens, season number, and part/cour number
 */
function parseTitleFeatures(rawTitle) {
  if (!rawTitle) return null;
  let working = String(rawTitle)
    .replace(/[""„‟]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!working) return null;

  let season = 1;
  let hasExplicitSeason = false;
  let part = null;

  // 1. Check standalone uppercase Roman numerals before lowercasing (e.g. "Mushoku Tensei II", "Tensei shitara Ken deshita II")
  const romanMatch = working.match(/(?:^|[\s:])(II|III|IV|V|VI)(?=$|[\s:\-—(])/);
  if (romanMatch && ROMAN_SEASONS[romanMatch[1]]) {
    season = ROMAN_SEASONS[romanMatch[1]];
    hasExplicitSeason = true;
    working = working.replace(romanMatch[0], ' ');
  }

  let lower = working.toLowerCase();

  // Strip Sokuja suffix noise
  lower = lower.replace(/\b(?:subtitle\s+indonesia|subtilte\s+indonesia|subtitlle\s+indonesia|subitle\s+indonesia|sub\s+indo)\b/g, ' ');

  // 2. Ordinal season ("2nd season", "3rd season", "1st season")
  const ordSeasonMatch = lower.match(/\b(\d+)\s*(?:st|nd|rd|th)\s+season\b/);
  if (ordSeasonMatch) {
    season = parseInt(ordSeasonMatch[1], 10);
    hasExplicitSeason = true;
    lower = lower.replace(ordSeasonMatch[0], ' ');
  }

  // 3. Explicit "season N" or "musim N" or "s2"
  const explicitSeasonMatch = lower.match(/\b(?:season|musim)\s*(\d+)\b/);
  if (explicitSeasonMatch) {
    season = parseInt(explicitSeasonMatch[1], 10);
    hasExplicitSeason = true;
    lower = lower.replace(explicitSeasonMatch[0], ' ');
  } else {
    const shortSMatch = lower.match(/\bs(\d+)\b/);
    if (shortSMatch) {
      season = parseInt(shortSMatch[1], 10);
      hasExplicitSeason = true;
      lower = lower.replace(shortSMatch[0], ' ');
    } else if (/\bsono\s+ni\b/.test(lower)) {
      season = 2;
      hasExplicitSeason = true;
      lower = lower.replace(/\bsono\s+ni\b/, ' ');
    }
  }

  // 4. Part / Cour ("part 2", "cour 2", "zenpen", "kouhen")
  const partMatch = lower.match(/\b(?:part|cour)\s*(\d+)\b/);
  if (partMatch) {
    part = parseInt(partMatch[1], 10);
    lower = lower.replace(partMatch[0], ' ');
  } else if (/\bzenpen\b/.test(lower)) {
    part = 1;
    lower = lower.replace(/\bzenpen\b/, ' ');
  } else if (/\bkouhen\b/.test(lower)) {
    part = 2;
    lower = lower.replace(/\bkouhen\b/, ' ');
  }

  // Strip generic media words only if surrounded as tags (keep meaningful numbers like 0, 86, 99, 100, 300)
  lower = lower.replace(/\(tv\s*special\)/g, ' special ');
  lower = lower.replace(/\b(?:tv|series)\b/g, ' ');

  // Split main title vs subtitle/arc around ":" or " - "
  const colonParts = lower.split(/\s*(?::|—|\s-\s)\s*/).filter(Boolean);
  const tokenize = (str) =>
    str
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOP_WORDS.has(w));

  const allTokens = tokenize(lower);
  const headTokens = colonParts.length > 0 ? tokenize(colonParts[0]) : allTokens;
  const arcTokens = colonParts.length > 1 ? tokenize(colonParts.slice(1).join(' ')) : [];

  return {
    raw: rawTitle,
    season,
    hasExplicitSeason,
    part,
    allTokens,
    headTokens: headTokens.length ? headTokens : allTokens,
    arcTokens,
    normalizedAll: allTokens.join(' '),
    normalizedHead: (headTokens.length ? headTokens : allTokens).join(' ')
  };
}

/**
 * Compute Dice token similarity between two token arrays (0..1)
 */
function tokenDiceSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  return (2 * intersection) / (setA.size + setB.size);
}

/**
 * Score a Sokuja candidate against a MyAnimeList anime profile
 */
function scoreSokujaCandidate(malProfile, candidate) {
  // Expand parenthetical alias inside Sokuja title if any, e.g. "Ore dake Level Up na Ken (Solo Leveling)"
  const candVariants = [parseTitleFeatures(candidate.title)].filter(Boolean);
  const parenMatch = String(candidate.title || '').match(/\(([^)]+)\)/);
  if (parenMatch && !/tv|ova|ona|movie|special|end/i.test(parenMatch[1])) {
    const withoutParen = String(candidate.title).replace(/\([^)]*\)/g, ' ');
    const fWithout = parseTitleFeatures(withoutParen);
    if (fWithout) candVariants.push(fWithout);
  }
  if (Array.isArray(candidate.alternativeTitles)) {
    for (const alt of candidate.alternativeTitles) {
      const fAlt = parseTitleFeatures(alt);
      if (fAlt) {
        // Inherit season/part from main Sokuja title if alt doesn't state it
        if (!fAlt.hasExplicitSeason && candVariants[0]?.hasExplicitSeason) {
          fAlt.season = candVariants[0].season;
          fAlt.hasExplicitSeason = true;
        }
        if (fAlt.part === null && candVariants[0]?.part !== null) {
          fAlt.part = candVariants[0].part;
        }
        candVariants.push(fAlt);
      }
    }
  }

  let bestPair = null;

  for (const mFeat of malProfile.titleFeatures) {
    for (const cFeat of candVariants) {
      const fullSim =
        mFeat.normalizedAll === cFeat.normalizedAll
          ? 1
          : tokenDiceSimilarity(mFeat.allTokens, cFeat.allTokens);
      const headSim =
        mFeat.normalizedHead === cFeat.normalizedHead
          ? 1
          : tokenDiceSimilarity(mFeat.headTokens, cFeat.headTokens);
      const arcSim =
        mFeat.arcTokens.length && cFeat.arcTokens.length
          ? tokenDiceSimilarity(mFeat.arcTokens, cFeat.arcTokens)
          : 0;

      const combinedTextSim = Math.max(fullSim, headSim * 0.88 + arcSim * 0.12);
      if (!bestPair || combinedTextSim > bestPair.combinedTextSim) {
        bestPair = { mFeat, cFeat, fullSim, headSim, arcSim, combinedTextSim };
      }
    }
  }

  if (!bestPair || bestPair.combinedTextSim < 0.52) {
    return -100;
  }

  const { mFeat, cFeat, fullSim, headSim, arcSim } = bestPair;
  let score = fullSim * 52 + headSim * 18 + arcSim * 10;

  // If one title has extra subtitle tokens that aren't in the other (e.g. spin-off "Fan Letter" or "Episode Nagi" or "Gyojin Tou-hen")
  if (mFeat.allTokens.length !== cFeat.allTokens.length && fullSim < 1) {
    const extraRatio =
      Math.abs(mFeat.allTokens.length - cFeat.allTokens.length) /
      Math.max(mFeat.allTokens.length, cFeat.allTokens.length);
    score -= extraRatio * 14;
  }

  // Season matching (Critical for distinguishing Season 1 vs Season 2/3/4)
  if (mFeat.season === cFeat.season) {
    score += 24;
  } else if (!mFeat.hasExplicitSeason && mFeat.arcTokens.length > 0 && arcSim >= 0.65) {
    // Arc-named sequel on MAL matched with "Arc + Season N" on Sokuja (e.g. Kimetsu no Yaiba: Yuukaku-hen Season 3)
    score += 14;
  } else {
    score -= 50;
  }

  // Part / Cour matching
  if (mFeat.part !== null && cFeat.part !== null) {
    score += mFeat.part === cFeat.part ? 14 : -35;
  } else if (mFeat.part === null && cFeat.part !== null) {
    if (cFeat.part === 1) {
      score += 3;
    } else if (mFeat.arcTokens.length > 0 && arcSim >= 0.65) {
      score += 8;
    } else {
      score -= 28;
    }
  } else if (mFeat.part !== null && cFeat.part === null) {
    score -= 22;
  }

  // Year matching
  if (malProfile.year && candidate.year) {
    const yearDiff = Math.abs(malProfile.year - candidate.year);
    if (yearDiff === 0) {
      score += 20;
    } else if (yearDiff === 1) {
      score += 8;
    } else {
      score -= Math.min(25, yearDiff * 6);
    }
  }

  // Media Type matching (TV, Movie, OVA, ONA, Special)
  if (malProfile.type && candidate.type) {
    const mType = malProfile.type.toLowerCase();
    const cType = candidate.type.toLowerCase();
    if (mType === cType) {
      score += 12;
    } else if (
      (mType === 'movie' && cType !== 'movie') ||
      (cType === 'movie' && mType !== 'movie')
    ) {
      score -= 26;
    } else {
      score -= 10;
    }
  }

  return Math.round(score * 100) / 100;
}

class MalSokujaLinker {
  constructor({ sokujaProvider, malProvider, cacheTTL = 60 * 60 * 1000 } = {}) {
    this.sokuja = sokujaProvider;
    this.mal = malProvider || new MyAnimeList({ cacheTTL });
    this.cacheTTL = cacheTTL;
    this.linkCache = new Map();
  }

  /**
   * Resolve numeric MyAnimeList ID (e.g. 52991) to Sokuja anime slug (e.g. "sousou-no-frieren-subtitle-indonesia")
   */
  async resolveMalId(malId) {
    const parsedId = parseInt(malId, 10);
    if (!parsedId || parsedId <= 0 || String(malId).trim() !== String(parsedId)) {
      throw new ScraperError('MyAnimeList ID must be a positive integer (e.g. 52991).', 400);
    }

    const now = Date.now();
    if (this.cacheTTL > 0 && this.linkCache.has(parsedId)) {
      const cached = this.linkCache.get(parsedId);
      if (now - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
      this.linkCache.delete(parsedId);
    }

    // 1. Fetch anime metadata from MyAnimeList
    const malAnime = await this.mal.getAnimeById(parsedId);
    const rawTitles = [
      malAnime.title,
      malAnime.titles?.default,
      malAnime.titles?.english,
      ...(malAnime.titles?.synonyms || [])
    ].filter(Boolean);

    const uniqueRawTitles = Array.from(new Set(rawTitles));
    const titleFeatures = uniqueRawTitles.map((t) => parseTitleFeatures(t)).filter(Boolean);
    const malYear = extractMalYear(malAnime);

    const malProfile = {
      id: parsedId,
      title: malAnime.title,
      englishTitle: malAnime.titles?.english || null,
      type: malAnime.type || null,
      year: malYear,
      episodes: malAnime.episodes || null,
      url: malAnime.url,
      titleFeatures
    };

    // 2. Collect candidates from Sokuja full A-Z directory (/anime/list-mode/)
    const azResult = await this.sokuja.getAnimeListAZ();
    const candidatesMap = new Map();
    for (const group of azResult.groups) {
      for (const item of group.items) {
        candidatesMap.set(item.slug, item);
      }
    }

    const rankCandidates = () => {
      const scored = [];
      for (const cand of candidatesMap.values()) {
        const s = scoreSokujaCandidate(malProfile, cand);
        if (s > 0) {
          scored.push({ ...cand, matchScore: s });
        }
      }
      scored.sort((a, b) => b.matchScore - a.matchScore);
      return scored;
    };

    let ranked = rankCandidates();

    // 3. If top candidate score is not high enough (e.g., title in Sokuja uses a synonym/alternative title),
    //    run Sokuja search `/?s=` using primary keywords from default & English MAL titles
    if (!ranked.length || ranked[0].matchScore < 85) {
      const searchQueries = new Set();
      for (const feat of titleFeatures.slice(0, 2)) {
        const qWords = feat.headTokens.slice(0, 4).join(' ');
        if (qWords.length >= 2) searchQueries.add(qWords);
      }

      for (const q of searchQueries) {
        try {
          const searchRes = await this.sokuja.search(q);
          for (const item of searchRes.data) {
            if (!candidatesMap.has(item.slug)) {
              candidatesMap.set(item.slug, item);
            }
          }
        } catch {
          // Ignore if any search query fails
        }
      }

      // Inspect `alternativeTitles` detail on top search candidates if still not certain
      const searchCandidates = Array.from(candidatesMap.values()).slice(-8);
      for (const sc of searchCandidates) {
        if (!sc.alternativeTitles) {
          try {
            const detail = await this.sokuja.getAnimeDetail(sc.slug);
            candidatesMap.set(sc.slug, {
              ...sc,
              year: sc.year || detail.year,
              type: sc.type || detail.type,
              alternativeTitles: detail.alternativeTitles
            });
          } catch {
            // Skip if detail fetch fails
          }
        }
      }

      ranked = rankCandidates();
    }

    const best = ranked[0] || null;
    // Minimum match threshold so anime not on Sokuja is not incorrectly linked to another title
    const MIN_MATCH_SCORE = 62;

    if (!best || best.matchScore < MIN_MATCH_SCORE) {
      throw new ScraperError(
        `Anime MyAnimeList ID ${parsedId} ("${malAnime.title}") not found / not yet available on Sokuja.`,
        404
      );
    }

    const confidence = Math.min(1, Math.max(0.5, Math.round((best.matchScore / 110) * 100) / 100));

    const resolved = {
      malId: parsedId,
      slug: best.slug,
      sokujaUrl: best.url,
      confidence,
      matchScore: best.matchScore,
      mal: {
        id: malAnime.id,
        title: malAnime.title,
        englishTitle: malAnime.titles?.english || null,
        type: malAnime.type,
        year: malYear,
        premiered: malAnime.premiered,
        episodes: malAnime.episodes,
        score: malAnime.score,
        url: malAnime.url
      },
      sokuja: {
        slug: best.slug,
        title: best.title,
        type: best.type,
        status: best.status,
        year: best.year,
        url: best.url
      },
      alternatives: ranked.slice(1, 4).map((item) => ({
        slug: item.slug,
        title: item.title,
        type: item.type,
        year: item.year,
        matchScore: item.matchScore,
        url: item.url
      }))
    };

    if (this.cacheTTL > 0) {
      if (this.linkCache.size > 500) {
        const oldestKey = this.linkCache.keys().next().value;
        this.linkCache.delete(oldestKey);
      }
      this.linkCache.set(parsedId, { data: resolved, timestamp: now });
    }

    return resolved;
  }
}

module.exports = {
  MalSokujaLinker,
  parseTitleFeatures,
  scoreSokujaCandidate
};


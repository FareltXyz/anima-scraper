const express = require('express');
const { AnimaScraper } = require('../scraper');

const router = express.Router();
const sakunimeScraper = new AnimaScraper({ provider: 'sakunime' });

// Index / Endpoint Documentation for Sakunime
router.get('/', (req, res) => {
  const basePath = req.baseUrl || '/api/v1/sakunime';
  res.json({
    status: 'success',
    provider: 'sakunime',
    message:
      'Sakunime Multi-Server Scraper REST API (Supports MyAnimeList ID Linking & Prefixed Slugs hid~/sm~/otaku)',
    servers: {
      hid: 'Server 1 — Sub Indo (AI), Sub Eng & Dub Eng (slug prefix: hid~ or hi~)',
      sm: 'Server 2 — Samehadaku Sub Indo (slug prefix: sm~)',
      otaku: 'Server 3 — Otakudesu Sub Indo (unprefixed slug)'
    },
    endpoints: {
      // Direct access using MyAnimeList Numeric ID (Dual-Mode, just like sokujaId)
      animeByMalIdSeason1: `${basePath}/52991`,
      animeByMalIdSeason2: `${basePath}/59978`,
      animeByMalIdWithServer: `${basePath}/52991?server=sm`,
      episodesByMalId: `${basePath}/52991/episodes?page=1&order=asc`,
      episodeStreamByMalId: `${basePath}/52991/episode/1`,
      charactersByMalId: `${basePath}/52991/characters`,
      recommendationsByMalId: `${basePath}/52991/recommendations`,
      resolveMalId: `${basePath}/resolve/52991`,

      // Access using Sakunime Slug (hid~ / sm~ / unprefixed) — auto-enriched with linked malId
      animeBySlugSeason1: `${basePath}/anime/hid~frieren-beyond-journeys-end-154587`,
      animeBySlugSeason2: `${basePath}/anime/hid~frieren-beyond-journeys-end-season-2-182255`,
      episodesBySlug: `${basePath}/anime/hid~frieren-beyond-journeys-end-154587/episodes?page=1&order=asc`,
      episodeStreamByAnimeSlug: `${basePath}/anime/hid~frieren-beyond-journeys-end-154587/episode/1`,
      episodeStreamByEpisodeSlug: `${basePath}/episode/hid~frieren-beyond-journeys-end-154587~1~1`,
      resolveServerStream: `${basePath}/server/hie~frieren-beyond-journeys-end-154587~1~megaplay~sub`,
      charactersBySlug: `${basePath}/anime/hid~frieren-beyond-journeys-end-154587/characters`,
      recommendationsBySlug: `${basePath}/anime/hid~frieren-beyond-journeys-end-154587/recommendations`,

      // Catalog, Search, Schedule & Genres
      home: `${basePath}/home?page=1`,
      latestUpdates: `${basePath}/latest?page=1`,
      search: `${basePath}/search?q=frieren&server=all`,
      browse: `${basePath}/browse?genre=fantasy&status=completed&order=score&server=all&page=1`,
      ongoing: `${basePath}/ongoing?page=1&server=all`,
      completed: `${basePath}/completed?page=1&server=all`,
      movies: `${basePath}/movies?page=1`,
      topAnime: `${basePath}/top?type=popular&page=1`,
      animeListAZ: `${basePath}/anime-list?letter=S`,
      schedule: `${basePath}/schedule?day=friday`,
      genres: `${basePath}/genres`,
      animeByGenre: `${basePath}/genre/action?page=1&server=all`
    }
  });
});

// 1. Homepage (Featured, Latest Releases, Ongoing, Completed, Popular, Genres)
router.get('/home', async (req, res) => {
  const { page, server } = req.query;
  const data = await sakunimeScraper.getHome({ page, server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    data
  });
});

// 2. Latest Episode Updates
router.get('/latest', async (req, res) => {
  const { page } = req.query;
  const result = await sakunimeScraper.getLatestUpdates({ page });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

// 3. Search Anime (All servers or filtered via ?server=hid|sm|otaku)
router.get('/search', async (req, res) => {
  const { q, page, server } = req.query;
  const result = await sakunimeScraper.search(q, { page, server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

// 4. Browse / Filter Anime Catalog
router.get('/browse', async (req, res) => {
  const { genre, status, type, order, server, page } = req.query;
  const result = await sakunimeScraper.browseAnime({
    genre,
    status,
    type,
    order,
    server,
    page
  });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

// 5. Ongoing Anime
router.get('/ongoing', async (req, res) => {
  const { page, server } = req.query;
  const result = await sakunimeScraper.getOngoingAnime({ page, server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

// 6. Completed Anime
router.get('/completed', async (req, res) => {
  const { page, server } = req.query;
  const result = await sakunimeScraper.getCompletedAnime({ page, server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

// 7. Anime Movies
router.get('/movies', async (req, res) => {
  const { page, server } = req.query;
  const result = await sakunimeScraper.getMovies({ page, server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

// 8. Top / Popular Anime
router.get('/top', async (req, res) => {
  const { type, page } = req.query;
  const result = await sakunimeScraper.getTopAnime({ type, page });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

// 9. Alphabetical Anime Directory A-Z
router.get('/anime-list', async (req, res) => {
  const { letter, server } = req.query;
  const result = await sakunimeScraper.getAnimeListAZ({ letter, server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

// 10. Weekly Release Schedule (/anime/jadwal/)
router.get('/schedule', async (req, res) => {
  const { day, server } = req.query;
  const result = await sakunimeScraper.getSchedule({ day, server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

// 11. All Genres
router.get('/genres', async (req, res) => {
  const data = await sakunimeScraper.getGenres();
  res.json({
    status: 'success',
    provider: 'sakunime',
    total: data.length,
    data
  });
});

// 12. Anime by Genre Slug
router.get('/genre/:slug', async (req, res) => {
  const { slug } = req.params;
  const { page, server } = req.query;
  const result = await sakunimeScraper.getAnimeByGenre(slug, { page, server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

// 13. Resolve MyAnimeList Numeric ID -> Sakunime Anime Slug
router.get('/resolve/:malId', async (req, res) => {
  const { malId } = req.params;
  const { server } = req.query;
  const data = await sakunimeScraper.resolveMalId(malId, { server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    data
  });
});

// 14. Anime Detail, Episodes, Episode Stream, Characters & Recommendations via `/anime/:idOrSlug`
router.get('/anime/:idOrSlug', async (req, res) => {
  const { idOrSlug } = req.params;
  const { server } = req.query;
  const data = await sakunimeScraper.getAnimeDetail(idOrSlug, { server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    data
  });
});

router.get('/anime/:idOrSlug/episodes', async (req, res) => {
  const { idOrSlug } = req.params;
  const { page, limit, order, server } = req.query;
  const result = await sakunimeScraper.getAnimeEpisodes(idOrSlug, { page, limit, order, server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

router.get('/anime/:idOrSlug/episode/:number', async (req, res) => {
  const { idOrSlug, number } = req.params;
  const { type, server } = req.query;
  const data = await sakunimeScraper.getAnimeEpisode(idOrSlug, number, { type, server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    data
  });
});

router.get('/anime/:idOrSlug/characters', async (req, res) => {
  const { idOrSlug } = req.params;
  const { server } = req.query;
  const data = await sakunimeScraper.getAnimeCharacters(idOrSlug, { server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    data
  });
});

router.get('/anime/:idOrSlug/recommendations', async (req, res) => {
  const { idOrSlug } = req.params;
  const { server } = req.query;
  const result = await sakunimeScraper.getAnimeRecommendations(idOrSlug, { server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

// 15. Episode Detail, HLS/Embed Video Mirrors, Subtitles & Downloads (`/episode/:slug` & `/watch/:slug`)
router.get('/episode/:slug', async (req, res) => {
  const { slug } = req.params;
  const { type } = req.query;
  const data = await sakunimeScraper.getEpisodeDetail(slug, { type });
  res.json({
    status: 'success',
    provider: 'sakunime',
    data
  });
});

router.get('/watch/:slug', async (req, res) => {
  const { slug } = req.params;
  const { type } = req.query;
  const data = await sakunimeScraper.getEpisodeDetail(slug, { type });
  res.json({
    status: 'success',
    provider: 'sakunime',
    data
  });
});

// 16. Resolve Individual Streaming Server ID -> Direct HLS / Embed URL
router.get('/server/:serverId', async (req, res) => {
  const { serverId } = req.params;
  const data = await sakunimeScraper.getServerUrl(serverId);
  res.json({
    status: 'success',
    provider: 'sakunime',
    data
  });
});

// 17. Direct MyAnimeList ID (or Sakunime Slug) Routes at `/api/v1/sakunime/:id`
// Example: GET /api/v1/sakunime/52991 -> automatically links to hid~frieren-beyond-journeys-end-154587
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { server } = req.query;
  const data = await sakunimeScraper.getAnimeDetail(id, { server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    data
  });
});

router.get('/:id/episodes', async (req, res) => {
  const { id } = req.params;
  const { page, limit, order, server } = req.query;
  const result = await sakunimeScraper.getAnimeEpisodes(id, { page, limit, order, server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

router.get('/:id/episode/:number', async (req, res) => {
  const { id, number } = req.params;
  const { type, server } = req.query;
  const data = await sakunimeScraper.getAnimeEpisode(id, number, { type, server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    data
  });
});

router.get('/:id/characters', async (req, res) => {
  const { id } = req.params;
  const { server } = req.query;
  const data = await sakunimeScraper.getAnimeCharacters(id, { server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    data
  });
});

router.get('/:id/recommendations', async (req, res) => {
  const { id } = req.params;
  const { server } = req.query;
  const result = await sakunimeScraper.getAnimeRecommendations(id, { server });
  res.json({
    status: 'success',
    provider: 'sakunime',
    ...result
  });
});

module.exports = router;

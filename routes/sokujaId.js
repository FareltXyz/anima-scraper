const express = require('express');
const { AnimaScraper } = require('../scraper');

const router = express.Router();
const sokujaScraper = new AnimaScraper({ provider: 'sokujaId' });

// Index / Endpoint Documentation for SokujaId
router.get('/', (req, res) => {
  const basePath = req.baseUrl || '/api/v1/sokujaId';
  res.json({
    status: 'success',
    provider: 'sokujaId',
    message: 'Sokuja Indonesia Scraper REST API (Supports MyAnimeList ID Linking & Sokuja Slugs)',
    endpoints: {
      // Direct access using MyAnimeList Numeric ID
      animeByMalIdSeason1: `${basePath}/52991`,
      animeByMalIdSeason2: `${basePath}/59978`,
      episodesByMalId: `${basePath}/52991/episodes?page=1&order=asc`,
      episodeStreamByMalId: `${basePath}/52991/episode/28`,
      charactersByMalId: `${basePath}/52991/characters`,
      recommendationsByMalId: `${basePath}/52991/recommendations`,
      resolveMalId: `${basePath}/resolve/52991`,

      // Access using Sokuja Slug
      animeBySlugSeason1: `${basePath}/anime/sousou-no-frieren-subtitle-indonesia`,
      animeBySlugSeason2: `${basePath}/anime/sousou-no-frieren-season-2-subtitle-indonesia`,
      episodesBySlug: `${basePath}/anime/sousou-no-frieren-subtitle-indonesia/episodes?page=1`,
      episodeStreamByAnimeSlug: `${basePath}/anime/sousou-no-frieren-subtitle-indonesia/episode/28`,
      episodeStreamByEpisodeSlug: `${basePath}/episode/end-sousou-no-frieren-episode-28-subtitle-indonesia`,

      // Catalog, Search, Schedule & Taxonomy
      home: `${basePath}/home?page=1`,
      latestUpdates: `${basePath}/latest?page=1`,
      search: `${basePath}/search?q=frieren&page=1`,
      browse: `${basePath}/browse?genre=fantasy&status=completed&type=tv&order=score&page=1`,
      ongoing: `${basePath}/ongoing?page=1`,
      completed: `${basePath}/completed?page=1`,
      movies: `${basePath}/movies?page=1`,
      topAnime: `${basePath}/top?type=score&page=1`,
      animeListAZ: `${basePath}/anime-list?letter=S`,
      schedule: `${basePath}/schedule?day=friday`,
      genres: `${basePath}/genres`,
      animeByGenre: `${basePath}/genre/action?page=1&order=score`,
      seasons: `${basePath}/seasons`,
      currentSeason: `${basePath}/season`,
      seasonBySlug: `${basePath}/season/winter-2026?page=1`,
      seasonByYear: `${basePath}/season/2023/fall?page=1`,
      studios: `${basePath}/studios`,
      animeByStudio: `${basePath}/studio/madhouse?page=1`,
      animeByCast: `${basePath}/cast/atsumi-tanezaki?page=1`,
      animeByDirector: `${basePath}/director/keiichirou-saitou?page=1`
    }
  });
});

// 1. Homepage (Featured, Latest Updates, Ongoing, Completed, Popular)
router.get('/home', async (req, res) => {
  const { page } = req.query;
  const data = await sokujaScraper.getHome({ page });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    data
  });
});

// 2. Latest Episode Updates
router.get('/latest', async (req, res) => {
  const { page } = req.query;
  const result = await sokujaScraper.getLatestUpdates({ page });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 3. Search Anime
router.get('/search', async (req, res) => {
  const { q, page } = req.query;
  const result = await sokujaScraper.search(q, { page });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 4. Browse / Filter Anime Directory
router.get('/browse', async (req, res) => {
  const { genre, studio, season, status, type, sub, order, page } = req.query;
  const result = await sokujaScraper.browseAnime({
    genre,
    studio,
    season,
    status,
    type,
    sub,
    order,
    page
  });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 5. Ongoing Anime
router.get('/ongoing', async (req, res) => {
  const { page, order } = req.query;
  const result = await sokujaScraper.getOngoingAnime({ page, order });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 6. Completed Anime
router.get('/completed', async (req, res) => {
  const { page, order } = req.query;
  const result = await sokujaScraper.getCompletedAnime({ page, order });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 7. Anime Movies
router.get('/movies', async (req, res) => {
  const { page, order } = req.query;
  const result = await sokujaScraper.getMovies({ page, order });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 8. Top / Popular Anime
router.get('/top', async (req, res) => {
  const { type, page } = req.query;
  const result = await sokujaScraper.getTopAnime({ type, page });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 9. Alphabetical Anime Directory A-Z (/anime/list-mode/)
router.get('/anime-list', async (req, res) => {
  const { letter } = req.query;
  const result = await sokujaScraper.getAnimeListAZ({ letter });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 10. Weekly Release Schedule (/jadwal-rilis-anime/)
router.get('/schedule', async (req, res) => {
  const { day } = req.query;
  const result = await sokujaScraper.getSchedule({ day });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 11. All Genres
router.get('/genres', async (req, res) => {
  const data = await sokujaScraper.getGenres();
  res.json({
    status: 'success',
    provider: 'sokujaId',
    total: data.length,
    data
  });
});

// 12. Anime by Genre Slug
router.get('/genre/:slug', async (req, res) => {
  const { slug } = req.params;
  const { page, order } = req.query;
  const result = await sokujaScraper.getAnimeByGenre(slug, { page, order });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 13. All Seasonal Archives
router.get('/seasons', async (req, res) => {
  const data = await sokujaScraper.getSeasons();
  res.json({
    status: 'success',
    provider: 'sokujaId',
    total: data.length,
    data
  });
});

// 14. Current / Latest Seasonal Anime
router.get('/season', async (req, res) => {
  const { page, order } = req.query;
  const result = await sokujaScraper.getSeasonalAnime({ page, order });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 15. Seasonal Anime by Year & Season (e.g. /season/2023/fall)
router.get('/season/:year/:season', async (req, res) => {
  const { year, season } = req.params;
  const { page, order } = req.query;
  const result = await sokujaScraper.getSeasonalAnime({ year, season, page, order });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 16. Seasonal Anime by Sokuja Season Slug (e.g. /season/winter-2026)
router.get('/season/:slug', async (req, res) => {
  const { slug } = req.params;
  const { page, order } = req.query;
  const result = await sokujaScraper.getSeasonalAnime(slug, { page, order });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 17. All Studios
router.get('/studios', async (req, res) => {
  const data = await sokujaScraper.getStudios();
  res.json({
    status: 'success',
    provider: 'sokujaId',
    total: data.length,
    data
  });
});

// 18. Anime by Studio / Producer Slug
router.get('/studio/:slug', async (req, res) => {
  const { slug } = req.params;
  const { page, order } = req.query;
  const result = await sokujaScraper.getAnimeByStudio(slug, { page, order });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

router.get('/producer/:slug', async (req, res) => {
  const { slug } = req.params;
  const { page, order } = req.query;
  const result = await sokujaScraper.getAnimeByProducer(slug, { page, order });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 19. Anime by Voice Actor / Cast Slug
router.get('/cast/:slug', async (req, res) => {
  const { slug } = req.params;
  const { page, order } = req.query;
  const result = await sokujaScraper.getAnimeByCast(slug, { page, order });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 20. Anime by Director Slug
router.get('/director/:slug', async (req, res) => {
  const { slug } = req.params;
  const { page, order } = req.query;
  const result = await sokujaScraper.getAnimeByDirector(slug, { page, order });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 21. Resolve MyAnimeList Numeric ID -> Sokuja Anime Slug
router.get('/resolve/:malId', async (req, res) => {
  const { malId } = req.params;
  const data = await sokujaScraper.resolveMalId(malId);
  res.json({
    status: 'success',
    provider: 'sokujaId',
    data
  });
});

// 22. Anime Detail, Episodes, Characters, Recommendations & Episode Stream via `/anime/:idOrSlug`
router.get('/anime/:idOrSlug', async (req, res) => {
  const { idOrSlug } = req.params;
  const data = await sokujaScraper.getAnimeDetail(idOrSlug);
  res.json({
    status: 'success',
    provider: 'sokujaId',
    data
  });
});

router.get('/anime/:idOrSlug/episodes', async (req, res) => {
  const { idOrSlug } = req.params;
  const { page, limit, order } = req.query;
  const result = await sokujaScraper.getAnimeEpisodes(idOrSlug, { page, limit, order });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

router.get('/anime/:idOrSlug/episode/:number', async (req, res) => {
  const { idOrSlug, number } = req.params;
  const data = await sokujaScraper.getAnimeEpisode(idOrSlug, number);
  res.json({
    status: 'success',
    provider: 'sokujaId',
    data
  });
});

router.get('/anime/:idOrSlug/characters', async (req, res) => {
  const { idOrSlug } = req.params;
  const data = await sokujaScraper.getAnimeCharacters(idOrSlug);
  res.json({
    status: 'success',
    provider: 'sokujaId',
    data
  });
});

router.get('/anime/:idOrSlug/recommendations', async (req, res) => {
  const { idOrSlug } = req.params;
  const result = await sokujaScraper.getAnimeRecommendations(idOrSlug);
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

// 23. Episode Detail, Streaming Video Mirrors & Downloads by Episode Slug
router.get('/episode/:slug', async (req, res) => {
  const { slug } = req.params;
  const data = await sokujaScraper.getEpisodeDetail(slug);
  res.json({
    status: 'success',
    provider: 'sokujaId',
    data
  });
});

// 24. Direct MyAnimeList ID (or Sokuja Slug) Routes at `/api/v1/sokujaId/:id`
// Example: GET /api/v1/sokujaId/52991 -> automatically links to sousou-no-frieren-subtitle-indonesia
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const data = await sokujaScraper.getAnimeDetail(id);
  res.json({
    status: 'success',
    provider: 'sokujaId',
    data
  });
});

router.get('/:id/episodes', async (req, res) => {
  const { id } = req.params;
  const { page, limit, order } = req.query;
  const result = await sokujaScraper.getAnimeEpisodes(id, { page, limit, order });
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

router.get('/:id/episode/:number', async (req, res) => {
  const { id, number } = req.params;
  const data = await sokujaScraper.getAnimeEpisode(id, number);
  res.json({
    status: 'success',
    provider: 'sokujaId',
    data
  });
});

router.get('/:id/characters', async (req, res) => {
  const { id } = req.params;
  const data = await sokujaScraper.getAnimeCharacters(id);
  res.json({
    status: 'success',
    provider: 'sokujaId',
    data
  });
});

router.get('/:id/recommendations', async (req, res) => {
  const { id } = req.params;
  const result = await sokujaScraper.getAnimeRecommendations(id);
  res.json({
    status: 'success',
    provider: 'sokujaId',
    ...result
  });
});

module.exports = router;


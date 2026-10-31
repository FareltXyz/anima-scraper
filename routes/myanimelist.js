const express = require('express');
const { AnimaScraper } = require('../scraper');

const router = express.Router();
const malScraper = new AnimaScraper({ provider: 'myanimelist' });

// Index / Endpoint Documentation for MyAnimeList
router.get('/', (req, res) => {
  const basePath = req.baseUrl || '/api/v1/myanimelist';
  res.json({
    status: 'success',
    provider: 'myanimelist',
    message: 'MyAnimeList Scraper REST API',
    endpoints: {
      search: `${basePath}/search?q=frieren&page=1`,
      topAnime: `${basePath}/top?type=all&page=1`,
      currentSeason: `${basePath}/season`,
      specificSeason: `${basePath}/season/2026/fall`,
      schedule: `${basePath}/schedule?day=friday`,
      genres: `${basePath}/genres`,
      animeByGenre: `${basePath}/genre/1?page=1`,
      animeByProducer: `${basePath}/producer/11?page=1`,
      animeDetail: `${basePath}/anime/52991`,
      animeEpisodes: `${basePath}/anime/52991/episodes?page=1`,
      animeCharacters: `${basePath}/anime/52991/characters`,
      animeRecommendations: `${basePath}/anime/52991/recommendations`
    }
  });
});

// 1. Search Anime
router.get('/search', async (req, res) => {
  const { q, page } = req.query;
  const result = await malScraper.search(q, { page });
  res.json({
    status: 'success',
    provider: 'myanimelist',
    ...result
  });
});

// 2. Top / Ranking Anime
router.get('/top', async (req, res) => {
  const { type, page } = req.query;
  const result = await malScraper.getTopAnime({ type, page });
  res.json({
    status: 'success',
    provider: 'myanimelist',
    ...result
  });
});

// 3. Current Seasonal Anime
router.get('/season', async (req, res) => {
  const { type } = req.query;
  const result = await malScraper.getSeasonalAnime({ type });
  res.json({
    status: 'success',
    provider: 'myanimelist',
    ...result
  });
});

// 4. Specific Year & Season Anime
router.get('/season/:year/:season', async (req, res) => {
  const { year, season } = req.params;
  const { type } = req.query;
  const result = await malScraper.getSeasonalAnime({ year, season, type });
  res.json({
    status: 'success',
    provider: 'myanimelist',
    ...result
  });
});

// 5. Weekly Airing Schedule
router.get('/schedule', async (req, res) => {
  const { day } = req.query;
  const result = await malScraper.getSchedule({ day });
  res.json({
    status: 'success',
    provider: 'myanimelist',
    ...result
  });
});

// 6. All Genres, Themes, Demographics & Studios
router.get('/genres', async (req, res) => {
  const data = await malScraper.getGenres();
  res.json({
    status: 'success',
    provider: 'myanimelist',
    data
  });
});

// 7. Anime by Genre ID
router.get('/genre/:id', async (req, res) => {
  const { id } = req.params;
  const { page } = req.query;
  const result = await malScraper.getAnimeByGenre(id, { page });
  res.json({
    status: 'success',
    provider: 'myanimelist',
    ...result
  });
});

// 8. Anime by Studio / Producer ID
router.get('/producer/:id', async (req, res) => {
  const { id } = req.params;
  const { page, limit } = req.query;
  const result = await malScraper.getAnimeByProducer(id, { page, limit });
  res.json({
    status: 'success',
    provider: 'myanimelist',
    ...result
  });
});

// 9. Anime Full Detail by ID
router.get('/anime/:id', async (req, res) => {
  const { id } = req.params;
  const data = await malScraper.getAnimeById(id);
  res.json({
    status: 'success',
    provider: 'myanimelist',
    data
  });
});

// 10. Anime Episodes by ID
router.get('/anime/:id/episodes', async (req, res) => {
  const { id } = req.params;
  const { page } = req.query;
  const result = await malScraper.getAnimeEpisodes(id, { page });
  res.json({
    status: 'success',
    provider: 'myanimelist',
    ...result
  });
});

// 11. Anime Characters & Staff by ID
router.get('/anime/:id/characters', async (req, res) => {
  const { id } = req.params;
  const data = await malScraper.getAnimeCharacters(id);
  res.json({
    status: 'success',
    provider: 'myanimelist',
    data
  });
});

// 12. Anime Recommendations by ID
router.get('/anime/:id/recommendations', async (req, res) => {
  const { id } = req.params;
  const result = await malScraper.getAnimeRecommendations(id);
  res.json({
    status: 'success',
    provider: 'myanimelist',
    ...result
  });
});

module.exports = router;

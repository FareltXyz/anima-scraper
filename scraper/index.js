const { MyAnimeList, ScraperError } = require('./providers/myanimelist');
const { SokujaId } = require('./providers/sokujaId');
const { MalSokujaLinker } = require('./malLinker');

const PROVIDERS = {
  myanimelist: MyAnimeList,
  sokujaId: SokujaId
};

function AnimaScraper(options = {}) {
  if (!(this instanceof AnimaScraper)) {
    return new AnimaScraper(options);
  }

  const providerName = options.provider || 'myanimelist';
  const Provider = PROVIDERS[providerName];

  if (!Provider) {
    throw new Error(
      `Unknown provider "${providerName}". Available providers: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }

  this.providerName = providerName;
  this.provider = new Provider(options);
}

AnimaScraper.prototype._callProvider = function _callProvider(methodName, args) {
  if (typeof this.provider[methodName] !== 'function') {
    return Promise.reject(
      new ScraperError(
        `Method "${methodName}" is not supported by provider "${this.providerName}".`,
        501
      )
    );
  }
  return this.provider[methodName](...args);
};

AnimaScraper.prototype.getHome = function getHome(options) {
  return this._callProvider('getHome', [options]);
};

AnimaScraper.prototype.getLatestUpdates = function getLatestUpdates(options) {
  return this._callProvider('getLatestUpdates', [options]);
};

AnimaScraper.prototype.search = function search(query, options) {
  return this._callProvider('search', [query, options]);
};

AnimaScraper.prototype.browseAnime = function browseAnime(options) {
  return this._callProvider('browseAnime', [options]);
};

AnimaScraper.prototype.getOngoingAnime = function getOngoingAnime(options) {
  return this._callProvider('getOngoingAnime', [options]);
};

AnimaScraper.prototype.getCompletedAnime = function getCompletedAnime(options) {
  return this._callProvider('getCompletedAnime', [options]);
};

AnimaScraper.prototype.getMovies = function getMovies(options) {
  return this._callProvider('getMovies', [options]);
};

AnimaScraper.prototype.getAnimeListAZ = function getAnimeListAZ(options) {
  return this._callProvider('getAnimeListAZ', [options]);
};

AnimaScraper.prototype.getTopAnime = function getTopAnime(options) {
  return this._callProvider('getTopAnime', [options]);
};

AnimaScraper.prototype.getSeasons = function getSeasons() {
  return this._callProvider('getSeasons', []);
};

AnimaScraper.prototype.getSeasonalAnime = function getSeasonalAnime(options, extraOptions) {
  return this._callProvider('getSeasonalAnime', [options, extraOptions]);
};

AnimaScraper.prototype.getSchedule = function getSchedule(options) {
  return this._callProvider('getSchedule', [options]);
};

AnimaScraper.prototype.resolveMalId = function resolveMalId(malId) {
  return this._callProvider('resolveMalId', [malId]);
};

AnimaScraper.prototype.getAnimeByMalId = function getAnimeByMalId(malId) {
  return this._callProvider('getAnimeByMalId', [malId]);
};

AnimaScraper.prototype.getAnimeEpisode = function getAnimeEpisode(idOrSlug, episodeNumber) {
  return this._callProvider('getAnimeEpisode', [idOrSlug, episodeNumber]);
};

AnimaScraper.prototype.getEpisodeByMalId = function getEpisodeByMalId(malId, episodeNumber) {
  return this._callProvider('getEpisodeByMalId', [malId, episodeNumber]);
};

AnimaScraper.prototype.getAnimeById = function getAnimeById(idOrSlug) {
  return this._callProvider('getAnimeById', [idOrSlug]);
};

AnimaScraper.prototype.getAnimeDetail = function getAnimeDetail(slug) {
  return this._callProvider('getAnimeDetail', [slug]);
};

AnimaScraper.prototype.getAnimeEpisodes = function getAnimeEpisodes(idOrSlug, options) {
  return this._callProvider('getAnimeEpisodes', [idOrSlug, options]);
};

AnimaScraper.prototype.getAnimeCharacters = function getAnimeCharacters(idOrSlug) {
  return this._callProvider('getAnimeCharacters', [idOrSlug]);
};

AnimaScraper.prototype.getAnimeRecommendations = function getAnimeRecommendations(idOrSlug) {
  return this._callProvider('getAnimeRecommendations', [idOrSlug]);
};

AnimaScraper.prototype.getEpisodeDetail = function getEpisodeDetail(episodeSlug) {
  return this._callProvider('getEpisodeDetail', [episodeSlug]);
};

AnimaScraper.prototype.getGenres = function getGenres() {
  return this._callProvider('getGenres', []);
};

AnimaScraper.prototype.getAnimeByGenre = function getAnimeByGenre(genreIdOrSlug, options) {
  return this._callProvider('getAnimeByGenre', [genreIdOrSlug, options]);
};

AnimaScraper.prototype.getStudios = function getStudios() {
  return this._callProvider('getStudios', []);
};

AnimaScraper.prototype.getAnimeByStudio = function getAnimeByStudio(studioSlug, options) {
  return this._callProvider('getAnimeByStudio', [studioSlug, options]);
};

AnimaScraper.prototype.getAnimeByProducer = function getAnimeByProducer(producerIdOrSlug, options) {
  return this._callProvider('getAnimeByProducer', [producerIdOrSlug, options]);
};

AnimaScraper.prototype.getAnimeByCast = function getAnimeByCast(castSlug, options) {
  return this._callProvider('getAnimeByCast', [castSlug, options]);
};

AnimaScraper.prototype.getAnimeByDirector = function getAnimeByDirector(directorSlug, options) {
  return this._callProvider('getAnimeByDirector', [directorSlug, options]);
};

module.exports = {
  AnimaScraper,
  MyAnimeList,
  SokujaId,
  MalSokujaLinker,
  ScraperError
};

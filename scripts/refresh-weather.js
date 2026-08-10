const { refreshWeather } = require('../server/weather');

refreshWeather({ force: true })
  .then((w) => {
    console.log('Weather refreshed', w.fetchedAt, w.placeName);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

# Odlat

Svensk odlingsapp för trädgårdsbäddar.

## Funktioner
- Kartlägg odlingsbäddar och planteringar
- Frökatalog (Plantagen-cache + reservdata)
- Väder via Open-Meteo (cache kl 03:00)
- Beräknat skördefönster och vattningsråd

## Utveckling
```bash
npm install
cd client && npm install && cd ..
npm run dev:server
npm run dev:client
```

## Produktion
```bash
cd client && npm run build && cd ..
NODE_ENV=production node server/index.js
```

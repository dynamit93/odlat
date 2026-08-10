async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  overview: () => request('/api/overview'),
  seeds: (q = '', category = '') => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    const qs = params.toString();
    return request(`/api/seeds${qs ? `?${qs}` : ''}`);
  },
  seedCategories: () => request('/api/seed-categories'),
  beds: () => request('/api/beds'),
  garden: () => request('/api/garden'),
  saveGarden: (body) => request('/api/garden', { method: 'PUT', body: JSON.stringify(body) }),
  createBed: (body) => request('/api/beds', { method: 'POST', body: JSON.stringify(body) }),
  updateBed: (id, body) => request(`/api/beds/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteBed: (id) => request(`/api/beds/${id}`, { method: 'DELETE' }),
  plantings: (bedId) => request(`/api/beds/${bedId}/plantings`),
  createPlanting: (body) => request('/api/plantings', { method: 'POST', body: JSON.stringify(body) }),
  updatePlanting: (id, body) => request(`/api/plantings/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePlanting: (id) => request(`/api/plantings/${id}`, { method: 'DELETE' }),
  settings: () => request('/api/settings'),
  saveSettings: (body) => request('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  weather: () => request('/api/weather'),
  refreshWeather: () => request('/api/weather/refresh', { method: 'POST' }),
  climate: () => request('/api/climate'),
  plantingAdvice: (seedId, plantedAt) =>
    request(
      `/api/planting-advice?seed_id=${encodeURIComponent(seedId)}&planted_at=${encodeURIComponent(plantedAt)}`
    ),
  importSeeds: () => request('/api/seeds/import', { method: 'POST' }),
};

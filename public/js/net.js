// Thin wrapper around the REST API.
const Net = (() => {
  async function api(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    me: () => api('GET', '/me'),
    register: (username, password) => api('POST', '/register', { username, password }),
    login: (username, password) => api('POST', '/login', { username, password }),
    logout: () => api('POST', '/logout'),

    listCharacters: () => api('GET', '/characters'),
    createCharacter: (name, cls) => api('POST', '/characters', { name, class: cls }),
    deleteCharacter: (id) => api('DELETE', `/characters/${id}`),
    loadCharacter: (id) => api('GET', `/characters/${id}`),

    save: (id, state) => api('POST', `/characters/${id}/save`, state),
    kill: (id, type) => api('POST', `/characters/${id}/kill`, { type }),
    death: (id) => api('POST', `/characters/${id}/death`),
    trap: (id, type) => api('POST', `/characters/${id}/trap`, { type }),

    equip: (id, itemId) => api('POST', `/characters/${id}/items/${itemId}/equip`),
    unequip: (id, itemId) => api('POST', `/characters/${id}/items/${itemId}/unequip`),
    usePotion: (id, itemId) => api('POST', `/characters/${id}/items/${itemId}/use`),
    dropItem: (id, itemId) => api('DELETE', `/characters/${id}/items/${itemId}`),

    // Fire-and-forget save for page unload.
    beaconSave(id, state) {
      navigator.sendBeacon(
        `/api/characters/${id}/save`,
        new Blob([JSON.stringify(state)], { type: 'application/json' })
      );
    },
  };
})();

const Storage = {
  KEY: 'linkvault_websites',

  async getAll() {
    return new Promise((resolve) => {
      chrome.storage.local.get([this.KEY], (result) => {
        resolve(result[this.KEY] || []);
      });
    });
  },

  async save(websites) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [this.KEY]: websites }, resolve);
    });
  },

  async add(entry) {
    const all = await this.getAll();
    const duplicate = all.find(w => w.url.trim().toLowerCase() === entry.url.trim().toLowerCase());
    if (duplicate) return { success: false, reason: 'duplicate' };
    const newEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      title: entry.title.trim(),
      url: entry.url.trim(),
      description: entry.description.trim(),
      tags: entry.tags,
      favorite: false,
      createdAt: Date.now()
    };
    all.push(newEntry);
    await this.save(all);
    return { success: true, entry: newEntry };
  },

  async update(id, changes) {
    const all = await this.getAll();
    const idx = all.findIndex(w => w.id === id);
    if (idx === -1) return false;
    all[idx] = { ...all[idx], ...changes };
    await this.save(all);
    return true;
  },

  async delete(id) {
    const all = await this.getAll();
    const filtered = all.filter(w => w.id !== id);
    await this.save(filtered);
  },

  async toggleFavorite(id) {
    const all = await this.getAll();
    const idx = all.findIndex(w => w.id === id);
    if (idx === -1) return;
    all[idx].favorite = !all[idx].favorite;
    await this.save(all);
    return all[idx].favorite;
  },

  async exportJSON() {
    const all = await this.getAll();
    return JSON.stringify(all, null, 2);
  },

  async importJSON(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      return { success: false, reason: 'invalid_json' };
    }
    if (!Array.isArray(parsed)) return { success: false, reason: 'not_array' };
    const valid = parsed.filter(e => e.url && e.title);
    if (valid.length === 0) return { success: false, reason: 'no_valid_entries' };
    const existing = await this.getAll();
    const existingUrls = new Set(existing.map(e => e.url.trim().toLowerCase()));
    let added = 0;
    for (const e of valid) {
      if (!existingUrls.has(e.url.trim().toLowerCase())) {
        existing.push({
          id: e.id || Date.now().toString(36) + Math.random().toString(36).slice(2),
          title: e.title || '',
          url: e.url || '',
          description: e.description || '',
          tags: Array.isArray(e.tags) ? e.tags : [],
          favorite: !!e.favorite,
          createdAt: e.createdAt || Date.now()
        });
        existingUrls.add(e.url.trim().toLowerCase());
        added++;
      }
    }
    await this.save(existing);
    return { success: true, added, skipped: valid.length - added };
  }
};

window.Storage = Storage;


(() => {
  // ── State ──
  let allWebsites = [];
  let searchQuery = '';
  let editingId = null;

  // ── DOM Refs ──
  const $ = id => document.getElementById(id);
  const inTitle = $('inTitle'), inUrl = $('inUrl'), inDesc = $('inDesc'), inTags = $('inTags');
  const saveBtn = $('saveBtn'), clearBtn = $('clearBtn');
  const feedbackMsg = $('vaultFeedbackMsg');
  const searchInput = $('searchInput'), searchClear = $('searchClear');
  const cardList = $('cardList'), emptyState = $('emptyState');
  const statTotal = $('statTotal'), statFavs = $('statFavs'), statTags = $('statTags');
  const exportBtn = $('exportBtn'), importLabel = $('importLabel'), importInput = $('importInput');
  const editModal = $('editModal');
  const editTitle = $('editTitle'), editUrl = $('editUrl'), editDesc = $('editDesc'), editTags = $('editTags');
  const saveEdit = $('saveEdit'), cancelEdit = $('cancelEdit'), modalClose = $('modalClose');
  const toast = $('toast');

  // ── Toast ──
  let toastTimer;
  function showToast(msg, type = '') {
    clearTimeout(toastTimer);
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'toast show' + (type ? ` toast-${type}` : '');
    toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2400);
  }

  // ── Init ──
  async function init() {
    allWebsites = await Storage.getAll();
    await prefillFromTab();
    renderAll();
  }

  async function prefillFromTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        if (!inTitle.value) inTitle.value = tab.title || '';
        if (!inUrl.value) inUrl.value = tab.url || '';
      }
    } catch {}
  }

  // ── Stats ──
  function updateStats(data) {
    if (statTotal) statTotal.textContent = data.length;
    if (statFavs) statFavs.textContent = data.filter(w => w.favorite).length;
    const allTags = new Set(data.flatMap(w => w.tags));
    if (statTags) statTags.textContent = allTags.size;
  }

  // ── Render ──
  function getFiltered() {
    if (!searchQuery) return [...allWebsites];
    const q = searchQuery.toLowerCase();
    return allWebsites.filter(w =>
      w.title.toLowerCase().includes(q) ||
      w.description.toLowerCase().includes(q) ||
      w.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  function renderAll() {
    updateStats(allWebsites);
    const filtered = getFiltered();

    if (allWebsites.length === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      if (cardList) cardList.innerHTML = '';
      return;
    }
    if (emptyState) emptyState.style.display = 'none';

    if (filtered.length === 0) {
      if (cardList) cardList.innerHTML = `<div class="no-results">No matches found<span>Try different keywords or tags</span></div>`;
      return;
    }

    const favs = filtered.filter(w => w.favorite);
    const rest = filtered.filter(w => !w.favorite);
    const ordered = [...favs, ...rest];

    let html = '';

    if (favs.length > 0 && rest.length > 0) {
      html += renderCards(favs);
      html += `<div class="section-label">All</div>`;
      html += renderCards(rest);
    } else {
      html += renderCards(ordered);
    }

    if (cardList) {
      cardList.innerHTML = html;
      attachCardEvents();
    }
  }

  function renderCards(list) {
    return list.map(w => {
      const tagsHtml = w.tags.length
        ? w.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')
        : '';
      const favClass = w.favorite ? 'active' : '';
      const favIcon = w.favorite ? '★' : '☆';
      const cardClass = w.favorite ? 'card is-fav' : 'card';
      const dateStr = formatDate(w.createdAt);
      const shortUrl = truncateUrl(w.url);

      return `
        <div class="${cardClass}" data-id="${w.id}">
          <div class="card-top">
            <span class="card-title">${escHtml(w.title)}</span>
            ${w.favorite ? '<span class="card-fav-indicator">★</span>' : ''}
          </div>
          <a class="card-url" href="${escHtml(w.url)}" target="_blank" title="${escHtml(w.url)}">${escHtml(shortUrl)}</a>
          ${w.description ? `<div class="card-desc">${escHtml(w.description)}</div>` : ''}
          ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
          <div class="card-actions">
            <span class="card-date">${dateStr}</span>
            <button class="card-btn btn-open" data-action="open" data-id="${w.id}">Open</button>
            <button class="card-btn btn-edit" data-action="edit" data-id="${w.id}">Edit</button>
            <button class="card-btn btn-fav ${favClass}" data-action="fav" data-id="${w.id}" title="Toggle favorite">${favIcon}</button>
            <button class="card-btn btn-delete" data-action="delete" data-id="${w.id}" title="Delete">✕</button>
          </div>
        </div>`;
    }).join('');
  }

  function attachCardEvents() {
    if (!cardList) return;
    cardList.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', handleCardAction);
    });
  }

  async function handleCardAction(e) {
    const btn = e.currentTarget;
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'open') {
      const w = allWebsites.find(x => x.id === id);
      if (w) chrome.tabs.create({ url: w.url });
    }

    if (action === 'edit') {
      openEditModal(id);
    }

    if (action === 'fav') {
      await Storage.toggleFavorite(id);
      allWebsites = await Storage.getAll();
      renderAll();
    }

    if (action === 'delete') {
      await Storage.delete(id);
      allWebsites = await Storage.getAll();
      renderAll();
      showToast('Deleted.', 'error');
    }
  }

  // ── Save ──
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const title = inTitle.value.trim();
      const url = inUrl.value.trim();
      const description = inDesc.value.trim();
      const tags = parseTags(inTags.value);

      if (!title || !url) {
        setFeedback('Title and URL are required.', 'error');
        return;
      }

      if (!isValidUrl(url)) {
        setFeedback('Enter a valid URL.', 'error');
        return;
      }

      const result = await Storage.add({ title, url, description, tags });

      if (!result.success) {
        if (result.reason === 'duplicate') {
          setFeedback('Website already saved.', 'error');
        }
        return;
      }

      allWebsites = await Storage.getAll();
      renderAll();
      clearForm();
      setFeedback('Saved!', 'success');
      setTimeout(() => setFeedback('', ''), 2000);
      showToast(`"${title}" saved.`, 'success');
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearForm();
      setFeedback('', '');
    });
  }

  function clearForm() {
    if (inTitle) inTitle.value = '';
    if (inUrl) inUrl.value = '';
    if (inDesc) inDesc.value = '';
    if (inTags) inTags.value = '';
  }

  function setFeedback(msg, type) {
    if (!feedbackMsg) return;
    feedbackMsg.textContent = msg;
    feedbackMsg.className = 'feedback-msg' + (type ? ` ${type}` : '');
  }

  // ── Search ──
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim();
      if (searchClear) searchClear.style.display = searchQuery ? 'block' : 'none';
      renderAll();
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      searchQuery = '';
      searchClear.style.display = 'none';
      renderAll();
    });
  }

  // ── Edit Modal ──
  function openEditModal(id) {
    const w = allWebsites.find(x => x.id === id);
    if (!w || !editModal) return;
    editingId = id;
    if (editTitle) editTitle.value = w.title;
    if (editUrl) editUrl.value = w.url;
    if (editDesc) editDesc.value = w.description;
    if (editTags) editTags.value = w.tags.join(', ');
    editModal.style.display = 'flex';
    if (editTitle) editTitle.focus();
  }

  function closeEditModal() {
    if (editModal) editModal.style.display = 'none';
    editingId = null;
  }

  if (saveEdit) {
    saveEdit.addEventListener('click', async () => {
      if (!editingId) return;
      const title = editTitle.value.trim();
      const url = editUrl.value.trim();
      if (!title || !url) { showToast('Title and URL required.', 'error'); return; }
      if (!isValidUrl(url)) { showToast('Invalid URL.', 'error'); return; }

      await Storage.update(editingId, {
        title,
        url,
        description: editDesc.value.trim(),
        tags: parseTags(editTags.value)
      });

      allWebsites = await Storage.getAll();
      renderAll();
      closeEditModal();
      showToast('Changes saved.', 'success');
    });
  }

  if (cancelEdit) cancelEdit.addEventListener('click', closeEditModal);
  if (modalClose) modalClose.addEventListener('click', closeEditModal);

  if (editModal) {
    editModal.addEventListener('click', e => {
      if (e.target === editModal) closeEditModal();
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && editModal && editModal.style.display !== 'none') closeEditModal();
  });

  // ── Export ──
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      const json = await Storage.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `linkvault-export-${dateStamp()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exported successfully.', 'success');
    });
  }

  // ── Import ──
  if (importInput) {
    importInput.addEventListener('change', async () => {
      const file = importInput.files[0];
      if (!file) return;
      const text = await file.text();
      const result = await Storage.importJSON(text);
      importInput.value = '';
      if (!result.success) {
        showToast(`Import failed: ${result.reason}`, 'error');
        return;
      }
      allWebsites = await Storage.getAll();
      renderAll();
      showToast(`Imported ${result.added} entries. Skipped ${result.skipped} duplicates.`, 'success');
    });
  }

  // ── Helpers ──
  function parseTags(str) {
    return str.split(',')
      .map(t => t.trim().toLowerCase().replace(/\s+/g, '-'))
      .filter(t => t.length > 0);
  }

  function isValidUrl(str) {
    try {
      const u = new URL(str);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function truncateUrl(url) {
    try {
      const u = new URL(url);
      const display = u.hostname + (u.pathname !== '/' ? u.pathname : '');
      return display.length > 48 ? display.slice(0, 45) + '…' : display;
    } catch {
      return url.length > 48 ? url.slice(0, 45) + '…' : url;
    }
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(2);
    return `${dd}/${mm}/${yy}`;
  }

  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  }

  // Expose hooks for tab switching
  window.linkVaultPrefill = prefillFromTab;
  window.linkVaultRender = renderAll;

  // ── Boot ──
  init();
})();

(() => {
  'use strict';

  /* ============ Storage helpers ============ */
  const LS_LISTS = 'blindspin.lists.v1';
  const LS_NAMES = 'blindspin.names.v1';
  const LS_HISTORY = 'blindspin.history.v1';

  const loadJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  };
  const saveJSON = (key, val) => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage full or unavailable */ }
  };

  let lists = loadJSON(LS_LISTS, { you365: [], youAll: [], friend365: [], friendAll: [] });
  let names = loadJSON(LS_NAMES, { you: 'You', friend: 'Friend' });
  let history = loadJSON(LS_HISTORY, []);

  /* ============ Parsing ============ */
  // Accepts lines like:
  //   Artist - Track
  //   Artist \t Track \t Playcount
  //   Track by Artist
  // Falls back to treating the whole line as the track with unknown artist.
  function parseLines(text) {
    if (!text) return [];
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      let artist = '', track = '';
      if (line.includes('\t')) {
        const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) { artist = parts[0]; track = parts[1]; }
        else { track = parts[0]; }
      } else if (line.includes(' - ')) {
        const idx = line.indexOf(' - ');
        artist = line.slice(0, idx).trim();
        track = line.slice(idx + 3).trim();
      } else if (/ by /i.test(line)) {
        const idx = line.search(/ by /i);
        track = line.slice(0, idx).trim();
        artist = line.slice(idx + 4).trim();
      } else {
        track = line;
        artist = 'Unknown artist';
      }
      // strip common trailing playcount markers like "(123 plays)" or "- 123"
      track = track.replace(/\s*\(\d+\s*plays?\)\s*$/i, '').trim();
      artist = artist.replace(/\s*\(\d+\s*plays?\)\s*$/i, '').trim();
      if (track) out.push({ artist: artist || 'Unknown artist', track });
    }
    return dedupe(out);
  }

  function dedupe(arr) {
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      const key = (item.artist + '::' + item.track).toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(item); }
    }
    return out;
  }

  function combine(a, b) {
    return dedupe([...a, ...b]);
  }

  /* ============ DOM refs ============ */
  const screens = {
    setup: document.getElementById('screen-setup'),
    game: document.getElementById('screen-game'),
    results: document.getElementById('screen-results'),
    history: document.getElementById('screen-history'),
  };
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const slots = ['you365', 'youAll', 'friend365', 'friendAll'];

  /* ============ Setup screen wiring ============ */
  function refreshUploadUI() {
    slots.forEach(slot => {
      const count = lists[slot] ? lists[slot].length : 0;
      const el = document.getElementById('count-' + slot);
      el.textContent = count > 0 ? count + ' tracks loaded' : 'no file loaded';
    });
    document.getElementById('name-you').value = names.you;
    document.getElementById('name-friend').value = names.friend;
    // restore paste areas if we have raw text cached? we only store parsed, so leave blank.
    renderCategories();
  }

  slots.forEach(slot => {
    const fileInput = document.getElementById('file-' + slot);
    const pasteArea = document.getElementById('paste-' + slot);

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const parsed = parseLines(String(reader.result));
        lists[slot] = parsed;
        saveJSON(LS_LISTS, lists);
        pasteArea.value = '';
        refreshUploadUI();
      };
      reader.readAsText(file);
    });

    pasteArea.addEventListener('input', debounce(() => {
      const parsed = parseLines(pasteArea.value);
      if (parsed.length > 0) {
        lists[slot] = parsed;
        saveJSON(LS_LISTS, lists);
        refreshUploadUI();
      }
    }, 400));
  });

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  ['name-you', 'name-friend'].forEach(id => {
    document.getElementById(id).addEventListener('input', debounce(() => {
      names.you = document.getElementById('name-you').value.trim() || 'You';
      names.friend = document.getElementById('name-friend').value.trim() || 'Friend';
      saveJSON(LS_NAMES, names);
      renderCategories();
    }, 300));
  });

  function getCategories() {
    const combined365 = combine(lists.you365, lists.friend365);
    const combinedAll = combine(lists.youAll, lists.friendAll);
    return [
      { id: 'you365', title: `${names.you} — Last 365 days`, tracks: lists.you365 },
      { id: 'youAll', title: `${names.you} — All-time`, tracks: lists.youAll },
      { id: 'friend365', title: `${names.friend} — Last 365 days`, tracks: lists.friend365 },
      { id: 'friendAll', title: `${names.friend} — All-time`, tracks: lists.friendAll },
      { id: 'combined365', title: `Combined — Last 365 days`, tracks: combined365 },
      { id: 'combinedAll', title: `Combined — All-time`, tracks: combinedAll },
      { id: 'top100', title: `Top 100 — Combined all-time`, tracks: combinedAll.slice(0, 100) },
      { id: 'top1000', title: `Top 1000 — Combined all-time`, tracks: combinedAll.slice(0, 1000) },
    ];
  }

  function renderCategories() {
    const grid = document.getElementById('category-grid');
    grid.innerHTML = '';
    getCategories().forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'category-card';
      btn.type = 'button';
      btn.disabled = cat.tracks.length === 0;
      btn.innerHTML = `<span class="cc-title">${escapeHtml(cat.title)}</span><span class="cc-count">${cat.tracks.length} tracks</span>`;
      btn.addEventListener('click', () => startGame(cat));
      grid.appendChild(btn);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ============ Game state ============ */
  let game = null; // { categoryId, categoryTitle, queue: [...], index, results: [] }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startGame(cat) {
    game = {
      categoryId: cat.id,
      categoryTitle: cat.title,
      queue: shuffle(cat.tracks),
      index: 0,
      results: [],
    };
    showScreen('game');
    document.getElementById('category-label').textContent = cat.title;
    renderCurrentTrack();
  }

  const recordBtn = document.getElementById('record');
  const revealHint = document.getElementById('reveal-hint');
  const ratingPanel = document.getElementById('rating-panel');
  const meterValue = document.getElementById('meter-value');

  function renderCurrentTrack() {
    const total = game.queue.length;
    const pos = game.index + 1;
    document.getElementById('progress-label').textContent =
      `Track ${String(pos).padStart(2, '0')} / ${total}`;
    document.getElementById('progress-fill').style.width = `${(game.index / total) * 100}%`;

    recordBtn.classList.remove('revealed');
    ratingPanel.classList.add('hidden');
    revealHint.textContent = 'Click the record to reveal';
    revealHint.style.display = '';
    document.getElementById('record-artist').textContent = '';
    document.getElementById('record-track').textContent = '';
    meterValue.textContent = '—';
    buildMeter(null);
  }

  recordBtn.addEventListener('click', () => {
    if (recordBtn.classList.contains('revealed')) return;
    const current = game.queue[game.index];
    recordBtn.classList.add('revealed');
    document.getElementById('record-artist').textContent = current.artist;
    document.getElementById('record-track').textContent = current.track;
    revealHint.style.display = 'none';
    ratingPanel.classList.remove('hidden');
  });

  function buildMeter(selected) {
    const meter = document.getElementById('meter');
    meter.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const bar = document.createElement('div');
      bar.className = 'meter-bar';
      bar.style.height = `${18 + i * 5}px`;
      bar.textContent = i;
      bar.dataset.val = i;
      if (selected !== null && i <= selected) {
        bar.classList.add('lit');
        if (i >= 8) bar.classList.add('high');
      }
      bar.addEventListener('click', () => onRate(i));
      meter.appendChild(bar);
    }
  }

  function onRate(score) {
    buildMeter(score);
    meterValue.textContent = score + ' / 10';
    const current = game.queue[game.index];
    game.results.push({ artist: current.artist, track: current.track, rating: score });

    setTimeout(() => {
      game.index++;
      if (game.index >= game.queue.length) {
        finishGame();
      } else {
        renderCurrentTrack();
      }
    }, 450);
  }

  document.getElementById('btn-end-early').addEventListener('click', () => {
    if (!game) return;
    if (game.results.length === 0) {
      showScreen('setup');
      return;
    }
    if (confirm('End this session now? Songs not yet rated will be left out of the results.')) {
      finishGame();
    }
  });

  function finishGame() {
    const complete = game.index >= game.queue.length;
    const entry = {
      categoryId: game.categoryId,
      categoryTitle: game.categoryTitle,
      date: new Date().toISOString(),
      complete,
      ratedCount: game.results.length,
      totalCount: game.queue.length,
      results: game.results.slice().sort((a, b) => b.rating - a.rating || a.artist.localeCompare(b.artist)),
    };
    history.unshift(entry);
    saveJSON(LS_HISTORY, history);
    renderResults(entry);
  }

  /* ============ Results screen ============ */
  let currentResultsEntry = null;

  function renderResults(entry) {
    currentResultsEntry = entry;
    document.getElementById('results-title').textContent = entry.categoryTitle;
    document.getElementById('results-eyebrow').textContent =
      entry.complete ? 'Session complete' : `Ended early — ${entry.ratedCount}/${entry.totalCount} rated`;

    const list = document.getElementById('results-list');
    list.innerHTML = '';
    entry.results.forEach(r => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="r-info">
          <div class="r-artist">${escapeHtml(r.artist)}</div>
          <div class="r-track">${escapeHtml(r.track)}</div>
        </div>
        <div class="r-score">${r.rating}</div>
      `;
      list.appendChild(li);
    });
    showScreen('results');
  }

  document.getElementById('btn-play-again').addEventListener('click', () => {
    refreshUploadUI();
    showScreen('setup');
  });

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    if (!currentResultsEntry) return;
    let csv = 'rank,artist,track,rating\n';
    currentResultsEntry.results.forEach((r, i) => {
      csv += `${i + 1},"${r.artist.replace(/"/g, '""')}","${r.track.replace(/"/g, '""')}",${r.rating}\n`;
    });
    downloadFile(csv, sanitizeFilename(currentResultsEntry.categoryTitle) + '.csv', 'text/csv');
  });

  document.getElementById('btn-export-json').addEventListener('click', () => {
    if (!currentResultsEntry) return;
    downloadFile(JSON.stringify(currentResultsEntry, null, 2), sanitizeFilename(currentResultsEntry.categoryTitle) + '.json', 'application/json');
  });

  document.getElementById('btn-copy').addEventListener('click', async () => {
    if (!currentResultsEntry) return;
    const text = currentResultsEntry.results
      .map((r, i) => `${i + 1}. ${r.artist} — ${r.track} (${r.rating}/10)`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById('btn-copy');
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = original; }, 1200);
    } catch (e) {
      alert('Could not copy automatically — select and copy the results manually.');
    }
  });

  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function sanitizeFilename(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  /* ============ History screen ============ */
  document.getElementById('btn-history').addEventListener('click', () => {
    renderHistory();
    showScreen('history');
  });
  document.getElementById('btn-history-back').addEventListener('click', () => showScreen('setup'));

  function renderHistory() {
    const wrap = document.getElementById('history-list');
    wrap.innerHTML = '';
    if (history.length === 0) {
      wrap.innerHTML = '<p class="empty-note">No sessions played yet.</p>';
      return;
    }
    history.forEach(entry => {
      const div = document.createElement('div');
      div.className = 'history-item';
      const dt = new Date(entry.date);
      div.innerHTML = `
        <div>
          <div class="hi-cat">${escapeHtml(entry.categoryTitle)}</div>
          <div class="hi-meta">${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} · ${entry.ratedCount}/${entry.totalCount} rated${entry.complete ? '' : ' (ended early)'}</div>
        </div>
      `;
      div.addEventListener('click', () => renderResults(entry));
      wrap.appendChild(div);
    });
  }

  /* ============ Reset ============ */
  document.getElementById('btn-reset-all').addEventListener('click', () => {
    if (!confirm('This clears all loaded lists and session history from this browser. Continue?')) return;
    localStorage.removeItem(LS_LISTS);
    localStorage.removeItem(LS_NAMES);
    localStorage.removeItem(LS_HISTORY);
    lists = { you365: [], youAll: [], friend365: [], friendAll: [] };
    names = { you: 'You', friend: 'Friend' };
    history = [];
    slots.forEach(slot => { document.getElementById('paste-' + slot).value = ''; document.getElementById('file-' + slot).value = ''; });
    refreshUploadUI();
    showScreen('setup');
  });

  /* ============ Init ============ */
  refreshUploadUI();
})();

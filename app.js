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

  /* ============ Auto-load from repo's data/ folder ============ */
  const REPO_FILES = {
    you365: 'data/you-365.txt',
    youAll: 'data/you-alltime.txt',
    friend365: 'data/friend-365.txt',
    friendAll: 'data/friend-alltime.txt',
  };
  // tracks whether each slot's current list came from the repo or a manual upload/paste this session
  const sources = { you365: null, youAll: null, friend365: null, friendAll: null };

  async function loadRepoFile(slot) {
    try {
      const res = await fetch(REPO_FILES[slot] + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return false;
      const text = await res.text();
      const parsed = parseLines(text);
      if (parsed.length === 0) return false;
      lists[slot] = parsed;
      sources[slot] = 'repo';
      saveJSON(LS_LISTS, lists);
      return true;
    } catch (e) {
      return false; // e.g. opened via file:// with no server, or file not committed yet
    }
  }

  async function loadAllRepoFiles({ silent } = {}) {
    const statusEl = document.getElementById('repo-status');
    if (!silent && statusEl) statusEl.textContent = 'Checking data/ folder…';
    const results = await Promise.all(slots.map(loadRepoFile));
    const foundCount = results.filter(Boolean).length;
    if (statusEl) {
      statusEl.textContent = foundCount > 0
        ? `Loaded ${foundCount}/4 files from data/.`
        : `No files found in data/ yet — commit them there, or upload/paste below for now.`;
    }
    refreshUploadUI();
  }

  document.getElementById('btn-reload-repo').addEventListener('click', () => loadAllRepoFiles());

  /* ============ Live fetch from last.fm (client-side, JSONP — no backend) ============ */
  const LS_APIKEY = 'blindspin.lastfm.apikey.v1';
  const LS_LFM_USERS = 'blindspin.lastfm.users.v1';

  // JSONP: last.fm doesn't send CORS headers for fetch()/XHR, but it does support
  // the classic ?callback= JSONP pattern, which works fine from a static page.
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cbName = 'lastfmCb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timeoutId = setTimeout(() => { cleanup(); reject(new Error('Request to last.fm timed out')); }, 15000);
      function cleanup() {
        delete window[cbName];
        script.remove();
        clearTimeout(timeoutId);
      }
      window[cbName] = (data) => { cleanup(); resolve(data); };
      script.onerror = () => { cleanup(); reject(new Error('Network error contacting last.fm')); };
      const sep = url.includes('?') ? '&' : '?';
      script.src = url + sep + 'callback=' + cbName;
      document.body.appendChild(script);
    });
  }

  async function fetchTopTracks(username, period, apiKey, limit = 1000) {
    let all = [];
    let page = 1;
    while (all.length < limit) {
      const url = `https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=${encodeURIComponent(username)}&period=${period}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=1000&page=${page}`;
      const data = await jsonp(url);
      if (data.error) throw new Error(data.message || `last.fm error ${data.error}`);
      let tracks = (data.toptracks && data.toptracks.track) || [];
      if (!Array.isArray(tracks)) tracks = [tracks];
      if (tracks.length === 0) break;
      all.push(...tracks);
      const attr = (data.toptracks && data.toptracks['@attr']) || {};
      const totalPages = parseInt(attr.totalPages || '1', 10);
      if (page >= totalPages || page >= 5) break; // cap at 5 pages (~5000 tracks) as a safety limit
      page++;
    }
    return all.slice(0, limit).map(t => ({
      artist: (t.artist && (t.artist.name || t.artist['#text'])) || 'Unknown artist',
      track: t.name,
    }));
  }

  function setLastfmStatus(msg, isError) {
    const el = document.getElementById('lastfm-status');
    el.textContent = msg;
    el.style.color = isError ? 'var(--red)' : '';
  }

  function initLastfmFields() {
    const configKey = (window.BLINDSPIN_CONFIG && window.BLINDSPIN_CONFIG.lastfmApiKey) || '';
    const apiKey = loadJSON(LS_APIKEY, '') || configKey;
    const users = loadJSON(LS_LFM_USERS, { you: '', friend: '' });
    document.getElementById('lastfm-apikey').value = apiKey;
    document.getElementById('lastfm-you').value = users.you;
    document.getElementById('lastfm-friend').value = users.friend;
  }

  document.getElementById('btn-fetch-lastfm').addEventListener('click', async () => {
    const btn = document.getElementById('btn-fetch-lastfm');
    const apiKey = document.getElementById('lastfm-apikey').value.trim();
    const youUser = document.getElementById('lastfm-you').value.trim();
    const friendUser = document.getElementById('lastfm-friend').value.trim();

    if (!apiKey) { setLastfmStatus('Add a last.fm API key first — get one free at the link above.', true); return; }
    if (!youUser && !friendUser) { setLastfmStatus('Enter at least one last.fm username.', true); return; }

    saveJSON(LS_APIKEY, apiKey);
    saveJSON(LS_LFM_USERS, { you: youUser, friend: friendUser });

    const jobs = [];
    if (youUser) { jobs.push(['you365', youUser, '12month']); jobs.push(['youAll', youUser, 'overall']); }
    if (friendUser) { jobs.push(['friend365', friendUser, '12month']); jobs.push(['friendAll', friendUser, 'overall']); }

    btn.disabled = true;
    let successCount = 0;
    let firstError = null;
    for (const [slot, user, period] of jobs) {
      setLastfmStatus(`Fetching ${successCount + 1}/${jobs.length} — ${user} (${period === 'overall' ? 'all-time' : 'last 365 days'})…`);
      try {
        const tracks = await fetchTopTracks(user, period, apiKey, 1000);
        if (tracks.length === 0) throw new Error(`no tracks found for "${user}" — check the username`);
        lists[slot] = dedupe(tracks);
        sources[slot] = 'lastfm';
        successCount++;
      } catch (e) {
        firstError = e.message;
      }
    }
    saveJSON(LS_LISTS, lists);
    btn.disabled = false;
    refreshUploadUI();

    if (successCount === jobs.length) {
      setLastfmStatus(`Loaded ${successCount} list${successCount > 1 ? 's' : ''} from last.fm.`);
    } else if (successCount > 0) {
      setLastfmStatus(`Loaded ${successCount}/${jobs.length} lists — ${firstError}`, true);
    } else {
      setLastfmStatus(`Couldn't load from last.fm — ${firstError}`, true);
    }
  });

  /* ============ Setup screen wiring ============ */
  function refreshUploadUI() {
    slots.forEach(slot => {
      const count = lists[slot] ? lists[slot].length : 0;
      const el = document.getElementById('count-' + slot);
      if (count === 0) {
        el.textContent = 'no file loaded';
      } else if (sources[slot] === 'repo') {
        el.textContent = `${count} tracks (from repo)`;
      } else if (sources[slot] === 'lastfm') {
        el.textContent = `${count} tracks (from last.fm)`;
      } else {
        el.textContent = `${count} tracks (uploaded this session)`;
      }
    });
    document.getElementById('name-you').value = names.you;
    document.getElementById('name-friend').value = names.friend;
    // restore paste areas if we have raw text cached? we only store parsed, so leave blank.
    renderQueryBuilder();
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
        sources[slot] = 'manual';
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
        sources[slot] = 'manual';
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
      renderQueryBuilder();
    }, 300));
  });

  function buildList(who, period) {
    if (period === '365') {
      if (who === 'you') return lists.you365;
      if (who === 'friend') return lists.friend365;
      return combine(lists.you365, lists.friend365);
    }
    if (period === 'all') {
      if (who === 'you') return lists.youAll;
      if (who === 'friend') return lists.friendAll;
      return combine(lists.youAll, lists.friendAll);
    }
    // 'everything' — both periods merged
    if (who === 'you') return combine(lists.you365, lists.youAll);
    if (who === 'friend') return combine(lists.friend365, lists.friendAll);
    return combine(combine(lists.you365, lists.friend365), combine(lists.youAll, lists.friendAll));
  }

  function buildCategory(who, period, topN) {
    const full = buildList(who, period);
    const tracks = topN === 'all' ? full : full.slice(0, parseInt(topN, 10));
    const whoLabel = who === 'you' ? names.you : who === 'friend' ? names.friend : 'Combined';
    const periodLabel = period === '365' ? 'Last 365 days' : period === 'all' ? 'All-time' : 'Everything';
    const topLabel = topN === 'all' ? 'All tracks' : `Top ${topN}`;
    return { id: `${who}-${period}-${topN}`, title: `${whoLabel} — ${periodLabel} — ${topLabel}`, tracks, fullCount: full.length };
  }

  function renderQueryBuilder() {
    const whoSelect = document.getElementById('qb-who');
    whoSelect.options[0].textContent = names.you;
    whoSelect.options[1].textContent = names.friend;

    const who = whoSelect.value;
    const period = document.getElementById('qb-period').value;
    const topN = document.getElementById('qb-topn').value;
    const cat = buildCategory(who, period, topN);
    const countEl = document.getElementById('qb-count');
    const startBtn = document.getElementById('btn-start-session');

    if (cat.fullCount === 0) {
      countEl.textContent = 'No tracks loaded for this selection yet — load lists in Step 1 above.';
      startBtn.disabled = true;
    } else {
      countEl.textContent = `${cat.tracks.length} of ${cat.fullCount} available tracks will be used.`;
      startBtn.disabled = false;
    }
  }

  ['qb-who', 'qb-period', 'qb-topn'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderQueryBuilder);
  });

  document.getElementById('btn-start-session').addEventListener('click', () => {
    const who = document.getElementById('qb-who').value;
    const period = document.getElementById('qb-period').value;
    const topN = document.getElementById('qb-topn').value;
    const cat = buildCategory(who, period, topN);
    if (cat.tracks.length === 0) return;
    startGame(cat);
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ============ Game state ============ */
  let game = null; // { categoryId, categoryTitle, queue: [...], index, positions: [10 x (null|{artist,track})] }

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
      positions: new Array(10).fill(null),
    };
    showScreen('game');
    document.getElementById('category-label').textContent = cat.title;
    renderCurrentTrack();
  }

  const recordBtn = document.getElementById('record');
  const revealHint = document.getElementById('reveal-hint');
  const skipBtn = document.getElementById('btn-skip');
  const albumArt = document.getElementById('album-art');
  const albumArtPlaceholder = document.getElementById('album-art-placeholder');
  albumArt.addEventListener('error', () => {
    albumArt.classList.remove('has-src');
    albumArtPlaceholder.classList.remove('hidden');
  });
  const ytEmbed = document.getElementById('yt-embed');
  const ytStatus = document.getElementById('yt-status');

  function filledCount() {
    return game.positions.filter(Boolean).length;
  }

  function renderRankList(clickable) {
    const list = document.getElementById('rank-list');
    list.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const slot = game.positions[i];
      const li = document.createElement('li');
      li.className = 'rank-row' + (slot ? ' filled' : (clickable ? ' clickable' : ''));
      if (slot) {
        li.innerHTML = `<span class="rank-num">${i + 1}</span><span class="rank-info"><span class="rank-artist">${escapeHtml(slot.artist)}</span><span class="rank-track">${escapeHtml(slot.track)}</span></span>`;
      } else {
        li.innerHTML = `<span class="rank-num">${i + 1}</span><span class="rank-placeholder">${clickable ? 'Place here' : '—'}</span>`;
        if (clickable) li.addEventListener('click', () => onPlace(i));
      }
      list.appendChild(li);
    }
  }

  function renderCurrentTrack() {
    const filled = filledCount();
    document.getElementById('progress-label').textContent = `${filled}/10 picked`;
    document.getElementById('progress-fill').style.width = `${(filled / 10) * 100}%`;

    recordBtn.classList.remove('revealed');
    revealHint.textContent = 'Click the record to reveal';
    revealHint.style.display = '';
    document.getElementById('record-artist').textContent = '';
    document.getElementById('record-track').textContent = '';
    skipBtn.classList.add('hidden');
    albumArt.classList.remove('has-src');
    albumArt.src = '';
    albumArtPlaceholder.classList.remove('hidden');
    ytEmbed.classList.add('hidden');
    ytEmbed.innerHTML = '';
    ytStatus.textContent = '';
    renderRankList(false);

    // Fetch this track's video/art now, in the background, while it's still hidden —
    // by the time it's revealed the lookup is usually already done.
    const upcoming = game.queue[game.index];
    if (upcoming) prefetchTrackMedia(upcoming);
  }

  recordBtn.addEventListener('click', async () => {
    if (recordBtn.classList.contains('revealed')) return;
    const current = game.queue[game.index];
    recordBtn.classList.add('revealed');
    document.getElementById('record-artist').textContent = current.artist;
    document.getElementById('record-track').textContent = current.track;
    revealHint.style.display = 'none';
    skipBtn.classList.remove('hidden');
    renderRankList(true);

    const key = mediaCacheKey(current.artist, current.track);
    if (mediaCache[key]) {
      showMedia(mediaCache[key]);
    } else {
      // prefetch hasn't finished yet (revealed very fast) — fetch now
      if (document.getElementById('youtube-apikey').value.trim() || document.getElementById('lastfm-apikey').value.trim()) {
        ytStatus.textContent = 'Loading…';
      }
      const media = await prefetchTrackMedia(current);
      // only apply if we're still looking at the same track (guards against fast skip/place)
      if (game.queue[game.index] === current) showMedia(media);
    }
  });

  function onPlace(i) {
    const current = game.queue[game.index];
    game.positions[i] = { artist: current.artist, track: current.track };
    renderRankList(false);
    skipBtn.classList.add('hidden');
    setTimeout(() => {
      game.index++;
      if (filledCount() >= 10 || game.index >= game.queue.length) {
        finishGame();
      } else {
        renderCurrentTrack();
      }
    }, 400);
  }

  skipBtn.addEventListener('click', () => {
    game.index++;
    if (game.index >= game.queue.length) {
      finishGame();
    } else {
      renderCurrentTrack();
    }
  });

  document.getElementById('btn-end-early').addEventListener('click', () => {
    if (!game) return;
    if (filledCount() === 0) {
      showScreen('setup');
      return;
    }
    if (confirm('End this session now? Empty chart positions will be left blank.')) {
      finishGame();
    }
  });

  function finishGame() {
    const filled = filledCount();
    const entry = {
      categoryId: game.categoryId,
      categoryTitle: game.categoryTitle,
      date: new Date().toISOString(),
      chartFull: filled >= 10,
      filledCount: filled,
      reviewedCount: game.index,
      results: game.positions
        .map((slot, i) => (slot ? { position: i + 1, artist: slot.artist, track: slot.track } : null))
        .filter(Boolean),
    };
    history.unshift(entry);
    saveJSON(LS_HISTORY, history);
    renderResults(entry);
  }

  /* ============ Media live-fetch: YouTube video + album art (client-side) ============ */
  const LS_YT_APIKEY = 'blindspin.youtube.apikey.v1';
  const LS_MEDIA_CACHE = 'blindspin.media.cache.v1';
  let mediaCache = loadJSON(LS_MEDIA_CACHE, {});

  function mediaCacheKey(artist, track) {
    return (artist + ' — ' + track).toLowerCase();
  }

  // Looks up (and caches) the YouTube video + album art for one track. Safe to call
  // early/in the background — results just sit in the cache until reveal needs them.
  async function prefetchTrackMedia(t) {
    const key = mediaCacheKey(t.artist, t.track);
    if (mediaCache[key]) return mediaCache[key];

    const ytKey = document.getElementById('youtube-apikey').value.trim();
    const lastfmKey = document.getElementById('lastfm-apikey').value.trim();
    const media = { videoId: null, art: null };

    const jobs = [];
    if (ytKey) {
      jobs.push(
        fetchYoutubeVideoId(`${t.artist} ${t.track}`, ytKey)
          .then(id => { media.videoId = id; })
          .catch(() => {})
      );
    }
    if (lastfmKey) {
      jobs.push(
        fetchAlbumArt(t.artist, t.track, lastfmKey)
          .then(url => { media.art = url; })
          .catch(() => {})
      );
    }
    await Promise.all(jobs);

    // last.fm art is often missing/placeholder — fall back to the YouTube thumbnail, if we have one
    if (!media.art && media.videoId) {
      media.art = `https://img.youtube.com/vi/${media.videoId}/hqdefault.jpg`;
    }

    mediaCache[key] = media;
    saveJSON(LS_MEDIA_CACHE, mediaCache);
    return media;
  }

  function showMedia(media) {
    if (media.art) {
      albumArt.src = media.art;
      albumArt.classList.add('has-src');
      albumArtPlaceholder.classList.add('hidden');
    } else {
      albumArt.classList.remove('has-src');
      albumArt.src = '';
      albumArtPlaceholder.classList.remove('hidden');
    }
    if (media.videoId) {
      // start=60 skips the first minute, past most music-video intros
      ytEmbed.innerHTML = `<iframe src="https://www.youtube.com/embed/${media.videoId}?autoplay=1&start=60" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
      ytEmbed.classList.remove('hidden');
      ytStatus.textContent = '';
    } else {
      ytEmbed.classList.add('hidden');
      ytEmbed.innerHTML = '';
      ytStatus.textContent = document.getElementById('youtube-apikey').value.trim() ? 'No YouTube match found.' : '';
    }
  }

  async function fetchYoutubeVideoId(query, apiKey) {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status}`);
    const item = data.items && data.items[0];
    return (item && item.id && item.id.videoId) || null;
  }

  // last.fm doesn't send CORS headers, so this goes through the same jsonp() helper as the top-tracks fetch
  async function fetchAlbumArt(artist, track, apiKey) {
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.getinfo&api_key=${encodeURIComponent(apiKey)}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&format=json`;
    const data = await jsonp(url);
    if (data.error) throw new Error(data.message || `last.fm error ${data.error}`);
    const images = data.track && data.track.album && data.track.album.image;
    if (!Array.isArray(images)) return null;
    for (let i = images.length - 1; i >= 0; i--) {
      const u = images[i] && images[i]['#text'];
      if (u) return u; // largest available non-empty image (sizes are ordered small→mega)
    }
    return null;
  }

  document.getElementById('youtube-apikey').addEventListener('input', debounce(() => {
    saveJSON(LS_YT_APIKEY, document.getElementById('youtube-apikey').value.trim());
  }, 400));

  function initYoutubeField() {
    document.getElementById('youtube-apikey').value = loadJSON(LS_YT_APIKEY, '');
  }

  /* ============ Results screen ============ */
  let currentResultsEntry = null;

  function renderResults(entry) {
    currentResultsEntry = entry;
    document.getElementById('results-title').textContent = entry.categoryTitle;
    document.getElementById('results-eyebrow').textContent = entry.chartFull
      ? 'Top 10 complete'
      : `Ended early — ${entry.filledCount}/10 filled (${entry.reviewedCount} songs reviewed)`;

    const list = document.getElementById('results-list');
    list.innerHTML = '';
    entry.results.forEach(r => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="r-info">
          <div class="r-artist">${escapeHtml(r.artist)}</div>
          <div class="r-track">${escapeHtml(r.track)}</div>
        </div>
        <div class="r-score">#${r.position}</div>
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
    let csv = 'position,artist,track\n';
    currentResultsEntry.results.forEach(r => {
      csv += `${r.position},"${r.artist.replace(/"/g, '""')}","${r.track.replace(/"/g, '""')}"\n`;
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
      .map(r => `${r.position}. ${r.artist} — ${r.track}`)
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
          <div class="hi-meta">${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} · ${entry.filledCount}/10 filled${entry.chartFull ? '' : ' (ended early)'}</div>
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
    localStorage.removeItem(LS_APIKEY);
    localStorage.removeItem(LS_LFM_USERS);
    localStorage.removeItem(LS_YT_APIKEY);
    localStorage.removeItem(LS_MEDIA_CACHE);
    mediaCache = {};
    lists = { you365: [], youAll: [], friend365: [], friendAll: [] };
    names = { you: 'You', friend: 'Friend' };
    history = [];
    slots.forEach(slot => {
      sources[slot] = null;
      document.getElementById('paste-' + slot).value = '';
      document.getElementById('file-' + slot).value = '';
    });
    document.getElementById('lastfm-apikey').value = (window.BLINDSPIN_CONFIG && window.BLINDSPIN_CONFIG.lastfmApiKey) || '';
    document.getElementById('lastfm-you').value = '';
    document.getElementById('lastfm-friend').value = '';
    document.getElementById('youtube-apikey').value = '';
    refreshUploadUI();
    showScreen('setup');
  });

  /* ============ Init ============ */
  initLastfmFields();
  initYoutubeField();
  refreshUploadUI(); // paint immediately from whatever's cached in localStorage
  loadAllRepoFiles({ silent: true }); // then try the repo's data/ folder, which wins if present
})();

/* Publication transport only. Draw and strike behavior stays in the pages. */
function showBanner(message, type) {
  var node = document.getElementById('resolutionLoadStatus');
  if (!node) {
    node = document.createElement('div');
    node.id = 'resolutionLoadStatus';
    node.setAttribute('role', 'status');
    node.style.cssText = 'padding:8px 16px;margin:8px auto;max-width:700px;text-align:center;font-size:0.9rem;';
    document.getElementById('body').appendChild(node);
  }
  node.className = 'banner banner-' + type;
  node.textContent = message;
  // Explicit opt-in recovery. Never silently substitute older resolutions.
  var backupHref = document.body.getAttribute('data-resolution-backup');
  var backupDate = document.body.getAttribute('data-resolution-backup-date');
  if (type === 'error' && backupHref) {
    var link = document.createElement('a');
    link.href = backupHref;
    link.textContent = 'Use backup practice — saved ' + (backupDate || 'previously') + ' (not live updates)';
    link.style.cssText = 'display:inline-block;padding:12px;margin-top:8px;color:inherit;text-decoration:underline;';
    node.appendChild(document.createElement('br'));
    node.appendChild(link);
  }
}
function validateResolutionSnapshot(envelope) {
  if (!envelope || envelope.success !== true || !envelope.data) throw Error('Publication rejected');
  var data = envelope.data;
  if (typeof data.version !== 'string' || !data.version || data.version.length > 200 ||
      typeof data.published !== 'string' || !Number.isFinite(Date.parse(data.published)) ||
      typeof data.digest !== 'string' || !/^[a-f0-9]{64}$/i.test(data.digest) ||
      !Array.isArray(data.library) || data.library.length < 5 || data.library.length > 20000 ||
      !Array.isArray(data.openingFive) || data.openingFive.length !== 5) throw Error('Invalid publication');
  function valid(row) {
    if (!row || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 20000 ||
        !Array.isArray(row.tags) || row.tags.length > 4001 || row.tags.some(function(t) { return typeof t !== 'string' || t.length > 2000; })) throw Error('Invalid resolution');
  }
  data.library.forEach(valid);
  data.openingFive.forEach(function(row, i) {
    valid(row);
    if (row.tags.includes('exp') || row.text !== data.library[i].text || JSON.stringify(row.tags) !== JSON.stringify(data.library[i].tags)) throw Error('Invalid opening five');
  });
  return data;
}
async function loadResolutions() {
  var config = typeof RESOLUTION_LIBRARY === 'object' ? RESOLUTION_LIBRARY : {};
  if (!config.endpoint) {
    showBanner('Data source not configured. Resolutions are unavailable.', 'error');
    return [];
  }
  var cacheKey = 'reslib_snapshot:' + config.endpoint;
  var controller = new AbortController();
  var timer;
  showBanner('Loading approved resolutions…', 'info');
  try {
    var timeout = new Promise(function(_, reject) { timer = setTimeout(function() { controller.abort(); reject(Error('Request timed out')); }, config.timeoutMs || 15000); });
    var request = (async function() {
      var response = await fetch(config.endpoint, {signal: controller.signal, cache: 'no-store', credentials: 'omit'});
      if (!response.ok) throw Error('HTTP ' + response.status);
      var max = config.maxBytes || 16 * 1024 * 1024;
      var announced = Number(response.headers && response.headers.get('content-length'));
      if (announced > max) throw Error('Publication too large');
      var text = '';
      if (response.body && response.body.getReader) {
        var reader = response.body.getReader(), decoder = new TextDecoder(), size = 0;
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > max) { await reader.cancel(); throw Error('Publication too large'); }
          text += decoder.decode(chunk.value, {stream:true});
        }
        text += decoder.decode();
      } else {
        text = await response.text();
        if (new TextEncoder().encode(text).byteLength > max) throw Error('Publication too large');
      }
      var envelope = JSON.parse(text);
      var data = validateResolutionSnapshot(envelope);
      try { sessionStorage.setItem(cacheKey, JSON.stringify(envelope)); } catch (_) { /* Cache is optional. */ }
      return data;
    })();
    var data = await Promise.race([request, timeout]);
    showBanner('Approved snapshot ' + data.version + ' · published ' + data.published, 'info');
    return data.library;
  } catch (error) {
    if (config.allowStaleCache === true) {
      try {
        var cached = sessionStorage.getItem(cacheKey);
        if (cached && new TextEncoder().encode(cached).byteLength <= (config.maxBytes || 16 * 1024 * 1024)) {
          var stale = validateResolutionSnapshot(JSON.parse(cached));
          showBanner('STALE saved snapshot ' + stale.version + ' · published ' + stale.published + '. Unable to check for updates. Reload to retry.', 'error');
          return stale.library;
        }
      } catch (_) { /* Unavailable or invalid cache fails closed. */ }
    }
    showBanner('Unable to load approved resolutions. Reload to retry.', 'error');
    return [];
  } finally { clearTimeout(timer); }
}

/* Draw → Ballot: completed-result handoff only, not synchronized striking. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DrawBallot = api.mount(root, root.document.currentScript.dataset);
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function buildRequest(choices, remaining, source, requestId) {
    if (remaining.length !== 1) throw new Error('Leave exactly one resolution unstruck.');
    if (choices.length !== 5 || choices.some(function (s) { return typeof s !== 'string' || !s.trim(); })) {
      throw new Error('A complete sheet of five resolutions is required.');
    }
    if (new Set(choices).size !== 5) throw new Error('The five resolutions must be distinct.');
    if (!Number.isInteger(remaining[0]) || remaining[0] < 0 || remaining[0] >= 5) throw new Error('Invalid selected resolution.');
    if (source !== 'practice' && source !== 'custom') throw new Error('Invalid draw source.');
    return {action: 'draw.create', requestId: requestId, resolutions: choices.slice(), selectedIndex: remaining[0], source: source};
  }
  function checkedResult(draw, request) {
    if (!draw || draw.schemaVersion !== 1 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draw.drawId || '') ||
        !/^[A-HJ-NP-Z2-9]{8}$/.test(draw.code || '') ||
        draw.resolution !== request.resolutions[request.selectedIndex] ||
        typeof draw.createdAt !== 'string' || !Number.isFinite(Date.parse(draw.createdAt))) {
      throw new Error('The saved result does not match this draw.');
    }
    return {schemaVersion: 1, drawId: draw.drawId, code: draw.code, resolution: draw.resolution, createdAt: draw.createdAt};
  }
  function createController(options) {
    var state = {request: null, draw: null, busy: false, error: '', recovered: false, storageWarning: false};
    function changed() { if (options.onChange) options.onChange(); }
    function persist() {
      try { options.storage.setItem(options.key, JSON.stringify({schemaVersion: 1, request: state.request, draw: state.draw})); }
      catch (e) { state.storageWarning = true; }
    }
    try {
      var saved = JSON.parse(options.storage.getItem(options.key) || 'null');
      if (saved && saved.schemaVersion === 1 && saved.request && saved.request.source === options.source) {
        state.request = buildRequest(saved.request.resolutions, [saved.request.selectedIndex], options.source, saved.request.requestId);
        state.draw = saved.draw ? checkedResult(saved.draw, state.request) : null;
        state.recovered = true;
      }
    } catch (e) { state.error = 'The saved draw could not be recovered. Start another draw.'; }
    async function save() {
      if (state.busy) return null;
      if (state.draw) return state.draw;
      if (!state.request) {
        var snapshot = options.snapshot();
        state.request = buildRequest(snapshot.choices, snapshot.remaining, options.source, options.uuid());
        persist();
      }
      state.busy = true; state.error = ''; changed();
      try {
        var result = await options.post(JSON.parse(JSON.stringify(state.request)));
        if (!result || result.result !== 'success' || !result.draw) throw new Error('No saved result was returned.');
        state.draw = checkedResult(result.draw, state.request); persist();
        return state.draw;
      } catch (e) {
        state.error = 'Could not generate a code. Retry here to keep the same request.';
        return null;
      } finally { state.busy = false; changed(); }
    }
    function reset() {
      if (state.busy) return false;
      try { options.storage.removeItem(options.key); }
      catch (e) { state.error = 'Could not clear recovery storage. Open a fresh tab to start another draw.'; changed(); return false; }
      state.request = null; state.draw = null; state.error = ''; state.recovered = false; changed(); return true;
    }
    return {save: save, reset: reset, canEdit: function () { return !state.request && !state.busy; }, getState: function () { return JSON.parse(JSON.stringify(state)); }};
  }
  function mount(win, config) {
    var doc = win.document;
    var panel = doc.createElement('section');
    panel.id = 'drawBallotPanel'; panel.className = 'draw-ballot-panel'; panel.hidden = true;
    panel.setAttribute('aria-labelledby', 'drawBallotHeading');
    panel.innerHTML = '<h2 id="drawBallotHeading">Selected resolution</h2>' +
      '<p id="drawBallotTopic"></p><p id="drawBallotStatus" role="status" aria-live="polite"></p>' +
      '<button type="button" id="generateBallotCode">Generate Round Code</button>' +
      '<div id="drawBallotResult" hidden><p>Round code: <strong><code id="drawBallotCode"></code></strong></p>' +
      '<p class="draw-ballot-help">Give this code or link to all judges of this debate. For a panel, select &ldquo;Panel round&rdquo; on each ballot; no second code is needed. Each judge completes a separate ballot.</p>' +
      '<label for="drawBallotLink">Ballot link</label><input id="drawBallotLink" type="text" readonly>' +
      '<div class="draw-ballot-actions"><button type="button" id="drawBallotCopy">Copy ballot link</button>' +
      '<a id="drawBallotOpen" class="button" target="_blank" rel="noopener noreferrer">Open ballot</a></div></div>' +
      '<button type="button" id="drawBallotNew" hidden>Start another draw</button>';
    var style = doc.createElement('style');
    style.textContent = '.draw-ballot-panel{box-sizing:border-box;width:min(700px,90%);margin:18px 0 0;padding:18px;border:2px solid #2c5f8a;border-radius:10px;font-size:1rem;line-height:1.45;overflow-wrap:anywhere}' +
      '.draw-ballot-panel h2{font-size:1.15rem;margin:0 0 8px}.draw-ballot-panel p{margin:8px 0}.draw-ballot-panel input{box-sizing:border-box;width:100%;font:inherit;padding:8px;border:1px solid #888;border-radius:5px}' +
      '.draw-ballot-panel code{font-size:1.35rem;letter-spacing:.12em}.draw-ballot-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.draw-ballot-panel[hidden],.draw-ballot-panel [hidden]{display:none!important}' +
      '.draw-ballot-help{font-size:.9rem}button:disabled{opacity:.55;cursor:default}.line p[aria-disabled="true"]{cursor:default}#drawBallotNew{margin-top:12px;background:#555}';
    doc.head.appendChild(style);doc.body.insertBefore(panel, doc.querySelector('.button-container'));
    var el = function (id) { return doc.getElementById(id); };
    var storage;
    try { storage = win.sessionStorage; }
    catch (e) { storage = {getItem: function () { return null; },setItem: function () { throw Error('Storage unavailable'); },removeItem: function () {}}; }
    var appliedRecovery = false;
    function snapshot() {
      var lines = Array.from(doc.querySelectorAll('.line p'));
      if (lines.some(function (p) { return p.style.opacity === '0'; })) throw Error('Wait for Shuffle to finish.');
      return {choices: lines.map(function (p) { return p.textContent; }), remaining: lines.flatMap(function (p, i) { return p.classList.contains('strikethrough') ? [] : [i]; })};
    }
    function uuid() {
      if (win.crypto.randomUUID) return win.crypto.randomUUID();
      var bytes = win.crypto.getRandomValues(new Uint8Array(16));bytes[6] = (bytes[6] & 15) | 64;bytes[8] = (bytes[8] & 63) | 128;
      var s = Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);
    }
    async function post(request) {
      var abort = new win.AbortController();var timer = win.setTimeout(function () { abort.abort(); }, 20000);
      try {
        var response = await win.fetch(config.ballotEndpoint, {method: 'POST', body: JSON.stringify(request), signal: abort.signal});
        if (!response.ok) throw Error('Service unavailable');
        return await response.json();
      } finally { win.clearTimeout(timer); }
    }
    var controller = createController({source: config.source, key: 'uuDrawBallot:v1:' + win.location.pathname,
      storage: storage, snapshot: snapshot, uuid: uuid, post: post, onChange: refresh});
    function refresh() {
      var state = controller.getState();
      var lines = Array.from(doc.querySelectorAll('.line p'));
      if (state.request && !appliedRecovery && lines.length === 5) {
        lines.forEach(function (p, i) {
          p.textContent = state.request.resolutions[i];
          p.setAttribute('aria-label', 'Toggle strike on: ' + p.textContent);
          p.classList.toggle('strikethrough', i !== state.request.selectedIndex);
          p.setAttribute('aria-pressed', i === state.request.selectedIndex ? 'false' : 'true');
          p.closest('.line').classList.toggle('highlight', i === state.request.selectedIndex);
        });
        appliedRecovery = true;
      }
      var current;
      try { current = snapshot();buildRequest(current.choices,current.remaining,config.source,'preview'); }
      catch (e) { current = null; }
      var selected = state.request ? state.request.resolutions[state.request.selectedIndex] : current ? current.choices[current.remaining[0]] : '';
      panel.hidden = !selected && !state.error;
      doc.body.insertBefore(panel, doc.querySelector('.button-container'));
      el('drawBallotTopic').textContent = selected;
      el('generateBallotCode').disabled = state.busy || (!state.request && !current);
      el('generateBallotCode').hidden = !!state.draw;
      el('generateBallotCode').textContent = state.busy ? 'Generating…' : state.request ? 'Retry code generation' : 'Generate Round Code';
      el('drawBallotNew').hidden = !state.request && !state.error;el('drawBallotNew').disabled = state.busy;
      el('drawBallotResult').hidden = !state.draw;
      el('drawBallotStatus').textContent = state.busy ? 'Saving this result… Keep this page open.' : state.error ||
        (state.draw ? (state.recovered ? 'Recovered saved result. ' : '') + 'This result is saved; its code will not change.' : '');
      if (state.storageWarning) el('drawBallotStatus').textContent += ' Browser recovery is unavailable; keep this page open and copy the code when it appears.';
      if (state.draw) {
        var link = new URL('../', win.location.href);link.searchParams.set('draw',state.draw.code);
        el('drawBallotCode').textContent = state.draw.code;el('drawBallotLink').value = link.href;el('drawBallotOpen').href = link.href;
      }
      doc.querySelectorAll('.line button, #redrawBtn, #modeSelect').forEach(function (button) { button.disabled = !controller.canEdit(); });
      lines.forEach(function (p) { p.setAttribute('aria-disabled', controller.canEdit() ? 'false' : 'true');p.tabIndex = controller.canEdit() ? 0 : -1; });
    }
    el('generateBallotCode').addEventListener('click', async function () {
      try { await controller.save(); } catch (e) { el('drawBallotStatus').textContent = e.message; }
    });
    el('drawBallotCopy').addEventListener('click', async function () {
      try { await win.navigator.clipboard.writeText(el('drawBallotLink').value);el('drawBallotStatus').textContent = 'Ballot link copied.'; }
      catch (e) { el('drawBallotLink').focus();el('drawBallotLink').select();el('drawBallotStatus').textContent = 'Select and copy the ballot link above.'; }
    });
    el('drawBallotNew').addEventListener('click', function () {
      if (!win.confirm('Start another draw? Any saved code will still point to its original result.')) return;
      if (controller.reset()) win.location.reload();
    });
    refresh();
    return {refresh: refresh, canEdit: controller.canEdit};
  }
  return {buildRequest: buildRequest, createController: createController, mount: mount};
});

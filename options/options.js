/*
 * Eye Protector — 设置页逻辑
 *
 * 所有修改即时写入 storage（防抖），由 content script 监听 storage.onChanged
 * 实时应用到已打开的页面；外观页的实时预览与真实页面的滤镜逻辑完全一致。
 */
(function () {
  'use strict';

  var EP = globalThis.EyeProtector;
  var settings = null;
  var saveTimer = null;
  var suppressEcho = 0; // 自己发起的写入不计入 onChanged 回填

  var $ = function (id) { return document.getElementById(id); };

  var SLIDER_KEYS = ['warmth', 'brightness', 'contrast', 'saturation'];
  var IMAGE_SLIDER_KEYS = ['imageBrightness', 'imageSaturation'];

  /* ------------------------------------------------------------ */
  /* 保存                                                          */
  /* ------------------------------------------------------------ */

  function showSaved() {
    var el = $('saveIndicator');
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 1300);
  }

  function save(patch) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      suppressEcho++;
      EP.setSettings(patch).then(function (s) {
        settings = s;
        renderPresetStatus();
        showSaved();
      }).catch(function () { suppressEcho = Math.max(0, suppressEcho - 1); });
    }, 200);
  }

  /* ------------------------------------------------------------ */
  /* 导航                                                          */
  /* ------------------------------------------------------------ */

  function switchPanel(name) {
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.target === name);
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('active', p.dataset.panel === name);
    });
    try {
      if (history.replaceState) history.replaceState(null, '', '#' + name);
    } catch (e) { /* about:blank 等上下文下可能抛出 SecurityError */ }
  }

  document.getElementById('nav').addEventListener('click', function (e) {
    var btn = e.target.closest('.nav-item');
    if (btn) switchPanel(btn.dataset.target);
  });

  /* ------------------------------------------------------------ */
  /* 滑块                                                          */
  /* ------------------------------------------------------------ */

  function paintSlider(input) {
    var min = Number(input.min), max = Number(input.max), val = Number(input.value);
    var pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
    input.style.setProperty('--fill', pct + '%');
  }

  function bindSlider(key) {
    var input = $('inp-' + key);
    var val = $('val-' + key);
    input.addEventListener('input', function () {
      val.textContent = input.value;
      paintSlider(input);
      var patch = {};
      patch[key] = Number(input.value);
      save(patch);
      updatePreview();
    });
  }

  /* ------------------------------------------------------------ */
  /* 实时预览（与 content script 使用同一套换算）                     */
  /* ------------------------------------------------------------ */

  function previewSettings() {
    var s = Object.assign({}, settings);
    SLIDER_KEYS.forEach(function (k) { s[k] = Number($('inp-' + k).value); });
    IMAGE_SLIDER_KEYS.forEach(function (k) { s[k] = Number($('inp-' + k).value); });
    return s;
  }

  function updatePreview() {
    var s = previewSettings();
    var parts = EP.filterParts(s);
    var surface = $('previewSurface');
    surface.style.filter = parts.pageFilter;

    var img = $('previewImg');
    if (s.imageMode === 'protect') {
      ensurePreviewInverseSVG(s);
      img.style.filter = 'url(#' + EP.INVERSE_FILTER_ID + ') ' + parts.inverseTail;
    } else if (s.imageMode === 'dim') {
      img.style.filter = 'brightness(' + EP.round(s.imageBrightness / 100) + ')';
    } else if (s.imageMode === 'desaturate') {
      img.style.filter = 'saturate(' + EP.round(s.imageSaturation / 100) + ')';
    } else {
      img.style.filter = '';
    }
  }

  function ensurePreviewInverseSVG(s) {
    var el = $(EP.SVG_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = EP.SVG_ID;
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    el.innerHTML = EP.buildInverseSVGMarkup(s);
  }

  /* ------------------------------------------------------------ */
  /* 方案                                                          */
  /* ------------------------------------------------------------ */

  function renderPresetStatus() {
    var matched = EP.detectPreset(settings);
    var el = $('presetStatus');
    if (matched) {
      var p = EP.PRESETS.find(function (x) { return x.id === matched; });
      el.innerHTML = '';
      el.append('当前方案：');
      var b = document.createElement('b');
      b.textContent = p.name;
      el.append(b);
    } else {
      el.innerHTML = '';
      el.append('当前方案：');
      var b2 = document.createElement('b');
      b2.textContent = '自定义';
      el.append(b2, '（在外观页调整参数后自动生成）');
    }
    document.querySelectorAll('.preset-card').forEach(function (card) {
      card.classList.toggle('active', card.dataset.preset === matched);
    });
  }

  document.getElementById('presetGrid').addEventListener('click', function (e) {
    var card = e.target.closest('.preset-card');
    if (!card) return;
    var p = EP.PRESETS.find(function (x) { return x.id === card.dataset.preset; });
    if (!p) return;
    var patch = {
      activePreset: p.id,
      warmth: p.warmth,
      brightness: p.brightness,
      contrast: p.contrast,
      saturation: p.saturation
    };
    SLIDER_KEYS.forEach(function (k) {
      $('inp-' + k).value = patch[k];
      $('val-' + k).textContent = patch[k];
      paintSlider($('inp-' + k));
    });
    updatePreview();
    save(patch);
  });

  /* ------------------------------------------------------------ */
  /* 图片模式                                                      */
  /* ------------------------------------------------------------ */

  function renderImageModes() {
    document.querySelectorAll('.mode-card').forEach(function (card) {
      card.classList.toggle('active', card.dataset.mode === settings.imageMode);
    });
  }

  document.getElementById('imageModeList').addEventListener('click', function (e) {
    if (e.target.closest('input')) return; // 拖动滑块不切换模式
    var card = e.target.closest('.mode-card');
    if (!card) return;
    save({ imageMode: card.dataset.mode });
    settings.imageMode = card.dataset.mode;
    renderImageModes();
    updatePreview();
  });

  /* ------------------------------------------------------------ */
  /* 网站排除                                                      */
  /* ------------------------------------------------------------ */

  function normalizeDomain(raw) {
    var v = String(raw || '').trim().toLowerCase();
    if (!v) return null;
    // 允许粘贴完整 URL
    if (/^https?:\/\//.test(v)) {
      try { v = new URL(v).hostname; } catch (e) { return null; }
    }
    v = v.replace(/\/.*$/, '').replace(/:\d+$/, '');
    if (!/^(localhost|[\d.]+|[a-z0-9\u00a1-\uffff-]+(\.[a-z0-9\u00a1-\uffff-]+)*)$/.test(v)) return null;
    return v;
  }

  function renderSites() {
    var list = $('siteList');
    list.innerHTML = '';
    settings.excludedSites.forEach(function (domain) {
      var li = document.createElement('li');
      var globe = document.createElement('span');
      globe.innerHTML = '<svg class="globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5a15.3 15.3 0 0 1 3.8 9.5 15.3 15.3 0 0 1-3.8 9.5 15.3 15.3 0 0 1-3.8-9.5A15.3 15.3 0 0 1 12 2.5Z"/></svg>';
      var span = document.createElement('span');
      span.className = 'domain';
      span.textContent = domain;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.title = '移除';
      btn.setAttribute('aria-label', '移除 ' + domain);
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      btn.addEventListener('click', function () { removeSite(domain); });
      li.append(globe, span, btn);
      list.appendChild(li);
    });
    $('siteEmpty').hidden = settings.excludedSites.length > 0;
  }

  function showSiteError(msg) {
    var el = $('siteError');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function addSite(raw) {
    var domain = normalizeDomain(raw);
    if (!domain) {
      showSiteError('请输入有效的域名，例如 example.com');
      return;
    }
    if (settings.excludedSites.indexOf(domain) !== -1) {
      showSiteError('该网站已在排除列表中');
      return;
    }
    showSiteError('');
    save({ excludedSites: settings.excludedSites.concat([domain]) });
    $('siteInput').value = '';
  }

  function removeSite(domain) {
    save({
      excludedSites: settings.excludedSites.filter(function (d) { return d !== domain; })
    });
  }

  $('addSiteBtn').addEventListener('click', function () { addSite($('siteInput').value); });
  $('siteInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') addSite(e.target.value);
  });

  $('addCurrentBtn').addEventListener('click', function () {
    browser.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      var host = '';
      try {
        var url = new URL(tabs[0].url);
        if (/^https?:$/.test(url.protocol)) host = url.hostname;
      } catch (e) { /* ignore */ }
      if (host) addSite(host);
      else showSiteError('当前标签页不是普通网页，无法排除');
    }).catch(function () {
      showSiteError('无法读取当前标签页');
    });
  });

  /* ------------------------------------------------------------ */
  /* 回填与初始化                                                   */
  /* ------------------------------------------------------------ */

  function hydrate() {
    $('enabled').checked = settings.enabled;

    document.querySelectorAll('input[name="autoMode"]').forEach(function (r) {
      r.checked = r.value === settings.autoMode;
    });
    $('scheduleStart').value = settings.scheduleStart;
    $('scheduleEnd').value = settings.scheduleEnd;

    SLIDER_KEYS.concat(IMAGE_SLIDER_KEYS).forEach(function (k) {
      var input = $('inp-' + k);
      input.value = settings[k];
      $('val-' + k).textContent = settings[k];
      paintSlider(input);
    });

    $('customCSSEnabled').checked = settings.customCSSEnabled;
    if ($('customCSS').value !== settings.customCSS) {
      $('customCSS').value = settings.customCSS;
    }

    renderImageModes();
    renderSites();
    renderPresetStatus();
    updatePreview();
  }

  /* 常规 */
  $('enabled').addEventListener('change', function () {
    save({ enabled: this.checked, autoMode: 'manual' });
  });

  document.querySelectorAll('input[name="autoMode"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      if (radio.checked) save({ autoMode: radio.value });
    });
  });

  $('scheduleStart').addEventListener('change', function () { save({ scheduleStart: this.value }); });
  $('scheduleEnd').addEventListener('change', function () { save({ scheduleEnd: this.value }); });

  $('resetAppearance').addEventListener('click', function () {
    var d = EP.DEFAULTS;
    SLIDER_KEYS.forEach(function (k) {
      $('inp-' + k).value = d[k];
      $('val-' + k).textContent = d[k];
      paintSlider($('inp-' + k));
    });
    updatePreview();
    save({ warmth: d.warmth, brightness: d.brightness, contrast: d.contrast, saturation: d.saturation, activePreset: 'warm' });
  });

  /* 高级 */
  $('customCSSEnabled').addEventListener('change', function () {
    save({ customCSSEnabled: this.checked });
  });

  $('customCSS').addEventListener('input', function () {
    save({ customCSS: this.value });
  });

  $('resetAllBtn').addEventListener('click', function () {
    if (confirm('确定要重置所有设置吗？此操作不可撤销。')) {
      suppressEcho++;
      browser.storage.local.set({ settings: EP.mergeSettings({}) }).then(function (res) {
        settings = EP.mergeSettings({});
        hydrate();
        showSaved();
      }).catch(function () { suppressEcho = Math.max(0, suppressEcho - 1); });
    }
  });

  /* storage 变更：来自 popup 或其他标签页时回填 */
  browser.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes || !changes[EP.STORAGE_KEY]) return;
    if (suppressEcho > 0) { suppressEcho--; return; }
    settings = EP.mergeSettings(changes[EP.STORAGE_KEY].newValue);
    hydrate();
  });

  /* 初始化 */
  var manifest = browser.runtime.getManifest();
  $('version').textContent = 'v' + manifest.version;

  if (location.hash) {
    var name = location.hash.slice(1);
    if (document.querySelector('.panel[data-panel="' + name + '"]')) switchPanel(name);
  }

  SLIDER_KEYS.concat(IMAGE_SLIDER_KEYS).forEach(bindSlider);

  EP.getSettings().then(function (s) {
    settings = s;
    hydrate();
  });
})();

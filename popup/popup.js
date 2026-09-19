/*
 * Eye Protector — Popup 逻辑
 *
 * 职责极简：展示当前状态、提供一键开关、显示当前方案、进入设置页。
 * 状态完全以 storage 为准，storage.onChanged 驱动界面更新。
 */
(function () {
  'use strict';

  var EP = globalThis.EyeProtector;

  var ICONS = {
    sunrise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v2.5"/><path d="m5.8 5.8 1.6 1.6"/><path d="m18.2 5.8-1.6 1.6"/><path d="M2.5 16h2.5"/><path d="M19 16h2.5"/><path d="M8 16a4 4 0 0 1 8 0"/><path d="M3 20h18"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6.4 6.4 0 0 0 8.6 8.6A9 9 0 1 1 12 3Z"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3h-7Z"/><path d="M21.5 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7Z"/></svg>',
    monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="19" height="13.5" rx="2"/><path d="M8.5 21h7"/><path d="M12 17v4"/></svg>',
    custom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>'
  };

  var els = {
    orb: document.getElementById('orb'),
    statusText: document.getElementById('statusText'),
    dot: document.getElementById('dot'),
    toggleBtn: document.getElementById('toggleBtn'),
    autoNote: document.getElementById('autoNote'),
    presetIcon: document.getElementById('presetIcon'),
    presetLine: document.getElementById('presetLine'),
    siteNote: document.getElementById('siteNote'),
    settingsBtn: document.getElementById('settingsBtn')
  };

  var settings = null;
  var systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
  var currentHost = '';
  var flashNote = ''; // 一次性提示文字（点击开关后展示）

  function getActiveTabHost() {
    return browser.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      try {
        var url = new URL(tabs[0].url);
        return /^https?:$/.test(url.protocol) ? url.hostname : '';
      } catch (e) {
        return '';
      }
    }).catch(function () { return ''; });
  }

  function render() {
    if (!settings) return;

    var excluded = EP.hostExcluded(currentHost, settings.excludedSites);
    var active = EP.isActive(settings, {
      host: currentHost,
      now: new Date(),
      systemDark: systemDark
    });

    els.orb.classList.toggle('on', active);
    els.dot.classList.toggle('on', active);
    els.statusText.textContent = active ? '已开启' : '已关闭';

    els.toggleBtn.textContent = active ? '关闭护眼模式' : '开启护眼模式';
    els.toggleBtn.classList.toggle('btn-primary', !active);
    els.toggleBtn.classList.toggle('btn-secondary', active);

    // 自动模式提示
    if (flashNote) {
      els.autoNote.hidden = false;
      els.autoNote.textContent = flashNote;
    } else if (settings.autoMode !== 'manual') {
      els.autoNote.hidden = false;
      els.autoNote.textContent = '当前由自动模式控制，点击上方按钮可切换为手动';
    } else {
      els.autoNote.hidden = true;
    }

    // 当前方案（以实际参数匹配的预设为准，手动改过参数即为“自定义”）
    var matchedId = EP.detectPreset(settings);
    var preset = matchedId
      ? EP.PRESETS.find(function (p) { return p.id === matchedId; })
      : null;
    var name = preset ? preset.name : '自定义';
    var icon = preset ? preset.icon : 'custom';
    els.presetIcon.innerHTML = ICONS[icon] || ICONS.custom;
    els.presetLine.textContent = name + ' · 暖色 ' + Math.round(settings.warmth) + '%';

    els.siteNote.hidden = !excluded;
  }

  els.toggleBtn.addEventListener('click', function () {
    if (!settings) return;
    var active = EP.isActive(settings, {
      host: currentHost,
      now: new Date(),
      systemDark: systemDark
    });
    var patch = { enabled: !active };
    if (settings.autoMode !== 'manual') {
      // 用户手动干预时退出自动模式，避免状态被时间/系统再次改写
      patch.autoMode = 'manual';
      flashNote = '已切换为手动控制';
      setTimeout(function () { flashNote = ''; render(); }, 1800);
    }
    EP.setSettings(patch);
  });

  els.settingsBtn.addEventListener('click', function () {
    browser.runtime.openOptionsPage();
    window.close();
  });

  browser.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes || !changes[EP.STORAGE_KEY]) return;
    settings = EP.mergeSettings(changes[EP.STORAGE_KEY].newValue);
    render();
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    systemDark = e.matches;
    render();
  });

  Promise.all([EP.getSettings(), getActiveTabHost()]).then(function (res) {
    settings = res[0];
    currentHost = res[1];
    render();
  });
})();

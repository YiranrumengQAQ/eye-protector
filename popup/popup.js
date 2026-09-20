/*
 * Eye Protector — Popup 逻辑
 *
 * 职责极简：展示当前状态、提供一键开关、显示当前方案、进入设置页。
 * 状态完全以 storage 为准，storage.onChanged 驱动界面更新。
 */
(function () {
  'use strict';

  var EP = globalThis.EyeProtector;

  /** 从 popup.html 中的 <template id="icon-…"> 克隆图标节点；未知名称回退为“自定义”。 */
  function iconNode(name) {
    var tpl = document.getElementById('icon-' + name) || document.getElementById('icon-custom');
    return tpl.content.firstElementChild.cloneNode(true);
  }

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
    if (els.presetIcon.dataset.icon !== icon) {
      els.presetIcon.dataset.icon = icon;
      els.presetIcon.replaceChildren(iconNode(icon));
    }
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

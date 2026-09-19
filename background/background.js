/*
 * Eye Protector — 后台事件页
 *
 * 职责：
 *   - 首次安装时写入默认设置，并打开设置页引导用户；
 *   - 根据当前状态更新工具栏徽章（ON / 无）；
 *   - 通过定时器在定时模式的时间边界附近刷新徽章。
 *
 * 实际的页面滤镜由内容脚本直接读取 storage 并应用，
 * 不经过后台中转，保证 content script 变更实时生效。
 */
(function () {
  'use strict';

  var EP = globalThis.EyeProtector;
  var darkQuery = null;

  if (typeof matchMedia === 'function') {
    darkQuery = matchMedia('(prefers-color-scheme: dark)');
    var onDarkChange = function () { updateBadge(); };
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onDarkChange);
    else if (darkQuery.addListener) darkQuery.addListener(onDarkChange);
  }

  function updateBadge() {
    EP.getSettings().then(function (settings) {
      var active = EP.isActive(settings, {
        now: new Date(),
        systemDark: darkQuery ? darkQuery.matches : false
      });
      browser.action.setBadgeText({ text: active ? 'ON' : '' });
      if (active) {
        browser.action.setBadgeBackgroundColor({ color: '#e8920f' });
        browser.action.setBadgeTextColor({ color: '#ffffff' });
      }
    });
  }

  browser.runtime.onInstalled.addListener(function (details) {
    // 合并写入默认值，保证老版本升级后新字段存在
    EP.getSettings().then(function (settings) {
      return browser.storage.local.set({ settings: settings });
    }).then(updateBadge);

    if (details.reason === 'install') {
      browser.runtime.openOptionsPage();
    }
  });

  browser.runtime.onStartup.addListener(updateBadge);

  browser.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes && changes[EP.STORAGE_KEY]) updateBadge();
  });

  browser.alarms.create('eye-protector-tick', { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener(function (alarm) {
    if (alarm && alarm.name === 'eye-protector-tick') updateBadge();
  });

  updateBadge();
})();

/*
 * Eye Protector — 预览页用的 WebExtension API 桩
 *
 * 仅供 docs/preview.html 在普通浏览器中预览扩展界面使用，
 * 不属于扩展本体，不会被 web-ext 携带（见 manifest 打包说明）。
 *
 * 通过 BroadcastChannel 在 popup / options 两个 iframe 之间同步
 * storage.onChanged，从而达到接近真实扩展的交互效果。
 */
(function () {
  'use strict';

  if (window.browser) return; // 真实扩展环境中绝不覆盖

  var channel = ('BroadcastChannel' in window)
    ? new BroadcastChannel('eye-protector-demo')
    : null;

  var listeners = [];
  var store = {
    // 预览默认呈现“已开启”状态，其余字段由 lib/shared.js 的默认值补齐
    settings: { enabled: true, excludedSites: ['example.org'] }
  };

  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  function fire(key, oldValue, newValue) {
    var changes = {};
    changes[key] = { oldValue: clone(oldValue), newValue: clone(newValue) };
    listeners.forEach(function (fn) {
      try { fn(changes, 'local'); } catch (e) { /* ignore */ }
    });
  }

  window.browser = {
    storage: {
      local: {
        get: function (key) {
          if (key == null) return Promise.resolve(clone(store));
          var out = {};
          out[key] = clone(store[key]);
          return Promise.resolve(out);
        },
        set: function (obj) {
          Object.keys(obj).forEach(function (key) {
            var old = store[key];
            store[key] = clone(obj[key]);
            if (channel) channel.postMessage({ type: 'ep-set', key: key, value: obj[key] });
            fire(key, old, obj[key]);
          });
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener: function (fn) { listeners.push(fn); }
      }
    },
    tabs: {
      query: function () {
        return Promise.resolve([{ url: 'https://example.com/article' }]);
      }
    },
    runtime: {
      getManifest: function () { return { version: '1.0.0' }; },
      getURL: function (path) { return path; },
      openOptionsPage: function () {
        window.parent.postMessage({ type: 'ep-open-options' }, '*');
        return Promise.resolve();
      },
      onInstalled: { addListener: function () {} },
      onStartup: { addListener: function () {} }
    },
    action: {
      setBadgeText: function () { return Promise.resolve(); },
      setBadgeBackgroundColor: function () { return Promise.resolve(); },
      setBadgeTextColor: function () { return Promise.resolve(); }
    },
    alarms: {
      create: function () { return Promise.resolve(); },
      onAlarm: { addListener: function () {} }
    }
  };

  if (channel) {
    channel.onmessage = function (ev) {
      var d = ev && ev.data;
      if (!d || d.type !== 'ep-set') return;
      var old = store[d.key];
      store[d.key] = clone(d.value);
      fire(d.key, old, d.value);
    };
  }
})();

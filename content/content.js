/*
 * Eye Protector — 内容脚本
 *
 * 于 document_start 注入，根据存储中的设置向页面应用滤镜：
 *   - 在 <html> 根元素上应用暖色/亮度/对比度/饱和度滤镜；
 *   - “保持图片原色”模式下，对媒体元素应用 SVG 逆矩阵补偿；
 *   - 通过 storage.onChanged 实时响应设置变化，无需刷新页面。
 */
(function () {
  'use strict';

  var EP = globalThis.EyeProtector;
  var settings = null;
  var systemDark = false;
  var darkQuery = null;
  var watchTimer = null;

  /* ------------------------------------------------------------ */
  /* DOM 注入                                                      */
  /* ------------------------------------------------------------ */

  function ensureNode(id, factory, parent) {
    var el = document.getElementById(id);
    if (!el) {
      el = factory();
      parent.appendChild(el);
    }
    return el;
  }

  function ensureStyle(id, cssText) {
    // document_start 时 <head> 可能尚不存在，挂到 <html> 上同样生效
    var el = ensureNode(id, function () {
      var style = document.createElement('style');
      style.id = id;
      return style;
    }, document.head || document.documentElement);
    if (el.textContent !== cssText) el.textContent = cssText;
    return el;
  }

  /**
   * 补偿滤镜的 SVG 节点由 lib/shared.js 用 DOM API 构建；
   * 参数变化时只更新 feColorMatrix 的 values，不重建节点。
   * 注意不能放进 <head>（display:none），否则 Firefox 无法解析 url(#…) 引用。
   */
  function ensureInverseSVG() {
    var wrapper = ensureNode(EP.SVG_ID, function () {
      var div = document.createElement('div');
      div.id = EP.SVG_ID;
      div.setAttribute('aria-hidden', 'true');
      return div;
    }, document.body || document.documentElement);
    EP.renderInverseSVG(wrapper, settings);
    return wrapper;
  }

  function removeAll() {
    [EP.STYLE_ID, EP.CUSTOM_STYLE_ID, EP.SVG_ID].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  /* ------------------------------------------------------------ */
  /* 应用 / 移除                                                   */
  /* ------------------------------------------------------------ */

  function apply() {
    if (!settings) return;
    var active = EP.isActive(settings, {
      host: location.hostname,
      now: new Date(),
      systemDark: systemDark
    });

    if (!active) {
      removeAll();
      return;
    }

    ensureStyle(EP.STYLE_ID, EP.buildCoreCSS(settings));

    if (settings.customCSSEnabled && settings.customCSS) {
      ensureStyle(EP.CUSTOM_STYLE_ID, settings.customCSS);
    } else {
      var custom = document.getElementById(EP.CUSTOM_STYLE_ID);
      if (custom) custom.remove();
    }

    if (settings.imageMode === 'protect') {
      ensureInverseSVG(); // 首次创建，之后仅更新矩阵
    } else {
      var svg = document.getElementById(EP.SVG_ID);
      if (svg) svg.remove();
    }
  }

  /* ------------------------------------------------------------ */
  /* 初始化与监听                                                  */
  /* ------------------------------------------------------------ */

  function startWatchdog() {
    if (watchTimer) return;
    watchTimer = setInterval(apply, 30000);
  }

  EP.getSettings().then(function (s) {
    settings = s;
    if (typeof matchMedia === 'function') {
      darkQuery = matchMedia('(prefers-color-scheme: dark)');
      systemDark = darkQuery.matches;
      var onDarkChange = function (e) {
        systemDark = e.matches;
        apply();
      };
      if (darkQuery.addEventListener) darkQuery.addEventListener('change', onDarkChange);
      else if (darkQuery.addListener) darkQuery.addListener(onDarkChange);
    }
    apply();
    // SPA 路由切换 / 定时任务边界等场景下兜底刷新
    startWatchdog();
  });

  browser.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes || !changes[EP.STORAGE_KEY]) return;
    settings = EP.mergeSettings(changes[EP.STORAGE_KEY].newValue);
    apply();
  });
})();

/*
 * Eye Protector — 界面预览页脚本
 *
 * 把真实的 popup / options 页面加载进 iframe，并注入 mock-browser.js。
 * 独立成文件而非内联 <script>，是为了即便被误打进扩展包也不触发
 * AMO 校验器的 “Inline scripts blocked by default” 警告。
 * 不属于扩展本体（见 web-ext-config.cjs 的 ignoreFiles）。
 */
(function () {
  'use strict';

  function mountIframe(iframe, pageUrl, baseHref) {
    fetch(pageUrl)
      .then(function (res) { return res.text(); })
      .then(function (html) {
        var shim = '<base href="' + baseHref + '">' +
          '<script src="/docs/mock-browser.js"><\/script>';
        var injected = html.replace(/<head[^>]*>/i, function (m) {
          return m + shim;
        });
        var doc = iframe.contentDocument;
        doc.open();
        doc.write(injected);
        doc.close();
      });
  }

  var popupIframe = document.getElementById('popupIframe');
  var optionsIframe = document.getElementById('optionsIframe');
  mountIframe(popupIframe, '../popup/popup.html', '../popup/');
  mountIframe(optionsIframe, '../options/options.html', '../options/');

  // popup 中点击“设置”时高亮设置页预览
  window.addEventListener('message', function (ev) {
    if (!ev.data || ev.data.type !== 'ep-open-options') return;
    var frame = document.getElementById('optionsFrame');
    frame.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    frame.classList.add('flash');
    setTimeout(function () { frame.classList.remove('flash'); }, 1400);
  });
})();

/*
 * Eye Protector — 共享核心逻辑
 *
 * 以全局对象 `EyeProtector` 暴露，供 background / content / popup / options
 * 四个运行环境共用（Manifest V3 下均不支持 ES Module，故采用 IIFE）。
 *
 * 包含：
 *   - 默认设置与预设方案
 *   - 暖色/亮度/对比度/饱和度 -> CSS filter 的换算
 *   - “保持图片原色”所需的补偿滤镜（SVG feColorMatrix 逆矩阵）
 *   - 自动模式（定时 / 跟随系统）与网站排除的判定
 */
(function (root) {
  'use strict';

  /** 暖色滑块最大值对应的 sepia 强度。控制在 0.55，避免整体过黄。 */
  var MAX_SEPIA = 0.55;

  var DEFAULTS = Object.freeze({
    enabled: false,          // 护眼模式总开关（autoMode 为 manual 时生效）
    activePreset: 'warm',    // warm | night | reading | focus
    warmth: 42,              // 暖色程度 0 - 100
    brightness: 97,          // 页面亮度 75 - 100
    contrast: 98,            // 对比度 85 - 105
    saturation: 92,          // 饱和度 40 - 100
    imageMode: 'follow',     // follow | protect | dim | desaturate
    imageBrightness: 85,     // “降低图片亮度”模式的强度
    imageSaturation: 60,     // “降低图片饱和度”模式的强度
    autoMode: 'manual',      // manual | schedule | system
    scheduleStart: '20:00',
    scheduleEnd: '07:00',
    excludedSites: [],       // 排除的域名列表（匹配子域名）
    customCSSEnabled: false,
    customCSS: ''
  });

  var LIMITS = Object.freeze({
    warmth: [0, 100],
    brightness: [75, 100],
    contrast: [85, 105],
    saturation: [40, 100],
    imageBrightness: [60, 100],
    imageSaturation: [0, 100]
  });

  var PRESETS = Object.freeze([
    { id: 'warm',    name: '暖阳', desc: '日常浏览，轻微暖色', icon: 'sunrise',
      warmth: 42, brightness: 97, contrast: 98, saturation: 92 },
    { id: 'night',   name: '夜间', desc: '深夜使用，显著削弱蓝光与亮度', icon: 'moon',
      warmth: 78, brightness: 84, contrast: 94, saturation: 78 },
    { id: 'reading', name: '阅读', desc: '阅读文章与文档，降低色彩刺激', icon: 'book',
      warmth: 30, brightness: 100, contrast: 100, saturation: 66 },
    { id: 'focus',   name: '专注', desc: '长时间工作，低饱和柔和画面', icon: 'monitor',
      warmth: 20, brightness: 95, contrast: 96, saturation: 52 }
  ]);

  var IMAGE_MODES = Object.freeze(['follow', 'protect', 'dim', 'desaturate']);

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                            */
  /* ------------------------------------------------------------------ */

  function clamp(value, min, max) {
    var v = Number(value);
    if (Number.isNaN(v)) return min;
    return Math.min(max, Math.max(min, v));
  }

  function round(value, decimals) {
    var d = decimals == null ? 4 : decimals;
    var f = Math.pow(10, d);
    return Math.round(value * f) / f;
  }

  function clampByKey(key, value) {
    var range = LIMITS[key];
    return range ? clamp(value, range[0], range[1]) : value;
  }

  /** 合并存储中的设置与默认值，并清洗每个字段。 */
  function mergeSettings(raw) {
    var s = Object.assign({}, DEFAULTS, raw || {});
    s.enabled = !!s.enabled;
    s.warmth = clampByKey('warmth', s.warmth);
    s.brightness = clampByKey('brightness', s.brightness);
    s.contrast = clampByKey('contrast', s.contrast);
    s.saturation = clampByKey('saturation', s.saturation);
    s.imageBrightness = clampByKey('imageBrightness', s.imageBrightness);
    s.imageSaturation = clampByKey('imageSaturation', s.imageSaturation);
    if (IMAGE_MODES.indexOf(s.imageMode) === -1) s.imageMode = 'follow';
    if (['manual', 'schedule', 'system'].indexOf(s.autoMode) === -1) {
      s.autoMode = 'manual';
    }
    if (!/^\d{2}:\d{2}$/.test(s.scheduleStart)) s.scheduleStart = DEFAULTS.scheduleStart;
    if (!/^\d{2}:\d{2}$/.test(s.scheduleEnd)) s.scheduleEnd = DEFAULTS.scheduleEnd;
    if (!PRESETS.some(function (p) { return p.id === s.activePreset; })) {
      s.activePreset = DEFAULTS.activePreset;
    }
    if (!Array.isArray(s.excludedSites)) s.excludedSites = [];
    s.excludedSites = s.excludedSites
      .map(function (d) { return String(d).trim().toLowerCase(); })
      .filter(function (d, i, arr) { return d && arr.indexOf(d) === i; });
    s.customCSSEnabled = !!s.customCSSEnabled;
    s.customCSS = typeof s.customCSS === 'string' ? s.customCSS : '';
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* 颜色矩阵：sepia / saturate 及其逆矩阵                                */
  /* ------------------------------------------------------------------ */

  /**
   * CSS sepia(a) 的 3x3 颜色矩阵（单位矩阵与 sepia 基准矩阵的线性插值）。
   * 基准矩阵取自 SVG feColorMatrix sepia 定义。
   */
  function sepiaMatrix(a) {
    var base = [
      0.393, 0.769, 0.189,
      0.349, 0.686, 0.168,
      0.272, 0.534, 0.131
    ];
    var m = new Array(9);
    for (var i = 0; i < 9; i++) {
      var identity = (i % 4 === 0) ? 1 : 0; // 3x3 单位矩阵
      m[i] = (1 - a) * identity + a * base[i];
    }
    return m;
  }

  /** CSS saturate(t) 的 3x3 颜色矩阵（W3C Filter Effects 规范）。 */
  function saturateMatrix(t) {
    return [
      0.213 + 0.787 * t, 0.715 - 0.715 * t, 0.072 - 0.072 * t,
      0.213 - 0.213 * t, 0.715 + 0.285 * t, 0.072 - 0.072 * t,
      0.213 - 0.213 * t, 0.715 - 0.715 * t, 0.072 + 0.928 * t
    ];
  }

  function multiply3(a, b) {
    var out = new Array(9);
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        out[r * 3 + c] =
          a[r * 3] * b[c] +
          a[r * 3 + 1] * b[3 + c] +
          a[r * 3 + 2] * b[6 + c];
      }
    }
    return out;
  }

  /** 3x3 矩阵求逆（伴随矩阵法）。矩阵均为主对角占优，可逆。 */
  function invert3(m) {
    var a = m[0], b = m[1], c = m[2],
        d = m[3], e = m[4], f = m[5],
        g = m[6], h = m[7], i = m[8];
    var A = e * i - f * h,
        B = -(d * i - f * g),
        C = d * h - e * g;
    var det = a * A + b * B + c * C;
    if (!det) return null;
    return [
      A / det, (c * h - b * i) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, (c * d - a * f) / det,
      C / det, (b * g - a * h) / det, (a * e - b * d) / det
    ];
  }

  /* ------------------------------------------------------------------ */
  /* 滤镜计算                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * 将设置换算为滤镜参数。
   *
   * 全局滤镜函数按 brightness -> contrast -> sepia -> saturate 顺序应用，
   * 使 sepia 与 saturate 两个颜色矩阵相邻，便于用单个 feColorMatrix
   * 求逆后对图片做“原色补偿”。
   */
  function filterParts(settings) {
    var s = settings || DEFAULTS;
    var sepia = round(clamp(s.warmth, 0, 100) / 100 * MAX_SEPIA);
    var brightness = round(s.brightness / 100);
    var contrast = round(s.contrast / 100);
    var saturation = round(s.saturation / 100);

    // 全局滤镜对像素的作用：Sat * Sep * Con * Bri
    // 图片补偿需先应用 (Sat * Sep)^-1，再 contrast(1/c) brightness(1/b)
    var combined = multiply3(saturateMatrix(saturation), sepiaMatrix(sepia));
    var inverse = invert3(combined) || [1, 0, 0, 0, 1, 0, 0, 0, 1];

    // 转为 feColorMatrix 需要的 20 参数（4x5，Alpha 通道恒等）
    var matrixValues = [
      inverse[0], inverse[1], inverse[2], 0, 0,
      inverse[3], inverse[4], inverse[5], 0, 0,
      inverse[6], inverse[7], inverse[8], 0, 0,
      0, 0, 0, 1, 0
    ].map(function (n) { return round(n, 5); });

    return {
      sepia: sepia,
      brightness: brightness,
      contrast: contrast,
      saturation: saturation,
      pageFilter: 'brightness(' + brightness + ') contrast(' + contrast +
        ') sepia(' + sepia + ') saturate(' + saturation + ')',
      inverseMatrixValues: matrixValues,
      // url(#…) 之外的线性补偿部分，顺序不可改变
      inverseTail: 'contrast(' + round(1 / contrast) + ') brightness(' + round(1 / brightness) + ')'
    };
  }

  var MEDIA_SELECTOR = 'img, video, canvas, embed, object, svg image';

  /** 生成注入页面的核心 CSS（不含自定义 CSS）。 */
  function buildCoreCSS(settings) {
    var p = filterParts(settings);
    var css =
      'html {\n' +
      '  filter: ' + p.pageFilter + ' !important;\n' +
      '  transition: filter 0.35s ease !important;\n' +
      '}\n';

    if (settings.imageMode === 'protect') {
      css += MEDIA_SELECTOR + ' {\n' +
        '  filter: url(#' + EyeProtector.INVERSE_FILTER_ID + ') ' + p.inverseTail + ' !important;\n' +
        '}\n';
    } else if (settings.imageMode === 'dim') {
      css += MEDIA_SELECTOR + ' {\n' +
        '  filter: brightness(' + round(settings.imageBrightness / 100) + ') !important;\n' +
        '}\n';
    } else if (settings.imageMode === 'desaturate') {
      css += MEDIA_SELECTOR + ' {\n' +
        '  filter: saturate(' + round(settings.imageSaturation / 100) + ') !important;\n' +
        '}\n';
    }
    return css;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * 创建图片原色补偿所需的 SVG 滤镜节点：
   *   <svg><defs><filter id=…><feColorMatrix values=…/></filter></defs></svg>
   *
   * 全程使用 DOM API 构建（createElementNS / setAttribute），不拼接 HTML 字符串，
   * 既满足 AMO 审核对动态 HTML 赋值的限制，也避免任何注入面。
   * 不用 display:none 隐藏：Firefox 不会解析位于 display:none 子树中的 <filter>。
   */
  function createInverseSVG(settings, doc) {
    doc = doc || document;
    var p = filterParts(settings);

    var svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.overflow = 'hidden';

    var defs = doc.createElementNS(SVG_NS, 'defs');
    var filter = doc.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', EyeProtector.INVERSE_FILTER_ID);
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    var matrix = doc.createElementNS(SVG_NS, 'feColorMatrix');
    matrix.setAttribute('type', 'matrix');
    matrix.setAttribute('values', p.inverseMatrixValues.join(' '));

    filter.appendChild(matrix);
    defs.appendChild(filter);
    svg.appendChild(defs);
    return svg;
  }

  /**
   * 把补偿矩阵渲染到给定容器中：
   * 容器内已有 feColorMatrix 时仅更新 values（参数变化时的高频路径），
   * 否则清空容器并新建完整的 SVG 节点。
   */
  function renderInverseSVG(container, settings) {
    var values = filterParts(settings).inverseMatrixValues.join(' ');
    var matrix = container.querySelector('feColorMatrix');
    if (matrix) {
      if (matrix.getAttribute('values') !== values) matrix.setAttribute('values', values);
      return;
    }
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(createInverseSVG(settings, container.ownerDocument));
  }

  /* ------------------------------------------------------------------ */
  /* 状态判定                                                            */
  /* ------------------------------------------------------------------ */

  function parseTime(str) {
    var m = /^(\d{2}):(\d{2})$/.exec(str || '');
    if (!m) return null;
    var h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  /** 指定时刻是否落在 [start, end) 时间窗内（支持跨夜）。 */
  function scheduleActive(now, start, end) {
    var s = parseTime(start), e = parseTime(end);
    if (s == null || e == null || s === e) return false;
    var cur = now.getHours() * 60 + now.getMinutes();
    if (s < e) return cur >= s && cur < e;
    return cur >= s || cur < e; // 跨零点，例如 20:00 - 07:00
  }

  /** 域名（含子域名）是否在排除列表中。 */
  function hostExcluded(host, list) {
    host = (host || '').toLowerCase();
    if (!host) return false;
    return (list || []).some(function (d) {
      return host === d || host.endsWith('.' + d);
    });
  }

  /**
   * 计算护眼模式的实际生效状态。
   * env: { host?: string, now?: Date, systemDark?: boolean }
   */
  function isActive(settings, env) {
    env = env || {};
    if (env.host && hostExcluded(env.host, settings.excludedSites)) return false;
    switch (settings.autoMode) {
      case 'schedule':
        return scheduleActive(env.now || new Date(), settings.scheduleStart, settings.scheduleEnd);
      case 'system':
        return !!env.systemDark;
      default:
        return settings.enabled;
    }
  }

  /** 当前参数与哪个预设一致；不一致返回 null（自定义）。 */
  function detectPreset(settings) {
    for (var i = 0; i < PRESETS.length; i++) {
      var p = PRESETS[i];
      if (p.warmth === settings.warmth &&
          p.brightness === settings.brightness &&
          p.contrast === settings.contrast &&
          p.saturation === settings.saturation) {
        return p.id;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 存储读写（依赖 WebExtension browser API）                            */
  /* ------------------------------------------------------------------ */

  var STORAGE_KEY = 'settings';

  function getSettings() {
    return browser.storage.local.get(STORAGE_KEY).then(function (res) {
      return mergeSettings(res && res[STORAGE_KEY]);
    });
  }

  function setSettings(patch) {
    return getSettings().then(function (merged) {
      var next = mergeSettings(Object.assign({}, merged, patch));
      return browser.storage.local.set({ settings: next }).then(function () {
        return next;
      });
    });
  }

  /* ------------------------------------------------------------------ */

  var EyeProtector = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULTS: DEFAULTS,
    LIMITS: LIMITS,
    PRESETS: PRESETS,
    IMAGE_MODES: IMAGE_MODES,
    MAX_SEPIA: MAX_SEPIA,
    STYLE_ID: 'eye-protector-style',
    CUSTOM_STYLE_ID: 'eye-protector-custom-style',
    SVG_ID: 'eye-protector-svg',
    INVERSE_FILTER_ID: 'eye-protector-inverse',

    clamp: clamp,
    round: round,
    mergeSettings: mergeSettings,
    filterParts: filterParts,
    buildCoreCSS: buildCoreCSS,
    createInverseSVG: createInverseSVG,
    renderInverseSVG: renderInverseSVG,
    scheduleActive: scheduleActive,
    hostExcluded: hostExcluded,
    isActive: isActive,
    detectPreset: detectPreset,
    getSettings: getSettings,
    setSettings: setSettings
  };

  root.EyeProtector = EyeProtector;
})(typeof globalThis !== 'undefined' ? globalThis : this);

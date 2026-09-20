// web-ext 配置（`npm run build` / `npm run lint` / `npm start` 自动读取）
//
// 只有扩展本体会被打进 zip：manifest.json、lib/、background/、content/、
// popup/、options/、icons/。下面列出的都是仓库辅助文件，不能进入上传包。
// web-ext 默认还会排除 .git、node_modules、*.zip / *.xpi 及 artifacts 目录本身。
module.exports = {
  sourceDir: '.',
  artifactsDir: 'dist',
  ignoreFiles: [
    'docs',
    'docs/**',
    'dist',
    'dist/**',
    'web-ext-config.cjs',
    'package.json',
    'package-lock.json',
    'README.md',
    'LICENSE',
    '.gitignore'
  ],
  build: {
    overwriteDest: true,
    filename: 'eye-protector-{version}.zip'
  }
};

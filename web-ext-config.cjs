// web-ext 配置：docs 与配置文件不属于扩展本体，打包与 lint 时排除
module.exports = {
  sourceDir: '.',
  ignoreFiles: [
    'docs/**',
    'web-ext-config.cjs',
    'README.md',
    'LICENSE',
    '.gitignore'
  ]
};

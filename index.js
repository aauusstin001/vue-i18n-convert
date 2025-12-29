#!/usr/bin/env node

/**
 * Vue i18n 转换工具 CLI 入口
 * 使用方式: vue-i18n-convert <vue-file-path> [zh-file-path] [options]
 */

const { convertVueFile } = require('./src/parser');

// 获取命令行参数
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
Vue i18n 转换工具
=================

使用方式:
  vue-i18n-convert <vue文件路径> [zh.js文件路径] [选项]

示例:
  vue-i18n-convert ./src/components/HelloWorld.vue
  vue-i18n-convert ./src/components/HelloWorld.vue ./locales/zh.js
  vue-i18n-convert ./src/components/HelloWorld.vue --skip-unmatched
  vue-i18n-convert ./src/components/HelloWorld.vue ./locales/zh.js --match-path pda
  vue-i18n-convert ./src/components/HelloWorld.vue -mp pda.barcode

选项:
  --skip-unmatched, -s       跳过在 zh.js 中匹配不到的文本，不进行转换（默认会转换）
  --match-path <prefix>, -mp <prefix>
                             只匹配指定路径前缀的 key（common. 前缀始终匹配）

功能:
  - 自动将 template 中的中文转换为 {{ $t('key') }}
  - 自动将 script 中的中文转换为 i18n.t('key')
  - 支持模板字符串，转换为 i18n.t('文本{param1}', {param1: xxx})
  - 跳过 console.* 和注释中的内容
  - 跳过纯英文、纯数字

zh.js 语言包支持:
  - 如果提供 zh.js 文件路径，将使用其中定义的 key 进行映射
  - 如果未提供，工具会自动在常见位置查找 zh.js 文件
  - 如果中文在 zh.js 中有对应的 key，则使用该 key
  - 默认情况：如果中文在 zh.js 中没有对应的 key，则使用中文本身作为 key
  - 使用 --skip-unmatched：如果中文在 zh.js 中没有对应的 key，则保留原中文不转换
  `);
  process.exit(0);
}

// 解析参数
let filePath = null;
let zhFilePath = null;
let skipUnmatched = false;
let matchPath = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--skip-unmatched' || arg === '-s') {
    skipUnmatched = true;
  } else if (arg === '--match-path' || arg === '-mp') {
    // 下一个参数是路径前缀
    if (i + 1 < args.length) {
      matchPath = args[i + 1];
      i++; // 跳过下一个参数
    }
  } else if (arg.endsWith('.vue')) {
    filePath = arg;
  } else if (arg.endsWith('.js')) {
    zhFilePath = arg;
  }
}

if (!filePath) {
  console.error('错误: 请提供 .vue 文件路径');
  process.exit(1);
}

// 转换文件
convertVueFile(filePath, zhFilePath, { skipUnmatched, matchPath });

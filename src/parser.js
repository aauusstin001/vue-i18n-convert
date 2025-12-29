/**
 * 主解析器：解析 Vue 文件并转换
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('@vue/compiler-sfc');
const { convertTemplate } = require('./templateParser');
const { convertScript } = require('./scriptParser');
const { loadI18nMap, setConvertOptions, resetUnmatchedTexts, saveUnmatchedKeys } = require('./utils');

/**
 * 解析并转换 Vue 文件
 * @param {string} filePath - Vue 文件路径
 * @returns {string} 转换后的文件内容
 */
function parseVueFile(filePath) {
  // 读取文件
  const source = fs.readFileSync(filePath, 'utf-8');

  // 使用 @vue/compiler-sfc 解析
  const { descriptor, errors } = parse(source);

  if (errors && errors.length > 0) {
    console.error('解析 Vue 文件失败:', errors);
    throw new Error('Vue 文件格式错误');
  }

  let result = '';
  let currentIndex = 0;

  // 处理 template
  if (descriptor.template) {
    const templateBlock = descriptor.template;
    const originalContent = templateBlock.content;
    const convertedContent = convertTemplate(originalContent);

    // 获取 template 标签的位置
    const templateStart = source.indexOf(originalContent, currentIndex);
    const beforeTemplate = source.substring(0, templateStart);
    result += beforeTemplate + convertedContent;
    currentIndex = templateStart + originalContent.length;
  }

  // 处理 script
  if (descriptor.script || descriptor.scriptSetup) {
    const scriptBlock = descriptor.script || descriptor.scriptSetup;
    const originalContent = scriptBlock.content;
    const convertedContent = convertScript(originalContent);

    // 找到 script 内容的位置
    const scriptStart = source.indexOf(originalContent, currentIndex);
    const beforeScript = source.substring(currentIndex, scriptStart);
    result += beforeScript + convertedContent;
    currentIndex = scriptStart + originalContent.length;
  }

  // 添加剩余部分（如 style 等）
  result += source.substring(currentIndex);

  return result;
}

/**
 * 转换 Vue 文件并保存
 * @param {string} filePath - Vue 文件路径
 * @param {string} zhFilePath - zh.js 语言包文件路径（可选）
 * @param {Object} options - 转换选项
 * @param {boolean} options.skipUnmatched - 是否跳过未匹配的文本
 */
function convertVueFile(filePath, zhFilePath, options = {}) {
  try {
    console.log(`\n开始处理: ${filePath}`);

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      console.error(`错误: 文件不存在 - ${filePath}`);
      return;
    }

    // 检查是否是 .vue 文件
    if (!filePath.endsWith('.vue')) {
      console.error('错误: 请提供 .vue 文件');
      return;
    }

    // 重置未匹配文本集合（每次转换前清空）
    resetUnmatchedTexts();

    // 设置转换选项
    setConvertOptions(options);

    // 加载语言包文件
    if (zhFilePath) {
      // 如果提供了语言包路径
      const absoluteZhPath = path.resolve(zhFilePath);
      if (fs.existsSync(absoluteZhPath)) {
        loadI18nMap(absoluteZhPath);
      } else {
        console.warn(`⚠ 语言包文件不存在: ${zhFilePath}`);
      }
    } else {
      // 尝试在当前目录和父目录查找 zh.js
      const vueFileDir = path.dirname(path.resolve(filePath));
      const possiblePaths = [
        path.join(vueFileDir, 'zh.js'),
        path.join(vueFileDir, '../zh.js'),
        path.join(vueFileDir, '../../zh.js'),
        path.join(process.cwd(), 'zh.js')
      ];

      let found = false;
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          loadI18nMap(possiblePath);
          found = true;
          break;
        }
      }

      if (!found) {
        console.log('ℹ 未找到 zh.js 语言包，将使用中文作为 key');
      }
    }

    // 解析并转换
    const convertedContent = parseVueFile(filePath);

    // 写回文件
    fs.writeFileSync(filePath, convertedContent, 'utf-8');

    console.log(`✓ 转换完成: ${filePath}`);

    // 保存未匹配的文本到 nomatch.txt（追加模式，输出到项目根目录）
    const outputDir = process.cwd();
    saveUnmatchedKeys(outputDir);
  } catch (error) {
    console.error(`处理失败: ${error.message}`);
    console.error(error.stack);
  }
}

module.exports = {
  parseVueFile,
  convertVueFile
};

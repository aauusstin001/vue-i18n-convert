/**
 * 工具函数
 */

/**
 * 检测字符串是否包含中文（用于判断是否需要转换）
 * 注意：函数名为历史原因保留，实际检测的是"是否包含中文"而非"是否只有中文"
 * @param {string} str
 * @returns {boolean}
 */
function isOnlyChinese(str) {
  if (!str || typeof str !== 'string') return false;

  // 去除首尾空格和换行
  str = str.trim();

  if (str.length === 0) return false;

  // 纯数字跳过
  if (/^\d+$/.test(str)) return false;

  // 检测是否包含中文
  const hasChinese = /[\u4e00-\u9fa5]/.test(str);

  // 只要包含中文就转换，不管是否有英文
  return hasChinese;
}

/**
 * 清理字符串：只去除首尾空格，保留换行符、制表符等特殊字符
 * @param {string} str
 * @returns {string}
 */
function cleanString(str) {
  if (!str) return '';
  // 只去除首尾空格，不移除 \n \r \t 等字符，这些字符需要保留用于匹配
  return str.trim();
}
/**
 * 检测字符串是否已经是 i18n 格式
 * @param {string} str
 * @returns {boolean}
 */
function isAlreadyI18n(str) {
  return str.includes('$t(') || str.includes('i18n.t(');
}

/**
 * 提取模板字符串中的变量
 * 将 ${xxx} 转换为 {param1}, {param2}...
 * @param {string} template
 * @returns {Object} { text: '转换后的文本', params: ['param1', 'param2'], hasChinese: boolean }
 */
function extractTemplateVars(template) {
  let paramIndex = 1;
  const params = [];

  // 先检查去除变量后的文本是否只包含中文
  const textWithoutVars = template.replace(/\$\{[^}]+\}/g, '');
  const hasChinese = isOnlyChinese(textWithoutVars);

  // 匹配 ${...} 格式
  const text = template.replace(/\$\{([^}]+)\}/g, (match, expr) => {
    const paramName = `param${paramIndex}`;
    params.push({ name: paramName, expr: expr.trim() });
    paramIndex++;
    return `{${paramName}}`;
  });

  return { text, params, hasChinese };
}

/**
 * 展平嵌套对象，生成中文到 key 路径的映射
 * 当同一个中文有多个映射时，将它们都保存为数组
 * @param {Object} obj - 语言包对象
 * @param {string} prefix - 前缀路径
 * @param {Map} result - 结果映射表（中文 -> key 或 [key1, key2, ...]）
 * @returns {Map} 中文 -> key路径的映射
 */
function flattenI18nObject(obj, prefix = '', result = new Map()) {
  for (const key in obj) {
    const value = obj[key];
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // 递归处理嵌套对象
      flattenI18nObject(value, fullKey, result);
    } else if (typeof value === 'string') {
      // 检测并去掉冒号后缀
      const { textWithoutColon } = detectColonSuffix(value);

      // 如果该中文已存在，将新的 key 添加到数组中
      const existing = result.get(textWithoutColon);
      if (existing) {
        if (Array.isArray(existing)) {
          // 已经是数组，添加新的 key
          existing.push(fullKey);
        } else {
          // 转换为数组
          result.set(textWithoutColon, [existing, fullKey]);
        }
      } else {
        // 首次出现，直接保存
        result.set(textWithoutColon, fullKey);
      }
    }
  }
  return result;
}

/**
 * 全局 i18n 映射表
 */
let i18nMap = new Map();

/**
 * 未匹配的中文文本集合（使用 Set 避免重复）
 */
let unmatchedTexts = new Set();

/**
 * 转换选项
 */
let skipUnmatched = false;
let matchPath = null;

/**
 * 设置转换选项
 * @param {Object} options - 选项对象
 * @param {boolean} options.skipUnmatched - 是否跳过未匹配的文本
 * @param {string} options.matchPath - 匹配的路径前缀（如 'pda'、'pda.barcode'）
 */
function setConvertOptions(options = {}) {
  skipUnmatched = options.skipUnmatched || false;
  matchPath = options.matchPath || null;
}

/**
 * 加载 zh.js 语言包文件（支持 CommonJS 和 ES6 模块）
 * @param {string} zhFilePath - zh.js 文件路径
 */
function loadI18nMap(zhFilePath) {
  try {
    const fs = require('fs');
    const path = require('path');

    // 读取文件内容
    let fileContent = fs.readFileSync(zhFilePath, 'utf8');
    let zhData;

    // 检测是否为 ES6 模块（export default）
    if (fileContent.includes('export default')) {
      // 将 ES6 语法转换为 CommonJS
      fileContent = fileContent.replace(/export\s+default\s+/, 'module.exports = ');

      // 创建临时文件（使用绝对路径）
      const absolutePath = path.resolve(zhFilePath);
      const tmpPath = path.join(path.dirname(absolutePath), `.tmp_${path.basename(zhFilePath)}`);
      fs.writeFileSync(tmpPath, fileContent, 'utf8');

      try {
        // 加载临时文件（直接使用绝对路径）
        delete require.cache[tmpPath];
        zhData = require(tmpPath);

        // 删除临时文件
        fs.unlinkSync(tmpPath);
      } catch (err) {
        // 确保删除临时文件
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
        throw err;
      }
    } else {
      // CommonJS 模块，直接 require
      const absolutePath = path.resolve(zhFilePath);
      delete require.cache[absolutePath];
      zhData = require(absolutePath);
    }

    // 处理可能的 default 包装
    if (zhData && zhData.default) {
      zhData = zhData.default;
    }

    i18nMap = flattenI18nObject(zhData);
    console.log(`✓ 已加载语言包: ${zhFilePath}，共 ${i18nMap.size} 个映射`);
  } catch (error) {
    console.warn(`⚠ 无法加载语言包文件: ${zhFilePath}`);
    console.warn(`错误信息: ${error.message}`);
    i18nMap = new Map();
  }
}

/**
 * 重置未匹配文本集合
 */
function resetUnmatchedTexts() {
  unmatchedTexts.clear();
}

/**
 * 检测字符串是否以冒号结尾
 * @param {string} str
 * @returns {Object} { hasColonSuffix: boolean, colonChar: string, textWithoutColon: string }
 */
function detectColonSuffix(str) {
  if (!str || typeof str !== 'string') {
    return { hasColonSuffix: false, colonChar: '', textWithoutColon: str };
  }

  // 检测中文冒号或英文冒号
  if (str.endsWith('：')) {
    return {
      hasColonSuffix: true,
      colonChar: '：',
      textWithoutColon: str.slice(0, -1)
    };
  } else if (str.endsWith(':')) {
    return {
      hasColonSuffix: true,
      colonChar: ':',
      textWithoutColon: str.slice(0, -1)
    };
  }

  return { hasColonSuffix: false, colonChar: '', textWithoutColon: str };
}

/**
 * 检查 key 是否匹配指定的路径前缀
 * @param {string} key - i18n key（如 'common.title', 'pda.scan'）
 * @returns {boolean} 是否匹配
 */
function isKeyPathMatched(key) {
  // 如果没有设置 matchPath，匹配所有 key
  if (!matchPath) {
    return true;
  }

  // common. 前缀始终匹配
  if (key.startsWith('common.')) {
    return true;
  }

  // 检查是否匹配指定的前缀
  // matchPath 可以是 'pda' 或 'pda.barcode' 等
  // 匹配规则：key 以 'matchPath.' 开头
  if (key.startsWith(matchPath + '.')) {
    return true;
  }

  return false;
}

/**
 * 根据中文获取对应的 key
 * 当有多个映射时，按照优先级选择：common > matchPath > 其他
 * @param {string} chineseText - 中文文本
 * @returns {string|null} 如果找到映射返回 key；未找到时：skipUnmatched=true 返回 null，skipUnmatched=false 返回原中文
 */
function getKeyForChinese(chineseText) {
  if (i18nMap.has(chineseText)) {
    const keyOrKeys = i18nMap.get(chineseText);

    // 如果是单个 key（字符串）
    if (typeof keyOrKeys === 'string') {
      // 检查 key 是否匹配指定的路径前缀
      if (!isKeyPathMatched(keyOrKeys)) {
        // key 存在但路径前缀不匹配，视为未匹配
        unmatchedTexts.add(chineseText);

        if (skipUnmatched) {
          return null;
        }

        return chineseText;
      }

      return keyOrKeys;
    }

    // 如果是多个 key（数组），按优先级选择
    if (Array.isArray(keyOrKeys)) {
      // 优先级 1: common. 前缀
      const commonKey = keyOrKeys.find(k => k.startsWith('common.'));
      if (commonKey) {
        return commonKey;
      }

      // 优先级 2: matchPath 前缀
      if (matchPath) {
        const matchPathKey = keyOrKeys.find(k => k.startsWith(matchPath + '.'));
        if (matchPathKey) {
          return matchPathKey;
        }
      }

      // 优先级 3: 使用第一个
      const selectedKey = keyOrKeys[0];

      // 检查选中的 key 是否匹配路径前缀
      if (!isKeyPathMatched(selectedKey)) {
        unmatchedTexts.add(chineseText);

        if (skipUnmatched) {
          return null;
        }

        return chineseText;
      }

      return selectedKey;
    }
  }

  // 记录未匹配的中文文本
  unmatchedTexts.add(chineseText);

  // 如果设置了跳过未匹配文本，返回 null 表示不转换
  if (skipUnmatched) {
    return null;
  }

  return chineseText;
}

/**
 * 保存未匹配的文本到 nomatch.txt 文件（追加模式）
 * @param {string} outputDir - 输出目录
 */
function saveUnmatchedKeys(outputDir) {
  if (unmatchedTexts.size === 0) {
    return;
  }

  const fs = require('fs');
  const path = require('path');
  const nomatchPath = path.join(outputDir, 'nomatch.txt');

  // 生成时间戳
  const timestamp = new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  // 构建输出内容
  let content = `\n========== ${timestamp} ==========\n`;
  content += `未匹配的中文文本 (共 ${unmatchedTexts.size} 个):\n`;
  // 转义特殊字符，让换行符、制表符等可见
  content += Array.from(unmatchedTexts).map(text => {
    const escaped = text
      .replace(/\\/g, '\\\\')  // 先转义反斜杠
      .replace(/\n/g, '\\n')   // 转义换行符
      .replace(/\r/g, '\\r')   // 转义回车符
      .replace(/\t/g, '\\t');  // 转义制表符
    return `'${escaped}'`;
  }).join('\n');
  content += '\n';

  // 追加到文件
  fs.appendFileSync(nomatchPath, content, 'utf8');
  console.log(`✓ 已将 ${unmatchedTexts.size} 个未匹配的文本追加到: ${nomatchPath}`);
}

module.exports = {
  isOnlyChinese,
  cleanString,
  isAlreadyI18n,
  extractTemplateVars,
  setConvertOptions,
  loadI18nMap,
  getKeyForChinese,
  detectColonSuffix,
  resetUnmatchedTexts,
  saveUnmatchedKeys
};

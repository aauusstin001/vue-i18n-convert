/**
 * Template 解析和转换
 */
const { isOnlyChinese, cleanString, getKeyForChinese, detectColonSuffix, extractTemplateVars } = require('./utils');

/**
 * 转换中文文本为 i18n 格式（带冒号后缀处理）
 * @param {string} text - 原文本
 * @returns {string|null} - 转换后的 i18n 调用或 null（跳过转换）
 */
function convertToI18n(text, format = 'template') {
  const { hasColonSuffix, colonChar, textWithoutColon } = detectColonSuffix(text);

  if (hasColonSuffix) {
    const key = getKeyForChinese(textWithoutColon);
    if (key === null) return null; // 跳过未匹配的文本

    if (format === 'template') {
      return `{{ $t('${key}') + "${colonChar}" }}`;
    } else if (format === 'attr') {
      return `$t('${key}') + '${colonChar}'`;
    }
  } else {
    const key = getKeyForChinese(text);
    if (key === null) return null; // 跳过未匹配的文本

    if (format === 'template') {
      return `{{ $t('${key}') }}`;
    } else if (format === 'attr') {
      return `$t('${key}')`;
    }
  }
  return null;
}

/**
 * 处理 template 中的中文
 * @param {string} templateContent
 * @returns {string}
 */
function convertTemplate(templateContent) {
  if (!templateContent) return '';

  let result = templateContent;

  // 0. 先提取并保护 HTML 注释，避免注释中的中文被转换
  const comments = [];
  const commentPlaceholder = '___COMMENT_PLACEHOLDER___';
  result = result.replace(/<!--[\s\S]*?-->/g, (match) => {
    comments.push(match);
    return `${commentPlaceholder}${comments.length - 1}___`;
  });

  // 1. 先处理已有插值表达式中的字符串字面量
  // 如 {{ "文本" }} 或 {{ '文本' }}
  result = result.replace(/\{\{\s*["']([^"']+)["']\s*\}\}/g, (match, text) => {
    // 跳过已经包含 $t 的内容
    if (match.includes('$t(')) {
      return match;
    }
    const cleaned = cleanString(text);
    if (isOnlyChinese(cleaned)) {
      const converted = convertToI18n(cleaned, 'template');
      return converted !== null ? converted : match;
    }
    return match;
  });

  // 1.5. 处理插值表达式中的模板字符串
  // 如 {{ `请输入${type}` }}
  result = result.replace(/\{\{\s*`([^`]*)`\s*\}\}/g, (match, templateContent) => {
    // 跳过已经包含 $t 的内容
    if (match.includes('$t(')) {
      return match;
    }

    // 使用 extractTemplateVars 提取模板字符串中的变量
    const { text, params, hasChinese } = extractTemplateVars(templateContent);

    if (hasChinese) {
      const cleaned = cleanString(text);
      const { hasColonSuffix, colonChar, textWithoutColon } = detectColonSuffix(cleaned);

      if (hasColonSuffix) {
        const key = getKeyForChinese(textWithoutColon);
        if (key === null) return match; // 跳过未匹配的文本

        if (params.length > 0) {
          // 有变量，构建参数对象
          const paramsObj = params.map(p => `${p.name}: ${p.expr}`).join(', ');
          return `{{ $t('${key}', { ${paramsObj} }) + '${colonChar}' }}`;
        } else {
          // 无变量
          return `{{ $t('${key}') + '${colonChar}' }}`;
        }
      } else {
        const key = getKeyForChinese(cleaned);
        if (key === null) return match; // 跳过未匹配的文本

        if (params.length > 0) {
          // 有变量，构建参数对象
          const paramsObj = params.map(p => `${p.name}: ${p.expr}`).join(', ');
          return `{{ $t('${key}', { ${paramsObj} }) }}`;
        } else {
          // 无变量
          return `{{ $t('${key}') }}`;
        }
      }
    }
    return match;
  });

  // 2. 处理纯文本节点中的中文（标签之间的文本）
  // 包括混合文本节点（如：包装基数:{{ data.item.packqty }}）
  result = result.replace(/>([^<]+)</g, (match, text) => {
    // 如果文本包含插值表达式 {{ }}，需要分段处理
    if (text.includes('{{') && text.includes('}}')) {
      // 分割文本和插值表达式
      const parts = [];
      let lastIndex = 0;

      // 匹配所有的插值表达式（使用非贪婪匹配，支持嵌套的 {}）
      const interpolationRegex = /\{\{[\s\S]*?\}\}/g;
      let interpolationMatch;

      while ((interpolationMatch = interpolationRegex.exec(text)) !== null) {
        // 获取插值表达式之前的文本
        const beforeText = text.substring(lastIndex, interpolationMatch.index);
        if (beforeText) {
          const cleaned = cleanString(beforeText);
          if (isOnlyChinese(cleaned)) {
            const converted = convertToI18n(cleaned, 'template');
            parts.push(converted !== null ? converted : beforeText);
          } else {
            parts.push(beforeText);
          }
        }
        // 保留插值表达式
        parts.push(interpolationMatch[0]);
        lastIndex = interpolationMatch.index + interpolationMatch[0].length;
      }

      // 处理最后一段文本
      const afterText = text.substring(lastIndex);
      if (afterText) {
        const cleaned = cleanString(afterText);
        if (isOnlyChinese(cleaned)) {
          const converted = convertToI18n(cleaned, 'template');
          parts.push(converted !== null ? converted : afterText);
        } else {
          parts.push(afterText);
        }
      }

      // 如果有转换，返回新文本
      if (parts.length > 0 && parts.join('') !== text) {
        return `>${parts.join('')}<`;
      }
      return match;
    }

    // 纯文本节点，没有插值表达式
    const cleaned = cleanString(text);
    if (isOnlyChinese(cleaned)) {
      const converted = convertToI18n(cleaned, 'template');
      return converted !== null ? `>${converted}<` : match;
    }
    return match;
  });

  // 3. 处理静态属性值中的中文，转换为动态绑定
  // 匹配如 placeholder="请输入" title="标题" 等
  result = result.replace(/\s+([a-zA-Z-:@]+)="([^"]+)"/g, (match, attrName, attrValue) => {
    // 跳过已经是动态绑定的属性（以 : 或 v- 开头）
    if (attrName.startsWith(':') || attrName.startsWith('v-')) {
      return match;
    }

    const cleaned = cleanString(attrValue);
    if (isOnlyChinese(cleaned)) {
      const converted = convertToI18n(cleaned, 'attr');
      return converted !== null ? ` :${attrName}="${converted}"` : match;
    }
    return match;
  });

  // 4. 处理 v-bind 或 : 绑定中的字符串字面量
  // 如 :title="'删除'" 或 :placeholder="'请输入'"
  result = result.replace(/:([a-zA-Z-]+)=["']([^"']*["']([^"']+)["'][^"']*)["']/g, (match, attrName, fullValue, innerText) => {
    const cleaned = cleanString(innerText);
    if (isOnlyChinese(cleaned)) {
      // 检查是否是简单的字符串字面量
      if (fullValue.trim() === `'${innerText}'` || fullValue.trim() === `"${innerText}"`) {
        const { hasColonSuffix, colonChar, textWithoutColon } = detectColonSuffix(cleaned);
        if (hasColonSuffix) {
          const key = getKeyForChinese(textWithoutColon);
          if (key === null) return match; // 跳过未匹配的文本
          return `:${attrName}="$t('${key}') + '${colonChar}'"`;
        } else {
          const key = getKeyForChinese(cleaned);
          if (key === null) return match; // 跳过未匹配的文本
          return `:${attrName}="$t('${key}')"`;
        }
      }
    }
    return match;
  });

  // 5. 处理 v-bind 或 : 绑定中的模板字符串（反引号）
  // 如 :title="`委外${wareTypeLabel}单`"
  result = result.replace(/:([a-zA-Z-]+)=["']`([^`]*)`["']/g, (match, attrName, templateContent) => {
    // 使用 extractTemplateVars 提取模板字符串中的变量
    const { text, params, hasChinese } = extractTemplateVars(templateContent);

    if (hasChinese) {
      const cleaned = cleanString(text);
      const { hasColonSuffix, colonChar, textWithoutColon } = detectColonSuffix(cleaned);

      if (hasColonSuffix) {
        const key = getKeyForChinese(textWithoutColon);
        if (key === null) return match; // 跳过未匹配的文本

        if (params.length > 0) {
          // 有变量，构建参数对象
          const paramsObj = params.map(p => `${p.name}: ${p.expr}`).join(', ');
          return `:${attrName}="$t('${key}', { ${paramsObj} }) + '${colonChar}'"`;
        } else {
          // 无变量
          return `:${attrName}="$t('${key}') + '${colonChar}'"`;
        }
      } else {
        const key = getKeyForChinese(cleaned);
        if (key === null) return match; // 跳过未匹配的文本

        if (params.length > 0) {
          // 有变量，构建参数对象
          const paramsObj = params.map(p => `${p.name}: ${p.expr}`).join(', ');
          return `:${attrName}="$t('${key}', { ${paramsObj} })"`;
        } else {
          // 无变量
          return `:${attrName}="$t('${key}')"`;
        }
      }
    }
    return match;
  });

  // 6. 恢复 HTML 注释
  result = result.replace(/___COMMENT_PLACEHOLDER___(\d+)___/g, (_match, index) => {
    return comments[parseInt(index)];
  });

  return result;
}

module.exports = {
  convertTemplate
};

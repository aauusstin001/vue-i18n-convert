/**
 * Script 解析和转换（使用 Recast 保留代码格式）
 */
const recast = require('recast');
const { visit, builders: b } = recast.types;
const { isOnlyChinese, cleanString, extractTemplateVars, getKeyForChinese, detectColonSuffix } = require('./utils');

/**
 * 处理 script 中的中文
 * @param {string} scriptContent
 * @returns {string}
 */
function convertScript(scriptContent) {
  if (!scriptContent) return '';

  try {
    // 使用 Recast 解析为 AST（保留原始格式信息）
    const ast = recast.parse(scriptContent, {
      parser: require('recast/parsers/babel')
    });

    // 遍历 AST
    visit(ast, {
      // 处理字符串字面量
      visitLiteral(path) {
        const node = path.node;

        // 只处理字符串类型
        if (typeof node.value !== 'string') {
          this.traverse(path);
          return;
        }

        // 跳过 console.* 调用
        if (isInConsoleCall(path)) {
          this.traverse(path);
          return;
        }

        // 跳过已经是 i18n 的调用
        if (isInI18nCall(path)) {
          this.traverse(path);
          return;
        }

        const value = node.value;
        const cleaned = cleanString(value);

        if (isOnlyChinese(cleaned)) {
          // 检测冒号后缀
          const { hasColonSuffix, colonChar, textWithoutColon } = detectColonSuffix(cleaned);

          if (hasColonSuffix) {
            // 获取去掉冒号的文本对应的 key
            const key = getKeyForChinese(textWithoutColon);
            if (key === null) {
              this.traverse(path);
              return; // 跳过未匹配的文本
            }

            // 替换为 i18n.t('key') + '：'
            const i18nCall = b.callExpression(
              b.memberExpression(b.identifier('i18n'), b.identifier('t')),
              [b.literal(key)]
            );
            const binaryExpr = b.binaryExpression(
              '+',
              i18nCall,
              b.literal(colonChar)
            );
            path.replace(binaryExpr);
          } else {
            // 没有冒号后缀，正常处理
            const key = getKeyForChinese(cleaned);
            if (key === null) {
              this.traverse(path);
              return; // 跳过未匹配的文本
            }

            // 替换为 i18n.t('key')
            const i18nCall = b.callExpression(
              b.memberExpression(b.identifier('i18n'), b.identifier('t')),
              [b.literal(key)]
            );
            path.replace(i18nCall);
          }
        }

        this.traverse(path);
      },

      // 处理模板字符串
      visitTemplateLiteral(path) {
        const node = path.node;

        // 跳过 console.* 调用
        if (isInConsoleCall(path)) {
          this.traverse(path);
          return;
        }

        // 跳过已经是 i18n 的调用
        if (isInI18nCall(path)) {
          this.traverse(path);
          return;
        }

        // 获取模板字符串的原始文本
        const templateText = getTemplateString(node);
        const cleaned = cleanString(templateText);

        // 只处理包含中文的模板字符串
        if (!isOnlyChinese(cleaned)) {
          this.traverse(path);
          return;
        }

        // 如果有插值表达式
        if (node.expressions && node.expressions.length > 0) {
          // 提取变量，转换为 {param1}, {param2}...
          const { text, params } = extractTemplateVars(templateText);

          // 检测冒号后缀
          const { hasColonSuffix, colonChar, textWithoutColon } = detectColonSuffix(text);
          const finalText = hasColonSuffix ? textWithoutColon : text;

          // 获取对应的 key
          const key = getKeyForChinese(finalText);
          if (key === null) {
            this.traverse(path);
            return; // 跳过未匹配的文本
          }

          // 构建参数对象 {param1: xxx, param2: yyy}
          const properties = params.map((param, index) => {
            return b.property(
              'init',
              b.identifier(param.name),
              node.expressions[index]
            );
          });

          // 构建 i18n.t('key', {param1: xxx})
          const i18nCall = b.callExpression(
            b.memberExpression(b.identifier('i18n'), b.identifier('t')),
            [b.literal(key), b.objectExpression(properties)]
          );

          // 如果有冒号后缀，添加 + '：'
          if (hasColonSuffix) {
            const binaryExpr = b.binaryExpression(
              '+',
              i18nCall,
              b.literal(colonChar)
            );
            path.replace(binaryExpr);
          } else {
            path.replace(i18nCall);
          }
        } else {
          // 没有插值表达式，直接替换为普通字符串的 i18n 调用
          const { hasColonSuffix, colonChar, textWithoutColon } = detectColonSuffix(cleaned);
          const finalText = hasColonSuffix ? textWithoutColon : cleaned;

          const key = getKeyForChinese(finalText);
          if (key === null) {
            this.traverse(path);
            return; // 跳过未匹配的文本
          }

          const i18nCall = b.callExpression(
            b.memberExpression(b.identifier('i18n'), b.identifier('t')),
            [b.literal(key)]
          );

          // 如果有冒号后缀，添加 + '：'
          if (hasColonSuffix) {
            const binaryExpr = b.binaryExpression(
              '+',
              i18nCall,
              b.literal(colonChar)
            );
            path.replace(binaryExpr);
          } else {
            path.replace(i18nCall);
          }
        }

        this.traverse(path);
      }
    });

    // 使用 Recast 生成代码（保留原始格式）
    const output = recast.print(ast, {
      quote: 'double',
      trailingComma: false
    });

    return output.code;
  } catch (error) {
    console.error('Script 解析失败:', error.message);
    return scriptContent;
  }
}

/**
 * 检查节点是否在 console.* 调用中
 */
function isInConsoleCall(path) {
  let currentPath = path;
  while (currentPath.parent) {
    const parent = currentPath.parent;
    if (
      parent.node &&
      parent.node.type === 'CallExpression' &&
      parent.node.callee &&
      parent.node.callee.type === 'MemberExpression' &&
      parent.node.callee.object &&
      parent.node.callee.object.name === 'console'
    ) {
      return true;
    }
    currentPath = parent;
  }
  return false;
}

/**
 * 检查节点是否已经在 i18n.t() 或 $t() 调用中
 */
function isInI18nCall(path) {
  if (!path.parent || !path.parent.node) {
    return false;
  }

  const parent = path.parent.node;
  if (parent.type === 'CallExpression') {
    const callee = parent.callee;
    if (callee && callee.type === 'MemberExpression') {
      // i18n.t()
      if (callee.object && callee.object.name === 'i18n' && callee.property && callee.property.name === 't') {
        return true;
      }
      // this.$t()
      if (callee.property && callee.property.name === '$t') {
        return true;
      }
    }
    // $t()
    if (callee && callee.type === 'Identifier' && callee.name === '$t') {
      return true;
    }
  }
  return false;
}

/**
 * 获取模板字符串的原始文本（包含 ${} 占位符）
 */
function getTemplateString(node) {
  let result = '';
  const quasis = node.quasis;
  const expressions = node.expressions;

  for (let i = 0; i < quasis.length; i++) {
    result += quasis[i].value.raw;
    if (i < expressions.length) {
      // 将表达式转换回 ${...} 格式
      const exprCode = recast.print(expressions[i]).code;
      result += '${' + exprCode + '}';
    }
  }

  return result;
}

module.exports = {
  convertScript
};

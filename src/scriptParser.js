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

    // 用于标记已经被处理过的节点，避免重复处理
    const processedNodes = new WeakSet();

    // 遍历 AST
    visit(ast, {
      // 处理二元表达式（字符串拼接）
      visitBinaryExpression(path) {
        const node = path.node;

        // 如果已经被处理过，跳过
        if (processedNodes.has(node)) {
          this.traverse(path);
          return;
        }

        // 只处理 + 操作符
        if (node.operator !== '+') {
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

        // 尝试收集字符串拼接的所有部分
        const parts = collectBinaryParts(node);

        // 检查是否包含字符串字面量
        const hasStringLiteral = parts.some(part => part.type === 'string');
        if (!hasStringLiteral) {
          this.traverse(path);
          return;
        }

        // 提取字符串内容和变量
        let templateText = '';
        const variables = [];

        for (const part of parts) {
          if (part.type === 'string') {
            templateText += part.value;
          } else {
            // 表达式，生成占位符
            const paramName = `param${variables.length + 1}`;
            templateText += `{${paramName}}`;
            variables.push({
              name: paramName,
              expression: part.node
            });
          }
        }

        // 清理并检查是否包含中文
        const cleaned = cleanString(templateText);
        if (!isOnlyChinese(cleaned)) {
          this.traverse(path);
          return;
        }

        // 检测冒号后缀
        const { hasColonSuffix, colonChar, textWithoutColon } = detectColonSuffix(cleaned);
        const finalText = hasColonSuffix ? textWithoutColon : cleaned;

        // 获取对应的 key
        const key = getKeyForChinese(finalText);

        // 无论是否匹配，都标记节点为已处理，避免子节点被单独转换
        markProcessedNodes(node, processedNodes);

        if (key === null) {
          this.traverse(path);
          return; // 跳过未匹配的文本
        }

        // 如果有变量，构建带参数的 i18n 调用
        if (variables.length > 0) {
          const properties = variables.map(v => {
            return b.property(
              'init',
              b.identifier(v.name),
              v.expression
            );
          });

          const i18nCall = b.callExpression(
            b.memberExpression(b.identifier('$i18n'), b.identifier('t')),
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
          // 没有变量，构建简单的 i18n 调用
          const i18nCall = b.callExpression(
            b.memberExpression(b.identifier('$i18n'), b.identifier('t')),
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

        // 不再继续遍历子节点，避免重复处理
        return false;
      },

      // 处理字符串字面量
      visitLiteral(path) {
        const node = path.node;

        // 只处理字符串类型
        if (typeof node.value !== 'string') {
          this.traverse(path);
          return;
        }

        // 如果已经被处理过（作为二元表达式的一部分），跳过
        if (processedNodes.has(node)) {
          this.traverse(path);
          return;
        }

        // 如果父节点是二元表达式，跳过（会被 visitBinaryExpression 处理）
        if (path.parent && path.parent.node && path.parent.node.type === 'BinaryExpression' && path.parent.node.operator === '+') {
          this.traverse(path);
          return;
        }

        // 跳过对象属性的键
        if (isObjectPropertyKey(path)) {
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

            // 替换为 $i18n.t('key') + '：'
            const i18nCall = b.callExpression(
              b.memberExpression(b.identifier('$i18n'), b.identifier('t')),
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

            // 替换为 $i18n.t('key')
            const i18nCall = b.callExpression(
              b.memberExpression(b.identifier('$i18n'), b.identifier('t')),
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

          // 构建 $i18n.t('key', {param1: xxx})
          const i18nCall = b.callExpression(
            b.memberExpression(b.identifier('$i18n'), b.identifier('t')),
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
            b.memberExpression(b.identifier('$i18n'), b.identifier('t')),
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
 * 收集二元表达式中的所有部分（从左到右）
 * @param {Object} node - BinaryExpression 节点
 * @returns {Array} - 返回 { type: 'string'|'expression', value: string, node: Object }
 */
function collectBinaryParts(node) {
  const parts = [];

  function collect(n) {
    if (!n) return;

    // 如果是二元表达式且操作符是 +
    if (n.type === 'BinaryExpression' && n.operator === '+') {
      // 检查左右两边是否包含字符串字面量
      const hasStringInLeft = containsStringLiteral(n.left);
      const hasStringInRight = containsStringLiteral(n.right);

      // 只有当左边或右边包含字符串时，才继续拆分
      // 否则把整个表达式作为一个变量（如 i+1）
      if (hasStringInLeft || hasStringInRight) {
        collect(n.left);
        collect(n.right);
      } else {
        // 整个二元表达式作为一个变量
        parts.push({
          type: 'expression',
          value: null,
          node: n
        });
      }
    } else if ((n.type === 'Literal' || n.type === 'StringLiteral') && typeof n.value === 'string') {
      // 字符串字面量（支持 Literal 和 StringLiteral）
      parts.push({
        type: 'string',
        value: n.value,
        node: n
      });
    } else {
      // 其他表达式（变量、成员访问等）
      parts.push({
        type: 'expression',
        value: null,
        node: n
      });
    }
  }

  collect(node);
  return parts;
}

/**
 * 检查节点是否包含字符串字面量
 * @param {Object} node - AST 节点
 * @returns {boolean}
 */
function containsStringLiteral(node) {
  if (!node) return false;

  // 如果是字符串字面量
  if ((node.type === 'Literal' || node.type === 'StringLiteral') && typeof node.value === 'string') {
    return true;
  }

  // 如果是二元表达式，递归检查左右两边
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return containsStringLiteral(node.left) || containsStringLiteral(node.right);
  }

  return false;
}

/**
 * 标记节点及其所有子节点为已处理
 * @param {Object} node - AST 节点
 * @param {WeakSet} processedNodes - 已处理节点集合
 */
function markProcessedNodes(node, processedNodes) {
  if (!node || typeof node !== 'object') return;

  processedNodes.add(node);

  // 递归标记所有子节点
  if (node.type === 'BinaryExpression') {
    markProcessedNodes(node.left, processedNodes);
    markProcessedNodes(node.right, processedNodes);
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
 * 检查节点是否已经在 i18n.t() 或 $i18n.t() 或 $t() 调用中
 */
function isInI18nCall(path) {
  if (!path.parent || !path.parent.node) {
    return false;
  }

  const parent = path.parent.node;
  if (parent.type === 'CallExpression') {
    const callee = parent.callee;
    if (callee && callee.type === 'MemberExpression') {
      // i18n.t() 或 $i18n.t()
      if ((callee.object && (callee.object.name === 'i18n' || callee.object.name === '$i18n')) && callee.property && callee.property.name === 't') {
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
 * 检查节点是否是对象属性的键
 */
function isObjectPropertyKey(path) {
  if (!path.parent || !path.parent.node) {
    return false;
  }

  const parent = path.parent.node;
  // 检查父节点是否是 Property 或 ObjectProperty，并且当前节点是该属性的 key
  if ((parent.type === 'Property' || parent.type === 'ObjectProperty') && parent.key === path.node) {
    return true;
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
    // 使用 cooked 而不是 raw，这样会正确处理 \n、\r、\t 等转义序列
    result += quasis[i].value.cooked;
    //result += quasis[i].value.raw;
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

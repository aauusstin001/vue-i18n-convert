# Vue i18n 转换工具

自动将 Vue 文件中的中文文本转换为 i18n 国际化格式的命令行工具。

## 功能特性

- 自动将 template 中的中文转换为 `{{ $t('key') }}`
- 自动将 script 中的中文转换为 `i18n.t('key')`
- 支持模板字符串，转换为 `i18n.t('文本{param1}', {param1: xxx})`
- 支持从 zh.js 语言包文件中匹配对应的 key
- 自动跳过 console.* 和注释中的内容
- 自动跳过纯英文、纯数字
- 保留原始代码格式和缩进
- 支持冒号后缀的智能处理（如 "标题：" → `$t('标题') + "："`）

## 安装

```bash
npm install
```

## 使用方法

### 基本用法

```bash
# 转换单个 Vue 文件（自动查找 zh.js）
node index.js ./src/components/HelloWorld.vue

# 指定语言包文件路径
node index.js ./src/components/HelloWorld.vue ./locales/zh.js
```

### 高级选项

#### 跳过未匹配的文本

默认情况下，如果中文在 zh.js 中找不到对应的 key，会使用中文本身作为 key。使用 `--skip-unmatched` 选项可以跳过这些文本，保留原中文不转换。

```bash
node index.js ./src/components/HelloWorld.vue --skip-unmatched
node index.js ./src/components/HelloWorld.vue -s
```

#### 匹配指定路径前缀

使用 `--match-path` 选项可以只匹配指定路径前缀的 key。注意：`common.` 前缀始终会被匹配。

```bash
# 只使用 pda.* 和 common.* 的 key
node index.js ./src/components/HelloWorld.vue --match-path pda

# 只使用 pda.barcode.* 和 common.* 的 key
node index.js ./src/components/HelloWorld.vue -mp pda.barcode
```

## 转换示例

### Template 转换

**转换前：**
```vue
<template>
  <div>
    <h1>用户管理</h1>
    <input placeholder="请输入用户名" />
    <button title="删除">删除</button>
    <p>包装基数:{{ data.item.packqty }}</p>
  </div>
</template>
```

**转换后：**
```vue
<template>
  <div>
    <h1>{{ $t('用户管理') }}</h1>
    <input :placeholder="$t('请输入用户名')" />
    <button :title="$t('删除')">{{ $t('删除') }}</button>
    <p>{{ $t('包装基数') }}:{{ data.item.packqty }}</p>
  </div>
</template>
```

### Script 转换

**转换前：**
```javascript
const message = '操作成功';
const title = `当前用户：${username}`;
console.log('调试信息'); // 不会被转换
```

**转换后：**
```javascript
const message = i18n.t("操作成功");
const title = i18n.t("当前用户{param1}", {param1: username});
console.log('调试信息'); // 保持不变
```

### 冒号后缀处理

**转换前：**
```vue
<template>
  <label>用户名：</label>
</template>
<script>
const label = '密码：';
</script>
```

**转换后：**
```vue
<template>
  <label>{{ $t('用户名') + "：" }}</label>
</template>
<script>
const label = i18n.t("密码") + "：";
</script>
```

## 语言包文件

### 支持的格式

工具支持 CommonJS 和 ES6 模块格式的语言包文件：

**CommonJS 格式：**
```javascript
module.exports = {
  common: {
    save: '保存',
    cancel: '取消'
  },
  user: {
    login: '登录',
    logout: '退出'
  }
}
```

**ES6 格式：**
```javascript
export default {
  common: {
    save: '保存',
    cancel: '取消'
  },
  user: {
    login: '登录',
    logout: '退出'
  }
}
```

### 自动查找语言包

如果不指定 zh.js 文件路径，工具会按以下顺序自动查找：

1. Vue 文件所在目录
2. 上一级目录
3. 上两级目录
4. 当前工作目录

### 多 key 映射规则

当同一个中文文本对应多个 key 时，按以下优先级选择：

1. 优先使用 `common.*` 前缀的 key
2. 优先使用 `--match-path` 指定前缀的 key
3. 使用第一个找到的 key

## 输出文件

### nomatch.txt

工具会在项目根目录生成 `nomatch.txt` 文件（追加模式），记录所有未在 zh.js 中找到的中文文本：

```
========== 2024/12/27 10:30:45 ==========
未匹配的中文文本 (共 3 个):
'新功能'
'测试文本'
'未定义标签'
```

## 注意事项

1. **备份重要文件**：工具会直接覆盖原 Vue 文件，建议在版本控制下使用
2. **检查转换结果**：转换后请检查代码，确保转换正确
3. **命名说明**：虽然函数名为 `isOnlyChinese`，但实际检测的是"是否包含中文"
4. **格式保留**：使用 Recast 库处理 script 部分，会保留原始代码格式

## 技术栈

- @vue/compiler-sfc - Vue 单文件组件解析
- @babel/parser - JavaScript 代码解析
- recast - AST 操作（保留代码格式）
- @babel/traverse - AST 遍历
- @babel/types - AST 节点构建

## 许可证

MIT

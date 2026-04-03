# Joy Comparison Chrome扩展

## 安装说明

### 方法1：开发者模式安装（推荐）

1. **打开Chrome扩展管理页面**
   - 在Chrome地址栏输入：`chrome://extensions/`
   - 或者：菜单 → 更多工具 → 扩展程序

2. **开启开发者模式**
   - 在页面右上角找到"开发者模式"开关
   - 点击开启

3. **加载扩展**
   - 点击"加载已解压的扩展程序"
   - 选择包含这些文件的文件夹：
     - `manifest.json`
     - `background.js`
     - `index.html`
     - `style.css`
     - `script.js`
     - `dmp.min.js`
     - `icons/` 文件夹

4. **完成安装**
   - 扩展会出现在扩展列表中
   - 点击扩展图标即可使用

### 方法2：生成图标（可选）

如果你想要自定义图标：

1. 打开 `generate_icons.html` 文件
2. 点击"生成所有图标"按钮
3. 点击"下载所有图标"按钮
4. 将下载的PNG文件放到 `icons/` 文件夹中

## 使用方法

1. **打开工具**
   - 点击Chrome工具栏中的Joy Comparison图标
   - 会打开一个独立窗口（1400x900像素）

2. **输入文本**
   - 在左侧文本框输入原始文本
   - 在右侧文本框输入修改后的文本

3. **开始对比**
   - 点击"比较文本"按钮
   - 系统会自动检测差异并高亮显示

4. **导航差异**
   - 使用"上一处差异"/"下一处差异"按钮
   - 或直接输入差异编号跳转
   - 从下拉列表选择差异位置

5. **历史记录**
   - 点击"保存记录"保存当前对比
   - 点击"历史记录"查看和管理历史对比

## 功能特性

- ✅ 字符级精确差异检测
- ✅ 智能导航和跳转
- ✅ 同步滚动功能
- ✅ 历史记录管理
- ✅ 独立窗口运行
- ✅ 本地存储，数据安全

## 文件结构

```
joy-comparison-extension/
├── manifest.json          # 扩展配置文件
├── background.js          # 后台脚本
├── index.html            # 主页面
├── style.css             # 样式文件
├── script.js             # 核心逻辑
├── dmp.min.js            # 差异算法库
├── icons/                # 图标文件夹
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── generate_icons.html   # 图标生成工具
└── CHROME_EXTENSION_README.md
```

## 技术说明

- **Manifest V3**：使用最新的Chrome扩展API
- **独立窗口**：点击图标打开1400x900像素的独立窗口
- **本地存储**：使用Chrome的storage API保存历史记录
- **无网络依赖**：所有功能都在本地运行

## 故障排除

### 扩展无法加载
- 确保所有必需文件都在同一文件夹中
- 检查manifest.json文件格式是否正确
- 尝试重新加载扩展

### 图标不显示
- 确保icons文件夹中有正确尺寸的PNG文件
- 文件名必须与manifest.json中指定的完全一致

### 功能异常
- 检查浏览器控制台是否有错误信息
- 确保Chrome版本支持Manifest V3（Chrome 88+）

## 更新扩展

1. 修改代码后，回到 `chrome://extensions/`
2. 找到Joy Comparison扩展
3. 点击刷新按钮（🔄）
4. 重新打开扩展窗口

## 卸载扩展

1. 打开 `chrome://extensions/`
2. 找到Joy Comparison扩展
3. 点击"移除"按钮
4. 确认删除

---

**版本**: 0.0.1  
**兼容性**: Chrome 88+  
**许可证**: MIT 
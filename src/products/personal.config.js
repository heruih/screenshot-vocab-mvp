/* 产品配置：个人版（Simon 自用）。构建时注入到单文件最前面，成为全局 APP_CONFIG。
   以后要做产品差异，只改这里的开关，不动共享代码。 */
self.APP_CONFIG = Object.freeze({
  product: 'personal',
  appName: '英语学习笔记',
  features: {
    folders: true,      // 文件夹/笔记
    screenshot: true,   // 截图 OCR 导入
    word: true,         // 单词卡 + SRS 复习
    aiExample: true,    // AI 例句
    writing: true,      // 写作
    audio: true,        // 听原音/录音
    cloud: true,        // 云同步
    dialogue: true,     // 情景对话
    tags: true          // 标签聚合
  }
});

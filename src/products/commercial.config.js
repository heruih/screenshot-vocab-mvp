/* 产品配置：商业版（截图词库 MVP，给真实用户）。构建时注入到单文件最前面。
   目前功能与个人版完全相同；以后要做减法/差异化，只改这里的开关。 */
self.APP_CONFIG = Object.freeze({
  product: 'commercial',
  appName: '英语学习笔记',
  features: {
    folders: true,
    screenshot: true,
    word: true,
    aiExample: true,
    writing: true,
    audio: true,
    cloud: true,
    dialogue: true,
    tags: true
  }
});

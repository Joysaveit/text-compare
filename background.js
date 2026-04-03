// Chrome扩展后台脚本
chrome.action.onClicked.addListener((tab) => {
  // 点击扩展图标时打开独立窗口
  chrome.windows.create({
    url: 'index.html',
    type: 'popup',
    width: 1400,
    height: 900,
    left: 100,
    top: 100
  });
}); 
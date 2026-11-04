# Word

考研英语二真题单词收集器。

## 自动释义词库

输入单词时，应用会从 `js/dict.js` 自动填入释义。词库来自 2027 考研英语红宝书（不背单词版）词汇数据，保留常考义项与熟词生义，来源与许可见 [js/dict.LICENSE.txt](js/dict.LICENSE.txt)。

`js/dict.js` 按需加载：第一次在输入框里输入单词时才下载，之后由 Service Worker 缓存，可离线使用。

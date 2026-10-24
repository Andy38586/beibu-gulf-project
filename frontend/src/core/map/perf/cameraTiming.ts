/**
 * 相机防抖常量（cesium-free）。
 *
 * 为什么单独一个文件：CAMERA_DEBOUNCE_MS 此前住在 cameraPerf.ts，而 cameraPerf 静态
 * `import … from 'cesium'`（dev 别名到 cesium-global shim，模块求值时 window.Cesium
 * 尚未注入即抛）——OLRenderer 静态引它就把整个 2D eager 图拖进了「UMD 注入竞速」，
 * 冷浏览器输掉竞速 = dev 首屏永远停在加载页（2026-10-24 实测）。2D 首屏链上的
 * 常量必须与 cesium 解耦；本文件零 import，可被 eager 图安全消费。
 */
export const CAMERA_DEBOUNCE_MS = 300

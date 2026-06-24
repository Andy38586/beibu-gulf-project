// 单独抽出来，避免 ResultPanel.vue 需要依赖整个 useFacilities.js (含数据加载逻辑)
// 只是为了拿一份"key -> 中文名"的映射，雷达图坐标轴要用
export const FACILITY_LABELS = {
  hospital: '医院',
  primary_school: '小学',
  middle_school: '中学',
  park: '公园',
  bus_station: '公交站',
  mall: '商场',
}

/**
 * AUDIT-003(架构): 设施配置常量
 * 
 * 虽然文件名为useFacilities.js，但实际导出的是配置常量而非composable函数。
 * 保持向后兼容，同时添加说明注释。
 */

export const FACILITY_CONFIG = {
  hospital: {
    label: '医院',
    color: '#e74c3c',
    defaultRadius: 3,
  },
  primary_school: {
    label: '小学',
    color: '#3498db',
    defaultRadius: 1,
  },
  middle_school: {
    label: '中学',
    color: '#9b59b6',
    defaultRadius: 2,
  },
  park: {
    label: '公园',
    color: '#2ecc71',
    defaultRadius: 1.5,
  },
  bus_station: {
    label: '公交站',
    color: '#f39c12',
    defaultRadius: 0.5,
  },
  mall: {
    label: '商场',
    color: '#1abc9c',
    defaultRadius: 2,
  },
}

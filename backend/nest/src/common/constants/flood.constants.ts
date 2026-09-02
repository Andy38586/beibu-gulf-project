// 水位上限（米）：与 FastAPI 参数约束（le=25）及根基文档 02 §4.3 滑块范围一致
//（8-11：原 100 放宽越界），flood 模块入参与档位选取共用此界
export const MAX_WATER_LEVEL = 25

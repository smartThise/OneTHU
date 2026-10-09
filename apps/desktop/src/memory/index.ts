/**
 * OH 记忆引擎（TS 侧，宿主无关；云端 bot 网关可直连复用——与 docs/memory-cloud 定案一致）。
 * 对外只暴露 operations 的八个操作 + 类型；镜像 IO 与检索是内部实现。
 */
export {
  memorySearch, memoryRead, memoryList, memoryWrite, memoryAppend,
  memoryEdit, memoryDelete, memoryRefresh, memoryReady,
  type MemoryWriteInput, type MemoryListItem, type SearchHit,
} from "./operations.js";

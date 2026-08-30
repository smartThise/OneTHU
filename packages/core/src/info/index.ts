/**
 * info 域导出面 —— 财务三件 / 宿舍卫生 / 体测 / 教学评估 / 教室资源 / 校历 /
 * 校园网（thos-usereg）移植模块的类型与错误类汇聚。
 * 业务方法均挂在 InfoClient（client.ts）；解析纯函数按域分模块（finance/
 * hygiene/fitness/evaluation/classroom/calendar/neth），如需直接复用解析层可
 * `import * as infoXxx from "@onethu/core/…"（经本文件转出）`。
 */
export { ServiceUnavailableError } from "./client.js";
export { ClassroomStatus } from "./types.js";
export type {
  AssessmentForm,
  AssessmentInputGroup,
  AssessmentInputTag,
  AssessmentPerson,
  BankPayment,
  BankPaymentByMonth,
  Classroom,
  ClassroomState,
  ClassroomStateResult,
  GraduateIncome,
  Invoice,
  InvoicePage,
  NetworkAccountInfo,
  NetworkBalance,
  NetworkDevice,
  SchoolCalendarData,
  SchoolSemester,
} from "./types.js";

/**
 * 演示数据 —— 仅在用户显式进入"演示模式"时展示，界面会明确标注。
 * 日期相对今天生成，保证任何时刻打开都自然。
 */
import type { CardInfo, CardTransaction, CourseFile, CourseInfo, ExamEntry, Homework, NewsItem, Notification, ReportRow, ScheduleEntry } from "@onethu/core";

function dt(dayOffset: number, hm: string): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day} ${hm}`;
}

export const DEMO_SEMESTER = { id: "2025-2026-1" };

/** 学期切换页演示列表（新 → 旧） */
export const DEMO_SEMESTER_LIST = ["2025-2026-1", "2024-2025-3", "2024-2025-2", "2024-2025-1", "2023-2024-3", "2023-2024-2", "2023-2024-1"];

export const DEMO_COURSES: CourseInfo[] = [
  { id: "9001", name: "计算机组成原理", englishName: "Computer Organization", courseNumber: "30240183", courseIndex: 11, teacherName: "陈永强", timeAndLocation: ["周一 第3节 三教2101", "周四 第1节 三教2101"], url: "#" },
  { id: "9002", name: "操作系统", englishName: "Operating Systems", courseNumber: "30240243", courseIndex: 2, teacherName: "陆游游", timeAndLocation: ["周二 第2节 六教6A215", "周五 第2节 六教6A215"], url: "#" },
  { id: "9003", name: "概率论与数理统计", englishName: "Probability and Statistics", courseNumber: "10420814", courseIndex: 3, teacherName: "林之熹", timeAndLocation: ["周三 第4节 四教4303"], url: "#" },
  { id: "9004", name: "大学英语（四级）", englishName: "College English", courseNumber: "10640013", courseIndex: 8, teacherName: "何静", timeAndLocation: ["周五 第1节 文南楼401"], url: "#" },
  { id: "9005", name: "体育（网球）", englishName: "PE (Tennis)", courseNumber: "10760011", courseIndex: 5, teacherName: "李伟", timeAndLocation: ["周四 第5节 气膜网球馆"], url: "#" },
];

export const DEMO_HOMEWORK: Homework[] = [
  { id: "h1", baseId: "b1", courseId: "9002", title: "实验三：多线程内核调度", content: "<p>实现时间片轮转与优先级调度，提交实验报告与代码压缩包。</p><ul><li>报告模板见课程文件</li><li>截止前可重复提交</li></ul>", publishTime: dt(-6, "10:00"), deadline: dt(1, "23:59"), submitted: false, graded: false, completionType: 1, url: "#" },
  { id: "h2", baseId: "b2", courseId: "9003", title: "第七章习题（第1-12题）", content: "教材 P182 起，拍照上传即可。", publishTime: dt(-3, "16:30"), deadline: dt(3, "08:00"), submitted: false, graded: false, completionType: 1, url: "#" },
  { id: "h3", baseId: "b3", courseId: "9001", title: "单周期 CPU 数据通路图", content: "手绘或绘图工具均可，PDF 提交。", publishTime: dt(-8, "09:00"), deadline: dt(-1, "23:59"), submitted: true, graded: false, submitTime: dt(-2, "20:41"), completionType: 1, url: "#" },
  { id: "h4", baseId: "b4", courseId: "9004", title: "Presentation: AI and Language", content: "3 分钟小组展示，周五课上。", publishTime: dt(-10, "14:00"), deadline: dt(2, "08:00"), submitted: false, graded: false, completionType: 2, url: "#" },
  { id: "h5", baseId: "b5", courseId: "9003", title: "期中模拟卷", content: "计入平时分。", publishTime: dt(-14, "10:00"), deadline: dt(-4, "23:59"), submitted: true, graded: true, submitTime: dt(-4, "21:13"), grade: 92, graderName: "林之熹", gradeTime: dt(-3, "14:00"), gradeContent: "第 9 题第二问漏掉边界情形，其余完成度很好。", completionType: 1, url: "#" },
];

export const DEMO_NOTIFICATIONS: Notification[] = [
  { id: "n1", courseId: "9002", title: "关于实验三环境问题的说明（OJ 已更新）", content: "<p>同学们反馈的两组测试样例超时问题已定位，OJ 已更新镜像。</p><p>请重新拉取框架代码后提交；已提交的同学无需重新提交。</p>", publisher: "陆游游", publishTime: dt(-1, "18:20"), important: true, hasRead: false, url: "#" },
  { id: "n2", courseId: "9001", title: "本周四课调至周三第4节（占用电教）", content: "<p>因教室施工，本周四课程调整至周三第 4 节，地点不变。</p>", publisher: "陈永强", publishTime: dt(-2, "11:05"), expireTime: dt(5, "23:59"), hasRead: true, url: "#" },
  { id: "n3", courseId: "9003", title: "期中考试范围与题型说明", content: "<p>第 1–7 章，闭卷。题型：选择 20 分、填空 20 分、计算 60 分。</p><p>附历年样卷一份（见附件）。</p>", publisher: "林之熹", publishTime: dt(-4, "09:40"), attachmentName: "概率论期中样卷.pdf", hasRead: true, url: "#" },
];

export const DEMO_FILES: CourseFile[] = [
  { id: "f1", courseId: "9002", title: "第8讲-虚存与页替换.pdf", uploadTime: dt(-5, "10:12"), downloadUrl: "#", fileType: "pdf", size: "2.4MB", description: "本讲幻灯片，含课堂练习答案。", important: true },
  { id: "f2", courseId: "9002", title: "实验三框架代码.zip", uploadTime: dt(-6, "10:02"), downloadUrl: "#", fileType: "zip", size: "871KB", description: "更新后的实验框架（v2）。" },
  { id: "f3", courseId: "9001", title: "流水线讲义（补发）.pdf", uploadTime: dt(-7, "15:47"), downloadUrl: "#", fileType: "pdf", size: "1.1MB" },
];

export const DEMO_SCHEDULE: ScheduleEntry[] = [
  { courseName: "计算机组成原理", teacher: "陈永强", dayOfWeek: 1, startSection: 3, endSection: 4, location: "三教2101", raw: {} },
  { courseName: "操作系统", teacher: "陆游游", dayOfWeek: 2, startSection: 2, endSection: 3, location: "六教6A215", raw: {} },
  { courseName: "概率论与数理统计", teacher: "林之熹", dayOfWeek: 3, startSection: 4, endSection: 4, location: "四教4303", raw: {} },
  { courseName: "计算机组成原理", teacher: "陈永强", dayOfWeek: 4, startSection: 1, endSection: 1, location: "三教2101", raw: {} },
  { courseName: "体育（网球）", teacher: "李伟", dayOfWeek: 4, startSection: 5, endSection: 5, location: "气膜网球馆", raw: {} },
  { courseName: "操作系统", teacher: "陆游游", dayOfWeek: 5, startSection: 2, endSection: 3, location: "六教6A215", raw: {} },
  { courseName: "大学英语（四级）", teacher: "何静", dayOfWeek: 5, startSection: 1, endSection: 1, location: "文南楼401", raw: {} },
];

export const DEMO_USER = { name: "顾晓", studentId: "2025013388", department: "计算机科学与技术系" };

/* ============ 信息门户演示数据（thu-info-lib 数据形态） ============ */

export const DEMO_REPORT: ReportRow[] = [
  { name: "思想道德与法治", credit: 2, grade: "A-", point: 3.7, semester: "2024-2025秋", raw: [] },
  { name: "计算机程序设计基础", credit: 3, grade: "A", point: 4.0, semester: "2024-2025秋", raw: [] },
  { name: "线性代数(1)", credit: 3, grade: "B+", point: 3.3, semester: "2024-2025秋", raw: [] },
  { name: "微积分A(1)", credit: 5, grade: "A-", point: 3.7, semester: "2024-2025秋", raw: [] },
  { name: "中国近现代史纲要", credit: 2, grade: "A", point: 4.0, semester: "2024-2025春", raw: [] },
  { name: "数据结构", credit: 4, grade: "A", point: 4.0, semester: "2024-2025春", raw: [] },
  { name: "微积分A(2)", credit: 5, grade: "B", point: 3.0, semester: "2024-2025春", raw: [] },
  { name: "大学物理(1)", credit: 4, grade: "P", point: Number.NaN, semester: "2025-2026秋", raw: [] },
  { name: "计算机组成原理", credit: 4, grade: "A-", point: 3.7, semester: "2025-2026秋", raw: [] },
  { name: "概率论与数理统计", credit: 3, grade: "A", point: 4.0, semester: "2025-2026秋", raw: [] },
];

export const DEMO_EXAMS: ExamEntry[] = [
  { courseName: "计算机组成原理", date: dt(9, "").slice(0, 10), startTime: "14:00", endTime: "16:00", location: "三教2100", category: "考试", raw: {} },
  { courseName: "概率论与数理统计", date: dt(13, "").slice(0, 10), startTime: "09:00", endTime: "11:00", location: "四教4300", category: "考试", raw: {} },
  { courseName: "数据结构与算法设计", date: dt(16, "").slice(0, 10), startTime: "14:30", endTime: "16:30", location: "六教6C300", category: "考试", raw: {} },
];

export const DEMO_NEWS: NewsItem[] = [
  { name: "关于2026年春季学期本科生选课时间安排的通知", xxid: "d1", url: "https://info.tsinghua.edu.cn/b/info/xxfb_fg/xnzx/template/detail?wzid=d1", date: dt(-1, "10:22").slice(0, 10), source: "教务处", topped: true, channel: "LM_JWGG" },
  { name: "第十二周星期一（11月24日）全校停课一天", xxid: "d2", url: "https://info.tsinghua.edu.cn/b/info/xxfb_fg/xnzx/template/detail?wzid=d2", date: dt(-2, "16:05").slice(0, 10), source: "教务处", channel: "LM_JWGG" },
  { name: "图书馆逸夫馆修缮期间开放调整的通告", xxid: "d3", url: "https://info.tsinghua.edu.cn/b/info/xxfb_fg/xnzx/template/detail?wzid=d3", date: dt(-3, "09:40").slice(0, 10), source: "图书馆", channel: "LM_TTGGG" },
  { name: "关于开展2025年度本科生荣誉评定的通知", xxid: "d4", url: "https://info.tsinghua.edu.cn/b/info/xxfb_fg/xnzx/template/detail?wzid=d4", date: dt(-4, "14:10").slice(0, 10), source: "学生部", channel: "LM_BGTG" },
  { name: "第28届校园马拉松报名启动", xxid: "d5", url: "https://info.tsinghua.edu.cn/b/info/xxfb_fg/xnzx/template/detail?wzid=d5", date: dt(-5, "11:30").slice(0, 10), source: "体育部", channel: "LM_XSBGGG" },
];

/** 校园卡演示数据：余额 + 最近消费（函数生成保证日期相对今天） */
export function demoCardBundle(): { info: CardInfo; transactions: CardTransaction[] } {
  const tx = (offset: number, hm: string, amount: number, balance: number, name: string, txName: string): CardTransaction => ({
    id: `t${offset}${hm.replace(":", "")}`,
    summary: name,
    timestamp: new Date(dt(offset, hm)),
    amount,
    balance,
    name,
    txName,
  });
  return {
    info: {
      userId: "2025013388",
      userName: "顾晓",
      departmentName: "计算机科学与技术系",
      balance: 86.4,
      cardId: "100013888",
      cardStatus: "正常",
      lastTransactionTimestamp: new Date(dt(0, "12:05")),
      maxDailyTransactionAmount: 100,
      maxOneTimeTransactionAmount: 50,
    },
    transactions: [
      tx(0, "12:05", -13.5, 86.4, "桃李园食堂", "消费"),
      tx(0, "08:12", -4.0, 99.9, "清青快餐", "消费"),
      tx(-1, "18:40", -16.0, 103.9, "紫荆食堂", "消费"),
      tx(-1, "11:50", -2.0, 119.9, "新水咖啡", "消费"),
      tx(-2, "13:02", -15.5, 121.9, "丁香园食堂", "消费"),
      tx(-3, "08:05", -6.5, 137.4, "清芬园食堂", "消费"),
      tx(-4, "19:20", -3.5, 143.9, "教育超市", "消费"),
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
  };
}

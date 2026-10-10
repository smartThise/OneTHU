/**
 * 雨课堂课程列表（网络学堂页「雨课堂课程」一节的数据源）单测（离线，mock，不打真实平台）。
 *
 * 运行：node tools/ykt-courses-test.mjs
 *
 * 覆盖：
 *  [1] core：createYuketangSource().fetchCourses() —— classroom_id → id、name、role 6 → audited、
 *      课程网页入口 url；role 5 / 缺 role → 不标旁听（保守）。
 *  [2] core：课程列表与作业共用同一份 courses/list 请求（同一次刷新只打一次接口）。
 *  [3] core：refreshExternalHomework() 透出 courses（与 items 同轮），且单源失败隔离。
 *  [4] core：courses/list 死会话（errcode=401000）→ YktSessionError（供编排层判定）。
 *  [5] 接线静态审计：网络学堂页渲染「雨课堂课程」一节并以 extCourseId 跳「全部作业」；
 *      全部作业页按 extCourseId 过滤。
 */
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createYuketangSource, isYktSessionError, yktStudentLeafUrl } from "../packages/core/src/exthw/yuketang.ts";

registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {
      try {
        return next(specifier.slice(0, -3) + ".ts", context);
      } catch {
        /* 落回原样 */
      }
    }
    return next(specifier, context);
  },
});

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.log(`  ✗ ${msg}`);
  }
}
function eq(actual, expected, msg) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${msg}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
}

/** 按 URL 路由的 mock fetchLike；记录每次请求 url（与 exthw-status-test 同款口径） */
function makeFetch(routes) {
  const calls = [];
  const reqs = []; // 完整请求（含 method / headers / body），供形态断言
  const fetchLike = async (url, init) => {
    calls.push(String(url));
    reqs.push({ url: String(url), init: init ?? null });
    for (const r of routes) {
      if (r.match(String(url))) {
        const body = typeof r.body === "function" ? r.body(String(url)) : r.body;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify(body),
          json: async () => body,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
    }
    throw new Error(`未覆盖的请求：${url}`);
  };
  return { fetchLike, calls, reqs };
}

const COURSE_LIST = {
  errcode: 0,
  data: {
    list: [
      // 真实形态：name = 课堂全名（2026秋-…），course.name = 课程本名，teacher.name = 教师
      { classroom_id: 111111, name: "2026秋-微积分A(1)-8", role: 5, teacher: { name: "崔建莲" }, course: { name: "微积分A(1)" } },
      { classroom_id: 222222, name: "2026秋-写作与沟通-6", role: 6, teacher: "陈豪", course: { name: "写作与沟通" } },
      { classroom_id: 333333, name: "无 role 课堂", course: { name: "无 role 课堂" } },
    ],
  },
};

const ACTIVITIES = (cid) => ({
  errcode: 0,
  data: {
    activities: [
      // 无 leaf_type_id → 不做提交状态查询（本测试只关心课程列表链路）
      { id: `a-${cid}`, type: 19, classroom_id: cid, title: "第 1 次作业", content: { score_d: Date.now() + 86400000 } },
    ],
  },
});

console.log("[1] fetchCourses：课程归一化");
{
  const { fetchLike } = makeFetch([
    { match: (u) => u.includes("/v2/api/web/courses/list"), body: COURSE_LIST },
    { match: (u) => u.includes("/v2/api/web/logs/learn/"), body: (u) => ACTIVITIES(u.split("/logs/learn/")[1].split("?")[0]) },
  ]);
  const src = createYuketangSource({ cookie: "sessionid=x", uvId: "2598" }, fetchLike, 30);
  const courses = await src.fetchCourses();
  eq(courses.length, 3, "三门课全部透出（含无 role 的课堂）");
  eq(courses[0].id, "111111", "classroom_id → id");
  eq(courses[0].name, "2026秋-微积分A(1)-8", "课堂全名透传（官方卡片小标题）");
  eq(courses[0].source, "yuketang", "source 标记为雨课堂");
  eq(courses[0].audited, undefined, "role 5（正式）不标旁听");
  eq(courses[1].audited, true, "role 6 标旁听");
  eq(courses[2].audited, undefined, "缺 role 不臆断旁听");
  ok(String(courses[0].url).includes("/v2/web/studentLog/111111"), "带该课程的平台入口");
  // 官方卡片「大标题 + 小标题」两行：title=course.name（课程本名）/ name=课堂全名 / teacher=教师
  eq(courses[0].title, "微积分A(1)", "course.name → title（官方大标题）");
  eq(courses[0].teacher, "崔建莲", "teacher.name → teacher（小标题里的教师名）");
  eq(courses[1].teacher, "陈豪", "teacher 为纯字符串时也能取到");
  eq(courses[2].title, "无 role 课堂", "缺 course.name 时用课堂名兜底");
}

console.log("[2] 课程列表与作业共用一次 courses/list 请求");
{
  const { fetchLike, calls } = makeFetch([
    { match: (u) => u.includes("/v2/api/web/courses/list"), body: COURSE_LIST },
    { match: (u) => u.includes("/v2/api/web/logs/learn/"), body: (u) => ACTIVITIES(u.split("/logs/learn/")[1].split("?")[0]) },
  ]);
  const src = createYuketangSource({ cookie: "sessionid=x", uvId: "2598" }, fetchLike, 30);
  const [hw, courses] = await Promise.all([src.fetch(), src.fetchCourses()]);
  const courseCalls = calls.filter((u) => u.includes("/v2/api/web/courses/list"));
  eq(courseCalls.length, 1, "courses/list 只打一次（两个入口共享同一份）");
  eq(hw.length, 3, "作业照常拉全（每门课一条）");
  eq(courses.length, 3, "课程照常透出");
}

console.log("[3] 编排层透出 courses（与作业同轮）");
{
  const { refreshExternalHomework } = await import("../packages/core/src/exthw/index.ts");
  const { fetchLike, calls } = makeFetch([
    { match: (u) => u.includes("/v2/api/web/courses/list"), body: COURSE_LIST },
    { match: (u) => u.includes("/v2/api/web/logs/learn/"), body: (u) => ACTIVITIES(u.split("/logs/learn/")[1].split("?")[0]) },
  ]);
  const r = await refreshExternalHomework({
    getCreds: () => ({ yuketang: { cookie: "sessionid=x", uvId: "2598" } }),
    fetchLike,
  });
  eq(r.courses.length, 3, "result.courses 透出三门课");
  eq(r.items.length, 3, "result.items 照常");
  eq(Object.keys(r.errors).length, 0, "无错误");
  eq(calls.filter((u) => u.includes("/v2/api/web/courses/list")).length, 1, "整轮只打一次 courses/list");
}

console.log("[4] courses/list 死会话 → YktSessionError");
{
  const { fetchLike } = makeFetch([
    { match: (u) => u.includes("/v2/api/web/courses/list"), body: { errcode: 401000, errmsg: "Session not exists" } },
  ]);
  const src = createYuketangSource({ cookie: "sessionid=dead", uvId: "2598" }, fetchLike, 30);
  let coursesErr = null;
  let fetchErr = null;
  try {
    await src.fetchCourses();
  } catch (e) {
    coursesErr = e;
  }
  try {
    await src.fetch();
  } catch (e) {
    fetchErr = e;
  }
  ok(isYktSessionError(coursesErr), "fetchCourses 抛出 YktSessionError");
  ok(isYktSessionError(fetchErr), "fetch 抛出同一类错误");
}

console.log("[5] 接线静态审计");
{
  const learn = readFileSync("apps/desktop/src/pages/Learn.tsx", "utf8");
  ok(learn.includes("雨课堂课程"), "网络学堂页有「雨课堂课程」一节");
  ok(/extCourseId:\s*c\.id/.test(learn), "课程卡片带 extCourseId 跳转");
  ok(learn.includes('navigate("learn-ykt-course"'), "课程卡片进「全部内容」页");

  const hw = readFileSync("apps/desktop/src/pages/learn/AssignmentsPage.tsx", "utf8");
  ok(hw.includes("navParams?.extCourseId"), "全部作业页读取 extCourseId");
  ok(/externalClassroomId === extCourseId/.test(hw), "按该课程过滤作业");

  const app = readFileSync("apps/desktop/src/state/app.tsx", "utf8");
  ok(app.includes("extCourseId?: string"), "LearnNav 声明 extCourseId");

  const src = readFileSync("packages/core/src/exthw/yuketang.ts", "utf8");
  ok(/async fetchCourses\(\)/.test(src), "雨课堂源实现 fetchCourses");
  ok(/async fetchContents\(\)/.test(src), "雨课堂源实现 fetchContents（全部内容）");

  const page = readFileSync("apps/desktop/src/pages/learn/YktCoursePage.tsx", "utf8");
  ok(page.includes("ext.contents"), "课程内容页用 contents 渲染");
  ok(page.includes("HomeworkRow"), "作业/试卷行复用作业行组件");
  const appTsx = readFileSync("apps/desktop/src/App.tsx", "utf8");
  ok(appTsx.includes('page === "learn-ykt-course"'), "路由挂载课程内容页");
}

console.log("[6] fetchContents：全部内容（不只作业）");
{
  const CID = 777;
  const FUTURE = Date.now() + 86400000; // 作业只保留「未来 N 天」窗口内的条目
  const COURSES = { errcode: 0, data: { list: [{ classroom_id: CID, name: "测试课", role: 5 }] } };
  // 一条学习日志里混着：作业 / 试卷 / 课件 / 资料 / 视频 / 公告 / 投票 / 未知类型（12）
  const LOGS = {
    errcode: 0,
    data: {
      activities: [
        { id: 1, type: 19, classroom_id: CID, title: "第一次作业", content: { score_d: FUTURE, leaf_type_id: 11, leaf_id: 101, sku_id: 91 } },
        { id: 2, type: 20, classroom_id: CID, title: "期中试卷", content: { score_d: FUTURE, leaf_type_id: 12, leaf_id: 102, sku_id: 92 } },
        { id: 3, type: 14, classroom_id: CID, title: "第 1 章课件", content: { leaf_type_id: 13, leaf_id: 103, start_d: 1899999999000 } },
        { id: 4, type: 16, classroom_id: CID, title: "教学基本要求", content: { leaf_type_id: 14, leaf_id: 104 } },
        { id: 5, type: 2, classroom_id: CID, title: "图书馆系列课程微课", content: { leaf_type_id: 15, leaf_id: 105 } },
        { id: 6, type: 9, classroom_id: CID, title: "习题课安排", content: { leaf_type_id: 16, leaf_id: 106 } },
        { id: 7, type: 5, classroom_id: CID, title: "随堂投票", content: { leaf_type_id: 17, leaf_id: 107 } },
        { id: 8, type: 12, classroom_id: CID, title: "未知类型内容", content: { leaf_type_id: 18, leaf_id: 108 } },
      ],
    },
  };
  const { fetchLike, calls } = makeFetch([
    { match: (u) => u.includes("/v2/api/web/courses/list"), body: COURSES },
    { match: (u) => u.includes(`/v2/api/web/logs/learn/${CID}`), body: LOGS },
    { match: (u) => u.includes("/get_exercise_list/"), body: { data: { answer_count: 0, problems: [] } } },
    { match: (u) => u.includes("/v/exam/cover"), body: { data: { problem_count: 1, result: null } } },
  ]);
  const src = createYuketangSource({ cookie: "sessionid=x", uvId: "2598" }, fetchLike, 30);
  const [contents, hw, courses] = await Promise.all([src.fetchContents(), src.fetch(), src.fetchCourses()]);

  eq(contents.length, 8, "八个活动全部作为内容透出（含非作业类型）");
  eq(
    contents.map((c) => c.kind),
    ["homework", "exam", "courseware", "material", "video", "announcement", "poll", "other"],
    "类型映射",
  );
  eq(
    contents.map((c) => c.kindText),
    ["作业", "试卷", "课件", "资料", "视频", "公告", "投票", "其他（类型 12）"],
    "已确认类型给中文名，未知类型保留原始类型号",
  );
  eq(contents[7].rawType, 12, "未知类型 rawType 原样保留");
  eq(contents[2].kindText, "课件", "14 → 课件");
  ok(contents[2].deadline !== undefined, "课件按候选时间字段解析出时间");
  eq(contents[0].courseId, String(CID), "内容带所属课程 id");
  eq(contents[0].courseName, "测试课", "内容带课程名");
  ok(String(contents[2].url).includes(`/v2/web/studentLog/${CID}`), "非作业类型指向课程日志页");
  ok(String(contents[0].url).includes("/exercise/101"), "作业保留学生端深链");
  eq(hw.length, 2, "作业聚合仍只取作业+试卷");
  eq(courses.length, 1, "课程列表照常");
  eq(calls.filter((u) => u.includes("/v2/api/web/courses/list")).length, 1, "courses/list 仍只打一次");
  eq(calls.filter((u) => u.includes("/v2/api/web/logs/learn/")).length, 1, "logs/learn 每课只打一次（三处共用）");
}

console.log("[7] 叶子内容详情（站内预览用）与站内路由");
{
  // ① 视频叶子：leaf_type=0 + m3u8 直链
  const videoBody = {
    data: { leaf_type: 0, title: "第 3 讲 行列式", content: { url: "https://vod.xuetangx.com/a/b/c.m3u8?sign=1", duration: 620 } },
  };
  const fv = makeFetch([{ match: (u) => u.includes("/lms/learn/leaf_info/"), body: videoBody }]);
  const sv = createYuketangSource({ cookie: "sessionid=x" }, fv.fetchLike, 30);
  const dv = await sv.getLeafDetail("777", "103");
  ok(fv.calls[0].includes("/mooc-api/v1/lms/learn/leaf_info/777/103/"), "leaf_info 路径与参数正确");
  // ⚠️ 真连实测（2026-10-10）：缺 classroom_id 查询参数时服务端回
  //    success=false / error_code=40000 / msg=CLASSROOM ID IS REQUIRED（HTTP 仍 200）
  ok(/[?&]classroom_id=777(&|$)/.test(fv.calls[0]), "leaf_info 带 classroom_id 查询参数（缺它服务端拒绝）");
  ok(fv.calls[0].includes("term=latest"), "leaf_info 带 term=latest");
  eq(dv.leafType, 0, "leaf_type 透出（0=视频）");
  ok(typeof dv.mediaUrl === "string" && dv.mediaUrl.endsWith("?sign=1"), "按扩展名识别出 m3u8 媒体直链");
  eq(dv.fileUrl, undefined, "媒体直链不误判为文件直链");
  ok(dv.shape.includes("leaf_type") && dv.shape.includes("content.url"), "带响应字段名做诊断");

  // ② 资料叶子：pdf 直链 → 原生预览
  const fileBody = { data: { leaf_type: 3, content: { download_url: "https://qn-scd1.yuketang.cn/x/讲义.pdf" } } };
  const ff = makeFetch([{ match: (u) => u.includes("/lms/learn/leaf_info/"), body: fileBody }]);
  const sf = createYuketangSource({ cookie: "sessionid=x" }, ff.fetchLike, 30);
  const df = await sf.getLeafDetail("777", "104");
  ok(String(df.fileUrl).endsWith("讲义.pdf"), "按扩展名识别出文件直链（原生预览据此走 FilePreview）");

  // ③ 空壳响应不崩、不臆造
  const fe = makeFetch([{ match: (u) => u.includes("/lms/learn/leaf_info/"), body: { data: {} } }]);
  const se = createYuketangSource({ cookie: "sessionid=x" }, fe.fetchLike, 30);
  const de = await se.getLeafDetail("777", "105");
  eq(de.leafType, undefined, "缺 leaf_type 不臆造");
  eq(de.fileUrl, undefined, "无直链时不设 fileUrl");

  // ③b 图片序列（图文/课件）：按图片扩展名收集，供内嵌逐页渲染
  const imgBody = {
    data: {
      leaf_type: 3,
      content_info: { slides: [{ url: "https://qn1-next.xuetangonline.com/s1.png" }, { url: "https://qn1-next.xuetangonline.com/s2.jpg" }] },
    },
  };
  const fi = makeFetch([{ match: (u) => u.includes("/lms/learn/leaf_info/"), body: imgBody }]);
  const si = createYuketangSource({ cookie: "sessionid=x" }, fi.fetchLike, 30);
  const di = await si.getLeafDetail("777", "106");
  eq(di.images?.length, 2, "图文内容收集到 2 张图片（内嵌逐页渲染）");
  eq(di.fileUrl, undefined, "图片不再误判为文档直链");

  // ③c 公告正文：GET /v/discussion/v2/topic/{courseware_id}/?classroom_id=…
  //     口径来自 2026-10-10 用 CDP 抓到的**官方公告页原始请求**（noticeView 点开时发出）：
  //     · id 用活动里的 courseware_id（不是 id）；
  //     · 必须带官方那套头（X-CSRFToken / uv-id / classroom-id / university-id /
  //       Xt-Agent: web / xtbz: ykt，Referer 指向该公告的 noticeView 页），
  //       否则服务端 200 + `success=false「无权限」`（我最初就栽在这）；
  //     · 响应是**双层 data**：data.data.topic.{topic_name, content.text}。
  const noticeBody = {
    msg: "",
    code: 0,
    data: {
      status: 0,
      message: "操作成功",
      data: {
        topic: {
          id: 930455,
          topic_name: "习题课安排",
          content: { text: '<div class="custom_ueditor_cn_body"><p>本周习题课改到<b>周四</b>。</p></div>' },
        },
      },
    },
  };
  const fn = makeFetch([{ match: (u) => u.includes("/v/discussion/v2/topic/"), body: noticeBody }]);
  const sn = createYuketangSource({ cookie: "sessionid=x; csrftoken=tok; university_id=2598", uvId: "2598" }, fn.fetchLike, 30);
  const dn = await sn.getNoticeDetail("3201637", "930455");
  eq(dn.title, "习题课安排", "标题取自 topic.topic_name");
  ok(String(dn.bodyHtml).includes("<b>周四</b>"), "正文取自双层 data 的 data.data.topic.content.text");
  const req0 = fn.reqs[0];
  eq(req0.init?.method, "GET", "公告详情是 GET（官方页实测）");
  ok(String(req0.url).endsWith("/v/discussion/v2/topic/930455/?classroom_id=3201637"), "端点与查询参数正确");
  const h0 = req0.init?.headers ?? {};
  eq(h0["classroom-id"], "3201637", "带 classroom-id 头");
  eq(h0["uv-id"], "2598", "带 uv-id 头");
  eq(h0["university-id"], "2598", "带 university-id 头");
  eq(h0["Xt-Agent"], "web", "带 Xt-Agent 头");
  eq(h0["xtbz"], "ykt", "带 xtbz 头");
  ok(String(h0["X-CSRFToken"] ?? "").length > 0, "带 X-CSRFToken 头");
  ok(String(h0["Referer"] ?? "").includes("/v2/web/noticeView/3201637/930455"), "Referer 指向该公告页");

  // 纯文本正文按段包 <p>
  const noticeText = {
    code: 0,
    data: { data: { topic: { topic_name: "纯文本公告", content: { text: "第一行\n\n第二行" } } } },
  };
  const ft = makeFetch([{ match: (u) => u.includes("/v/discussion/v2/topic/"), body: noticeText }]);
  const st = createYuketangSource({ cookie: "sessionid=x; csrftoken=tok" }, ft.fetchLike, 30);
  const dt = await st.getNoticeDetail("777", "889");
  ok(/<p>第一行<\/p>[\s\S]*<p>第二行<\/p>/.test(String(dt.bodyHtml)), "纯文本公告按段落包成 <p>");

  // ③d 公告 id 字段名不固定：递归收集候选 + 多候选回退（用户实测「公告取不到正文」的根因）
  const NOTICE_COURSES = { errcode: 0, data: { list: [{ classroom_id: 777, name: "测试课", role: 5 }] } };
  const LOGS_WITH_NOTICE = {
    errcode: 0,
    data: {
      activities: [
        // 公告 id 藏在非显而易见的字段里（topic_id）——旧实现只认 notice_id/link_id 会取空
        { id: 31, type: 9, classroom_id: 777, title: "习题课安排", content: { topic_id: 555001 } },
        // 嵌套更深一层也要能收集到
        { id: 32, type: 9, classroom_id: 777, title: "考试安排", content: { extra: { notice_id: 555002 } } },
        // 作业的 leaf_id / sku_id 不能污染公告候选（否则作业深链会被改写成公告链接）
        { id: 33, type: 19, classroom_id: 777, title: "第一次作业", content: { score_d: Date.now() + 86400000, leaf_type_id: 11, leaf_id: 101, sku_id: 91 } },
      ],
    },
  };
  const { fetchLike: fnotice } = makeFetch([
    { match: (u) => u.includes("/v2/api/web/courses/list"), body: NOTICE_COURSES },
    { match: (u) => u.includes("/v2/api/web/logs/learn/"), body: LOGS_WITH_NOTICE },
    { match: (u) => u.includes("/get_exercise_list/"), body: { data: { answer_count: 0, problems: [] } } },
  ]);
  const sn2 = createYuketangSource({ cookie: "sessionid=x" }, fnotice, 30);
  const contents2 = await sn2.fetchContents();
  const ann1 = contents2.find((c) => c.title === "习题课安排");
  const ann2 = contents2.find((c) => c.title === "考试安排");
  const hw2 = contents2.find((c) => c.title === "第一次作业");
  ok((ann1?.noticeIdCandidates?.length ?? 0) > 0, "公告 id 藏在 topic_id 里也能收集到候选");
  // 候选顺序：先 act.courseware_id / act.id（真机实测公告活动没有 content），再 content 里的递归候选
  ok((ann1?.noticeIdCandidates ?? []).includes("555001"), "content 里的 topic_id 进入候选");
  ok((ann2?.noticeIdCandidates ?? []).includes("555002"), "嵌套一层的 notice_id 也进入候选");
  eq(hw2?.noticeIdCandidates, undefined, "作业不收集公告候选（避免污染作业深链）");

  // 多候选回退：第一个候选失败（success=false）→ 换第二个候选拿到正文
  let noticeCallN = 0;
  const noticeBySecond = () =>
    ++noticeCallN === 1
      ? { success: false, data: {} } // 第一个候选：无权限/不存在
      : {
          code: 0,
          data: { data: { topic: { topic_name: "第二候选命中", content: { text: "<p>正文</p>" } } } },
        };
  const { fetchLike: fb, calls: cb } = makeFetch([
    { match: (u) => u.includes("/v/discussion/v2/topic/"), body: noticeBySecond },
  ]);
  const sb = createYuketangSource({ cookie: "sessionid=x" }, fb, 30);
  const db = await sb.getNoticeDetail("777", ["555011", "555012"]);
  eq(db.title, "第二候选命中", "第一个候选失败时自动换第二个候选");
  ok(cb.length >= 1 && db.shape.length >= 1, "候选尝试有诊断记录");
  ok(String(db.bodyHtml).includes("正文"), "第二候选的正文被取到");

  // ④ 站内路由（公开前端路由表口径：/v2/web/lms/{cid}/{segment}/{leafId}）
  ok(yktStudentLeafUrl("777", "103", 0).endsWith("/v2/web/lms/777/video/103"), "leaf_type 0 → video 路由");
  ok(yktStudentLeafUrl("777", "103", 3).endsWith("/v2/web/lms/777/graph/103"), "leaf_type 3 → graph 路由");
  ok(yktStudentLeafUrl("777", "103", undefined).endsWith("/v2/web/studentLog/777"), "leaf_type 未知 → 回落课程日志页");
}

console.log("[8] 雨课堂公告并入通知聚合（接线审计）");
{
  const exthw = readFileSync("apps/desktop/src/state/exthw.ts", "utf8");
  ok(/export function useExternalNotices/.test(exthw), "state 层提供 useExternalNotices");
  ok(/ext:ykt-notice-/.test(exthw), "外部通知 id 有专用前缀（用于点击分流）");
  ok(/kind === "announcement"/.test(exthw), "只把公告类型并入通知");

  const pages = readFileSync("apps/desktop/src/pages/learn/NoticesPage.tsx", "utf8");
  ok(pages.includes("useExternalNotices"), "全部通知页并入雨课堂公告");
  ok(pages.includes("NoticeRow"), "两来源共用同一行组件");
  // R32：点击行为与网络学堂通知一致——不再列表内联展开，统一进站内通知详情页
  ok(!pages.includes("ykt-content-panel"), "公告不再在列表行下方内联展开");
  ok(!/onOpen/.test(pages), "公告行不再自带打开方式（统一走详情页路由）");

  const today = readFileSync("apps/desktop/src/pages/Today.tsx", "utf8");
  ok(today.includes("noticesMerged"), "今日页「最近通知」合并两来源");
  ok(!today.includes("isExternalNoticeId"), "今日页不再按来源分流点击");
  ok(!today.includes("openYktInApp"), "今日页不再打开官方页");

  const widgets = readFileSync("apps/desktop/src/components/HomeWidgets.tsx", "utf8");
  ok(!/onOpen\?\.\(n\)/.test(widgets), "通知卡体不再按来源分流，统一进详情页");

  // R32：雨课堂公告进**同一个**站内通知详情页（同一套 UI）
  const noticeDetail = readFileSync("apps/desktop/src/pages/learn/NoticeDetailPage.tsx", "utf8");
  ok(noticeDetail.includes("useExternalNotices"), "详情页能按 id 找到雨课堂公告");
  ok(noticeDetail.includes("fetchYktNoticeDetail"), "详情页正文走雨课堂 topic 链路");
  ok(noticeDetail.includes("YktContentBody"), "详情页正文用站内渲染器（不开官方页）");
  ok(/isExt[\s\S]{0,120}attState !== "idle"/.test(noticeDetail), "外部公告不进网络学堂附件流程");

  ok(!existsSync("apps/desktop/src/lib/yktPreview.ts"), "已移除「打开官方页」通道封装（内嵌渲染取代）");
  const coursePage = readFileSync("apps/desktop/src/pages/learn/YktCoursePage.tsx", "utf8");
  ok(coursePage.includes("fetchYktLeafDetail"), "课程内容页先取 leaf_info 定 leaf_type");
  ok(coursePage.includes("openFilePreview"), "有文件直链时走原生预览");
  ok(coursePage.includes("YktContentBody"), "其余内容就地内嵌渲染");
  ok(coursePage.includes("learn-notice-detail"), "课程页公告行也进同一个通知详情页");
  ok(!coursePage.includes("openYktSubmitWebview") && !coursePage.includes("openYktInApp"), "课程内容页不再打开官方页");

  const body = readFileSync("apps/desktop/src/components/exthw/YktContentBody.tsx", "utf8");
  ok(body.includes("YktVideoPlayer"), "内嵌内容支持视频播放器");
  ok(body.includes("ProblemBody"), "HTML 正文复用题干渲染器");
  const player = readFileSync("apps/desktop/src/components/exthw/YktVideoPlayer.tsx", "utf8");
  ok(/import\("hls\.js"\)/.test(player), "视频按需加载 hls.js（HLS 内嵌播放）");
  const courseDetail = readFileSync("apps/desktop/src/pages/learn/CourseDetailPage.tsx", "utf8");
  ok(courseDetail.includes("toExternalNotice"), "课程页雨课堂公告行与列表同一结构");
  ok(/navCourseId=\{courseId\}/.test(courseDetail), "课程页公告返回带回本课程 id");
  ok(!pages.includes("openYktInApp"), "公告不再打开官方页");
}

console.log("[9] 同名课程合并（网络学堂 × 雨课堂，R28）");
{
  const { normalizeCourseName, mergeCoursesByName } = await import(
    "../apps/desktop/src/pages/learn/courseMerge.ts"
  );
  // 归一化：空白（含全角）、全角括号、破折号、大小写差异都收敛
  eq(normalizeCourseName("线性代数"), normalizeCourseName(" 线性代数 "), "首尾/中间空白归一");
  eq(normalizeCourseName("形势与政策（2）-秋"), normalizeCourseName("形势与政策(2)-秋"), "全角括号归一");
  eq(normalizeCourseName("体育(1)"), normalizeCourseName("体育（1）"), "全角/半角括号互认");
  eq(normalizeCourseName("Data结构"), normalizeCourseName("data结构"), "大小写归一");

  const learn = [
    { id: "L1", name: "线性代数" },
    { id: "L2", name: "形势与政策（2）-秋" },
    { id: "L3", name: "只存在于网络学堂" },
  ];
  const ykt = [
    // 有本名 → 可匹配（title 是 course.name）
    { id: "Y1", name: "2026秋-线性代数-8", title: "线性代数" },
    { id: "Y2", name: "2026秋-形势与政策（2）-秋-90", title: "形势与政策(2)-秋" },
    // 只有课堂全名（无本名）→ 保守不匹配，仍单列
    { id: "Y3", name: "2026秋-2601微积分习题课3-6" },
    { id: "Y4", name: "2026秋-某不存在的课-1", title: "某不存在的课" },
  ];
  const m = mergeCoursesByName(learn, ykt);
  eq(m.byLearnId.get("L1")?.id, "Y1", "线性代数 → 合并到网络学堂卡片");
  eq(m.byLearnId.get("L2")?.id, "Y2", "全角括号差异也能匹配上");
  eq(m.byLearnId.get("L3"), undefined, "网络学堂独有课程不产生配对");
  eq([...m.mergedYktIds].sort(), ["Y1", "Y2"], "已并入的雨课堂课程 id 正确");
  eq(m.unmatchedYkt.map((c) => c.id).sort(), ["Y3", "Y4"], "无本名/无同名的雨课堂课程仍单列");

  // 同名多门：雨课堂一门课只并入一张卡（不重复占用），其余网络学堂同名卡不重复并入
  const dupLearn = [
    { id: "A1", name: "写作与沟通" },
    { id: "A2", name: "写作与沟通" },
  ];
  const dupYkt = [{ id: "Z1", name: "2026秋-写作与沟通-47", title: "写作与沟通" }];
  const dm = mergeCoursesByName(dupLearn, dupYkt);
  eq(dm.byLearnId.size, 1, "同一门雨课堂课只并入一张同名卡片");
  eq(dm.mergedYktIds.size, 1, "不重复计入已合并集合");
  eq(dm.unmatchedYkt.length, 0, "唯一一门课已被并入，单列区为空");

  // 课程页栏位映射（R29）：作业/试卷 → 作业栏；公告 → 通知栏；其余 → 文件栏
  const { yktKindToCourseTab } = await import("../apps/desktop/src/pages/learn/courseMerge.ts");
  eq(yktKindToCourseTab("homework"), "assignments", "作业 → 作业栏");
  eq(yktKindToCourseTab("exam"), "assignments", "试卷 → 作业栏");
  eq(yktKindToCourseTab("announcement"), "notices", "公告 → 通知栏");
  eq(yktKindToCourseTab("material"), "files", "资料 → 文件栏");
  eq(yktKindToCourseTab("courseware"), "files", "课件 → 文件栏");
  eq(yktKindToCourseTab("video"), "files", "视频 → 文件栏");
  eq(yktKindToCourseTab("poll"), "files", "投票 → 文件栏");
  eq(yktKindToCourseTab("other"), "files", "未知类型 → 文件栏（不丢内容）");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
